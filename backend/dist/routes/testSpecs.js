"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const k6Generator_1 = require("../services/k6Generator");
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    const specs = await prisma_1.default.testSpec.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(specs);
});
router.post('/', async (req, res) => {
    const { name, description, tags, request: reqConfig, loadProfile, thresholds, checks, environmentId, generatedScript, slos } = req.body;
    // Upsert by name: same name → update existing suite; new name → create new suite.
    const existing = await prisma_1.default.testSpec.findFirst({ where: { name } });
    if (existing) {
        const updated = await prisma_1.default.testSpec.update({
            where: { id: existing.id },
            data: {
                description: description ?? null,
                tags: tags ?? [],
                request: reqConfig,
                loadProfile,
                thresholds: thresholds ?? {},
                checks: checks ?? [],
                slos: slos ?? [],
                environmentId: environmentId ?? null,
                generatedScript: generatedScript ?? existing.generatedScript,
            },
        });
        return res.json(updated);
    }
    const spec = await prisma_1.default.testSpec.create({
        data: {
            name,
            description: description ?? null,
            tags: tags ?? [],
            request: reqConfig,
            loadProfile,
            thresholds: thresholds ?? {},
            checks: checks ?? [],
            slos: slos ?? [],
            environmentId: environmentId ?? null,
            generatedScript: generatedScript ?? null,
            lastRunStatus: null,
            lastRunAt: null,
        },
    });
    return res.status(201).json(spec);
});
router.get('/:id', async (req, res) => {
    const spec = await prisma_1.default.testSpec.findUnique({ where: { id: req.params.id } });
    if (!spec)
        return res.status(404).json({ error: 'Not found' });
    return res.json(spec);
});
router.put('/:id', async (req, res) => {
    try {
        const updated = await prisma_1.default.testSpec.update({
            where: { id: req.params.id },
            data: {
                name: req.body.name,
                description: req.body.description ?? null,
                tags: req.body.tags ?? [],
                request: req.body.request,
                loadProfile: req.body.loadProfile,
                thresholds: req.body.thresholds ?? {},
                checks: req.body.checks ?? [],
                slos: req.body.slos ?? [],
                environmentId: req.body.environmentId ?? null,
                // Only overwrite the saved script when a non-null value is explicitly provided.
                // Sending null (no new script generated this session) preserves the existing one.
                ...(req.body.generatedScript != null ? { generatedScript: req.body.generatedScript } : {}),
                lastRunStatus: req.body.lastRunStatus,
                lastRunAt: req.body.lastRunAt ? new Date(req.body.lastRunAt) : null,
                scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : null,
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
        await prisma_1.default.testSpec.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch {
        return res.status(404).json({ error: 'Not found' });
    }
});
router.get('/:id/preview/json', async (req, res) => {
    const spec = await prisma_1.default.testSpec.findUnique({ where: { id: req.params.id } });
    if (!spec)
        return res.status(404).json({ error: 'Not found' });
    let resolvedEnvironment = { name: '', baseUrl: '', variables: [] };
    if (spec.environmentId) {
        const env = await prisma_1.default.environment.findUnique({ where: { id: spec.environmentId } });
        if (env) {
            resolvedEnvironment = {
                name: env.name,
                baseUrl: env.baseUrl,
                variables: env.variables ?? [],
            };
        }
    }
    return res.json({ ...spec, resolvedEnvironment });
});
router.get('/:id/preview/k6', async (req, res) => {
    const spec = await prisma_1.default.testSpec.findUnique({ where: { id: req.params.id } });
    if (!spec)
        return res.status(404).json({ error: 'Not found' });
    let baseUrl = 'https://api.example.com';
    if (spec.environmentId) {
        const env = await prisma_1.default.environment.findUnique({ where: { id: spec.environmentId } });
        if (env)
            baseUrl = env.baseUrl;
    }
    const script = (0, k6Generator_1.generateK6Script)(spec, baseUrl);
    return res.type('text/plain').send(script);
});
exports.default = router;
