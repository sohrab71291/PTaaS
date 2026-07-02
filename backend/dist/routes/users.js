"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// All user-management routes are admin-only
router.use((0, auth_1.requireRole)('ADMIN'));
// GET /api/users
router.get('/', async (_req, res) => {
    const users = await prisma_1.default.user.findMany({
        select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'asc' },
    });
    res.json(users);
});
// POST /api/users
router.post('/', async (req, res) => {
    const { email, password, name, role = 'TESTER' } = req.body;
    if (!email || !password || !name) {
        res.status(400).json({ error: 'email, password, and name are required' });
        return;
    }
    const valid = ['ADMIN', 'TESTER', 'VIEWER'];
    if (!valid.includes(role)) {
        res.status(400).json({ error: `role must be one of ${valid.join(', ')}` });
        return;
    }
    const existing = await prisma_1.default.user.findUnique({ where: { email } });
    if (existing) {
        res.status(409).json({ error: 'Email already registered' });
        return;
    }
    const passwordHash = await bcryptjs_1.default.hash(password, 12);
    const user = await prisma_1.default.user.create({
        data: { email, passwordHash, name, role: role },
        select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
    });
    res.status(201).json(user);
});
// PUT /api/users/:id  — change role or name
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { role, name } = req.body;
    const valid = ['ADMIN', 'TESTER', 'VIEWER'];
    if (role && !valid.includes(role)) {
        res.status(400).json({ error: `role must be one of ${valid.join(', ')}` });
        return;
    }
    const existing = await prisma_1.default.user.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    const user = await prisma_1.default.user.update({
        where: { id },
        data: { ...(role ? { role: role } : {}), ...(name ? { name } : {}) },
        select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
    });
    res.json(user);
});
// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    // Prevent self-deletion
    if (req.user?.id === id) {
        res.status(400).json({ error: 'You cannot delete your own account' });
        return;
    }
    const existing = await prisma_1.default.user.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    await prisma_1.default.user.delete({ where: { id } });
    res.status(204).end();
});
exports.default = router;
