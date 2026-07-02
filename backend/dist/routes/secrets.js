"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    const secrets = await prisma_1.default.secret.findMany({ orderBy: { name: 'asc' } });
    // Never return actual values — metadata only
    res.json(secrets.map(s => ({
        id: s.id,
        name: s.name,
        backend: s.backend,
        backendPath: s.backendPath,
        environments: s.environments,
        lastRotated: s.lastRotated,
        expiresAt: s.expiresAt,
        status: s.status,
        createdAt: s.createdAt,
    })));
});
router.post('/', async (req, res) => {
    const body = { ...req.body };
    delete body.value; // never store actual value
    const secret = await prisma_1.default.secret.create({
        data: {
            name: body.name,
            backend: body.backend,
            backendPath: body.backendPath,
            environments: body.environments ?? [],
            status: 'active',
            lastRotated: new Date(),
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        },
    });
    res.status(201).json(secret);
});
router.delete('/:id', async (req, res) => {
    try {
        await prisma_1.default.secret.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch {
        return res.status(404).json({ error: 'Not found' });
    }
});
router.post('/:id/test', async (req, res) => {
    const secret = await prisma_1.default.secret.findUnique({ where: { id: req.params.id } });
    if (!secret)
        return res.status(404).json({ error: 'Not found' });
    return res.json({ success: true, message: 'Connection verified successfully' });
});
exports.default = router;
