"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    const envs = await prisma_1.default.environment.findMany({ orderBy: { name: 'asc' } });
    res.json(envs);
});
router.post('/', async (req, res) => {
    const env = await prisma_1.default.environment.create({
        data: {
            name: req.body.name,
            baseUrl: req.body.baseUrl,
            variables: req.body.variables ?? [],
            secrets: req.body.secrets ?? [],
            requiresApproval: req.body.requiresApproval ?? false,
            executionCount: 0,
        },
    });
    res.status(201).json(env);
});
router.put('/:id', async (req, res) => {
    try {
        const updated = await prisma_1.default.environment.update({
            where: { id: req.params.id },
            data: {
                name: req.body.name,
                baseUrl: req.body.baseUrl,
                variables: req.body.variables ?? [],
                secrets: req.body.secrets ?? [],
                requiresApproval: req.body.requiresApproval ?? false,
            },
        });
        return res.json(updated);
    }
    catch {
        return res.status(404).json({ error: 'Not found' });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        await prisma_1.default.environment.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch {
        return res.status(404).json({ error: 'Not found' });
    }
});
exports.default = router;
