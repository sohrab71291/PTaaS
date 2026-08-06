"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const mailer_1 = require("../lib/mailer");
const router = (0, express_1.Router)();
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
function hashToken(token) {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
}
function signToken(user) {
    return jsonwebtoken_1.default.sign({ sub: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' });
}
router.post('/register', async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
        res.status(400).json({ error: 'email, password, and name are required' });
        return;
    }
    const existing = await prisma_1.default.user.findUnique({ where: { email } });
    if (existing) {
        res.status(409).json({ error: 'Email already registered' });
        return;
    }
    const passwordHash = await bcryptjs_1.default.hash(password, 12);
    const user = await prisma_1.default.user.create({
        data: { email, passwordHash, name, role: 'TESTER' },
    });
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400).json({ error: 'email and password are required' });
        return;
    }
    const user = await prisma_1.default.user.findUnique({ where: { email } });
    if (!user) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        res.status(400).json({ error: 'email is required' });
        return;
    }
    const genericResponse = { message: 'If an account with that email exists, a password reset link has been sent.' };
    const user = await prisma_1.default.user.findUnique({ where: { email } });
    if (!user) {
        res.json(genericResponse);
        return;
    }
    const rawToken = crypto_1.default.randomBytes(32).toString('hex');
    await prisma_1.default.user.update({
        where: { id: user.id },
        data: {
            resetTokenHash: hashToken(rawToken),
            resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
    });
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    const resetLink = `${appUrl}/reset-password?token=${rawToken}`;
    // Fire-and-forget: don't block the response on SMTP delivery. Awaiting here would
    // both hang the request if the mail server is unreachable and leak a timing
    // side-channel that reveals whether the email is registered.
    (0, mailer_1.sendMail)([user.email], 'PerfOps: Reset your password', `<div style="font-family:sans-serif;max-width:480px">
      <p>We received a request to reset the password for your PerfOps account.</p>
      <p><a href="${resetLink}" style="color:#6366f1">Click here to reset your password</a></p>
      <p style="color:#64748b;font-size:12px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    </div>`).then(result => {
        if (!result.ok)
            console.error('Failed to send password reset email:', result.message);
    });
    res.json(genericResponse);
});
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) {
        res.status(400).json({ error: 'token and password are required' });
        return;
    }
    const user = await prisma_1.default.user.findFirst({
        where: {
            resetTokenHash: hashToken(token),
            resetTokenExpiresAt: { gt: new Date() },
        },
    });
    if (!user) {
        res.status(400).json({ error: 'Invalid or expired reset token' });
        return;
    }
    const passwordHash = await bcryptjs_1.default.hash(password, 12);
    await prisma_1.default.user.update({
        where: { id: user.id },
        data: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null },
    });
    res.json({ message: 'Password has been reset successfully' });
});
router.get('/me', auth_1.requireAuth, (req, res) => {
    res.json(req.user);
});
exports.default = router;
