"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMail = sendMail;
const nodemailer_1 = __importDefault(require("nodemailer"));
function buildSmtpTransport() {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || user || 'noreply@perfops.local';
    if (!host)
        return null;
    return {
        transport: nodemailer_1.default.createTransport({
            host,
            port,
            auth: user && pass ? { user, pass } : undefined,
            connectionTimeout: 10000,
            socketTimeout: 10000,
        }),
        from,
    };
}
async function sendMail(to, subject, html) {
    const smtp = buildSmtpTransport();
    if (!smtp)
        return { ok: false, message: 'SMTP not configured (set SMTP_HOST in .env)' };
    try {
        await smtp.transport.sendMail({ from: smtp.from, to: to.join(','), subject, html });
        return { ok: true, message: `Email sent to ${to.join(', ')}` };
    }
    catch (err) {
        return { ok: false, message: err.message };
    }
}
