"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const influxdb_1 = require("../services/influxdb");
const router = (0, express_1.Router)();
router.get('/:executionId', async (req, res) => {
    const exec = await prisma_1.default.execution.findUnique({ where: { id: req.params.executionId } });
    if (!exec)
        return res.status(404).json({ error: 'Not found' });
    const spec = exec.specId
        ? await prisma_1.default.testSpec.findUnique({ where: { id: exec.specId } })
        : null;
    let metrics = exec.metrics ?? null;
    let responseTimeSeries = exec.responseTimeSeries;
    let metricsSource = 'db';
    // ── Primary: query requestsRaw (same source as Grafana) ──────────────────────
    // This runs in parallel with the k6_execution fallback.
    const [grafanaMetrics, influxFallback] = await Promise.all([
        exec.startedAt
            ? (0, influxdb_1.queryFromRequestsRaw)(exec.startedAt, exec.finishedAt).catch(() => null)
            : Promise.resolve(null),
        // Fallback: k6_execution summary (for metrics DB already has)
        (!metrics || !metrics.p95) && exec.startedAt
            ? (0, influxdb_1.queryExecutionFromInflux)(exec.startedAt, exec.finishedAt).catch(() => null)
            : Promise.resolve(null),
    ]);
    // If requestsRaw has data, use it as the response time series source (matches Grafana chart)
    if (grafanaMetrics && grafanaMetrics.timeSeries.length > 0) {
        responseTimeSeries = grafanaMetrics.timeSeries;
    }
    // Fill missing DB metrics from k6_execution fallback
    const missingMetrics = !metrics || !metrics.p95;
    if (missingMetrics && influxFallback) {
        metrics = influxFallback.metrics;
        metricsSource = 'influxdb';
        await prisma_1.default.execution.update({
            where: { id: exec.id },
            data: { metrics: influxFallback.metrics, responseTimeSeries: influxFallback.timeSeries },
        }).catch(() => { });
    }
    // Stored errorRate is a decimal (0-1, canonical unit used by SLO
    // evaluation/notifications) — convert to % to match the frontend's display
    // convention. This must happen unconditionally: it previously only ran
    // inside the `if (grafanaMetrics)` branch below, so whenever the requestsRaw
    // Influx query returned nothing (e.g. no matching points for that time
    // window), the raw decimal leaked straight through to the frontend, which
    // renders `metrics.errorRate` assuming it is already a percentage — a
    // genuine 7.55% error rate displayed as ~0.08%.
    if (metrics && metrics.errorRate != null) {
        metrics = { ...metrics, errorRate: metrics.errorRate * 100 };
    }
    // If requestsRaw produced richer metrics, promote them to the main metrics object
    if (grafanaMetrics) {
        metricsSource = 'requestsRaw';
        // Error rate is intentionally NOT taken from requestsRaw here, unlike the
        // other fields — requestsRaw's per-request error tagging uses different
        // pass/fail semantics (e.g. isResponseStatusExpected()'s allowances for
        // known-benign 404s/redirects) than the error rate the Executor page
        // showed live/at completion, which was recorded straight from the run
        // itself. Recomputing it here made the report silently diverge from what
        // the user already saw on the Executor page for this exact execution.
        // Merge — requestsRaw is authoritative for these fields
        metrics = {
            ...(metrics ?? {}),
            p50: grafanaMetrics.p50,
            p90: grafanaMetrics.p90,
            p95: grafanaMetrics.p95,
            p99: grafanaMetrics.p99,
            avg: grafanaMetrics.avgResponseTime,
            rps: grafanaMetrics.rps,
            errorRate: metrics?.errorRate ?? grafanaMetrics.errorRate * 100,
            maxVUs: grafanaMetrics.maxVUs || metrics?.maxVUs || 0,
            totalRequests: grafanaMetrics.requestCount,
        };
    }
    return res.json({
        execution: { ...exec, metrics, responseTimeSeries },
        spec,
        metricsSource,
        summary: {
            status: exec.status,
            duration: exec.duration,
            environment: exec.environment,
            maxVUs: metrics?.maxVUs ?? null,
            totalRequests: metrics?.totalRequests ?? null,
            errorRate: metrics?.errorRate ?? null,
            thresholdBreaches: exec.thresholdBreaches,
        },
        metrics,
        grafanaMetrics, // full requestsRaw-derived object (8 Grafana labels + per-endpoint table)
        thresholdResults: exec.thresholdResults,
        checkResults: exec.checkResults,
        responseTimeSeries,
        slos: exec.slos ?? [],
        sloResults: exec.sloResults ?? {},
    });
});
exports.default = router;
