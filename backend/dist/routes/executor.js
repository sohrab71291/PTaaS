"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const jobDispatcher_1 = require("../services/jobDispatcher");
const agentRegistry_1 = require("../services/agentRegistry");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.post('/executor/run', upload.single('script'), async (req, res) => {
    try {
        const { baseUrl, vus, duration, stages, profileType, envVars, testName, slos } = req.body;
        let script;
        if (req.file) {
            script = req.file.buffer.toString('utf8');
        }
        else if (req.body.script) {
            script = req.body.script;
        }
        else {
            res.status(400).json({ error: 'No script provided' });
            return;
        }
        let parsedSlos = [];
        try {
            parsedSlos = slos ? (typeof slos === 'string' ? JSON.parse(slos) : slos) : [];
        }
        catch { }
        const execution = await prisma_1.default.execution.create({
            data: {
                specName: (typeof testName === 'string' && testName.trim()) ? testName.trim() : 'Ad-hoc Execution',
                environment: 'custom',
                status: 'queued',
                triggeredBy: req.user?.email ?? 'executor',
                thresholdBreaches: 0,
                checksPassed: 0,
                checksFailed: 0,
                thresholdResults: [],
                checkResults: [],
                responseTimeSeries: [],
                slos: parsedSlos,
            },
        });
        const config = {
            baseUrl,
            vus: vus ? parseInt(vus) : 10,
            duration: duration || '1m',
            stages: stages ? (typeof stages === 'string' ? JSON.parse(stages) : stages) : null,
            profileType: profileType || 'staged',
            envVars: envVars ? (typeof envVars === 'string' ? JSON.parse(envVars) : envVars) : {},
        };
        try {
            await (0, jobDispatcher_1.dispatchJob)(execution.id, script, config);
        }
        catch (err) {
            return res.status(503).json({ error: err.message, executionId: execution.id });
        }
        res.json({ executionId: execution.id, wsUrl: `/ws/executor/${execution.id}` });
    }
    catch (err) {
        console.error('[executor/run] unhandled error:', err);
        res.status(500).json({ error: err.message ?? 'Internal server error' });
    }
});
router.post('/executor/stop/:executionId', async (req, res) => {
    const exec = await prisma_1.default.execution.findUnique({ where: { id: req.params.executionId } });
    if (!exec || !exec.agentId) {
        res.status(404).json({ error: 'Execution not found or not running' });
        return;
    }
    const dispatched = agentRegistry_1.agentRegistry.dispatch(exec.agentId, {
        type: 'cancel_job',
        executionId: exec.id,
    });
    res.json({ stopped: dispatched });
});
exports.default = router;
