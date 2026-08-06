"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const coralogix_1 = require("../services/coralogix");
const router = (0, express_1.Router)();
router.get('/coralogix/status', (_req, res) => {
    res.json({
        ingestionConfigured: !!process.env.CORALOGIX_API_KEY,
        queryConfigured: (0, coralogix_1.isQueryEnabled)(),
        domain: process.env.CORALOGIX_DOMAIN ?? 'eu2.coralogix.com',
        appName: process.env.CORALOGIX_APP_NAME ?? 'PTaaS',
    });
});
router.get('/coralogix/logs', async (req, res) => {
    try {
        const { rows, warnings } = await (0, coralogix_1.queryDataPrime)('logs', {
            text: typeof req.query.q === 'string' ? req.query.q : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            lookbackMinutes: req.query.lookback ? Number(req.query.lookback) : undefined,
        });
        res.json({ rows, warnings });
    }
    catch (err) {
        res.status(503).json({ error: err.message });
    }
});
router.get('/coralogix/traces', async (req, res) => {
    try {
        const { rows, warnings } = await (0, coralogix_1.queryDataPrime)('spans', {
            text: typeof req.query.q === 'string' ? req.query.q : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            lookbackMinutes: req.query.lookback ? Number(req.query.lookback) : undefined,
        });
        res.json({ rows, warnings });
    }
    catch (err) {
        res.status(503).json({ error: err.message });
    }
});
exports.default = router;
