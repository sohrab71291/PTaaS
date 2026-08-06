"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const k6Generator_1 = require("../services/k6Generator");
const jobDispatcher_1 = require("../services/jobDispatcher");
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    const executions = await prisma_1.default.execution.findMany({
        orderBy: { createdAt: 'desc' },
    });
    res.json(executions);
});
router.post('/', async (req, res) => {
    const { specId, environment } = req.body;
    const spec = await prisma_1.default.testSpec.findUnique({ where: { id: specId } });
    if (!spec)
        return res.status(404).json({ error: 'Spec not found' });
    let baseUrl = 'http://localhost:3000';
    let envName = environment || 'local';
    if (spec.environmentId) {
        const env = await prisma_1.default.environment.findUnique({ where: { id: spec.environmentId } });
        if (env) {
            baseUrl = env.baseUrl;
            envName = env.name;
        }
    }
    const execution = await prisma_1.default.execution.create({
        data: {
            specId: spec.id,
            specName: spec.name,
            environment: envName,
            status: 'queued',
            triggeredBy: req.user?.email ?? 'api-user@example.com',
            thresholdBreaches: 0,
            checksPassed: 0,
            checksFailed: 0,
            thresholdResults: [],
            checkResults: [],
            responseTimeSeries: [],
            slos: spec.slos ?? [],
        },
    });
    try {
        const script = (0, k6Generator_1.generateK6Script)(spec, baseUrl);
        await (0, jobDispatcher_1.dispatchJob)(execution.id, script, {
            baseUrl,
            profileType: spec.loadProfile?.type || 'staged',
            stages: spec.loadProfile?.stages || [],
        });
    }
    catch (err) {
        // No agent available — return execution in queued state
        return res.status(201).json({ ...execution, warning: err.message });
    }
    return res.status(201).json(execution);
});
router.get('/:id', async (req, res) => {
    const exec = await prisma_1.default.execution.findUnique({ where: { id: req.params.id } });
    if (!exec)
        return res.status(404).json({ error: 'Not found' });
    return res.json(exec);
});
exports.default = router;
