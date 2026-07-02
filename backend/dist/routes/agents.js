"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const agentRegistry_1 = require("../services/agentRegistry");
const router = (0, express_1.Router)();
// Public — called by the agent CLI before it has a JWT
router.post('/agents/register', async (req, res) => {
    const { name, hostname } = req.body;
    if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
    }
    // TODO: hash apiKey with bcrypt before storing in production
    const apiKey = crypto_1.default.randomBytes(32).toString('hex');
    const agent = await prisma_1.default.agent.create({
        data: { name, apiKey, hostname: hostname ?? null },
    });
    // apiKey returned in plaintext only this once
    res.status(201).json({ agentId: agent.id, apiKey, name: agent.name });
});
// Protected — requires admin role
router.get('/agents', auth_1.requireAuth, (0, auth_1.requireRole)('ADMIN', 'TESTER'), async (req, res) => {
    const dbAgents = await prisma_1.default.agent.findMany({ orderBy: { createdAt: 'desc' } });
    const liveStatus = agentRegistry_1.agentRegistry.listAll();
    const liveMap = new Map(liveStatus.map(a => [a.agentId, a]));
    const agents = dbAgents.map(a => ({
        id: a.id,
        name: a.name,
        hostname: a.hostname,
        k6Version: a.k6Version,
        status: liveMap.get(a.id)?.status ?? 'offline',
        lastSeen: liveMap.get(a.id)?.lastSeen ?? a.lastSeen,
        createdAt: a.createdAt,
    }));
    res.json(agents);
});
exports.default = router;
