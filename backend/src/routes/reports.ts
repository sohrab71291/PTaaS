import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { queryExecutionFromInflux, queryFromRequestsRaw } from '../services/influxdb';

const router = Router();

router.get('/:executionId', async (req: Request, res: Response) => {
  const exec = await prisma.execution.findUnique({ where: { id: req.params.executionId } });
  if (!exec) return res.status(404).json({ error: 'Not found' });

  const spec = exec.specId
    ? await prisma.testSpec.findUnique({ where: { id: exec.specId } })
    : null;

  let metrics: any        = exec.metrics ?? null;
  let responseTimeSeries  = exec.responseTimeSeries as any[];
  let metricsSource: 'db' | 'influxdb' | 'requestsRaw' = 'db';

  // ── Primary: query requestsRaw (same source as Grafana) ──────────────────────
  // This runs in parallel with the k6_execution fallback.
  const [grafanaMetrics, influxFallback] = await Promise.all([
    exec.startedAt
      ? queryFromRequestsRaw(exec.startedAt, exec.finishedAt).catch(() => null)
      : Promise.resolve(null),
    // Fallback: k6_execution summary (for metrics DB already has)
    (!metrics || !(metrics as any).p95) && exec.startedAt
      ? queryExecutionFromInflux(exec.startedAt, exec.finishedAt).catch(() => null)
      : Promise.resolve(null),
  ]);

  // If requestsRaw has data, use it as the response time series source (matches Grafana chart)
  if (grafanaMetrics && grafanaMetrics.timeSeries.length > 0) {
    responseTimeSeries = grafanaMetrics.timeSeries;
  }

  // Fill missing DB metrics from k6_execution fallback
  const missingMetrics = !metrics || !(metrics as any).p95;
  if (missingMetrics && influxFallback) {
    metrics = influxFallback.metrics;
    metricsSource = 'influxdb';
    await prisma.execution.update({
      where: { id: exec.id },
      data: { metrics: influxFallback.metrics as any, responseTimeSeries: influxFallback.timeSeries as any },
    }).catch(() => {});
  }

  // If requestsRaw produced richer metrics, promote them to the main metrics object
  if (grafanaMetrics) {
    metricsSource = 'requestsRaw';
    // Merge — requestsRaw is authoritative for these fields
    metrics = {
      ...(metrics ?? {}),
      p50:           grafanaMetrics.p50,
      p90:           grafanaMetrics.p90,
      p95:           grafanaMetrics.p95,
      p99:           grafanaMetrics.p99,
      avg:           grafanaMetrics.avgResponseTime,
      rps:           grafanaMetrics.rps,
      errorRate:     grafanaMetrics.errorRate * 100, // store as % for consistency with rest of app
      maxVUs:        grafanaMetrics.maxVUs || (metrics as any)?.maxVUs || 0,
      totalRequests: grafanaMetrics.requestCount,
    };
  }

  return res.json({
    execution: { ...exec, metrics, responseTimeSeries },
    spec,
    metricsSource,
    summary: {
      status:            exec.status,
      duration:          exec.duration,
      environment:       exec.environment,
      maxVUs:            (metrics as any)?.maxVUs         ?? null,
      totalRequests:     (metrics as any)?.totalRequests  ?? null,
      errorRate:         (metrics as any)?.errorRate      ?? null,
      thresholdBreaches: exec.thresholdBreaches,
    },
    metrics,
    grafanaMetrics,   // full requestsRaw-derived object (8 Grafana labels + per-endpoint table)
    thresholdResults:   exec.thresholdResults,
    checkResults:       exec.checkResults,
    responseTimeSeries,
    slos:               (exec as any).slos       ?? [],
    sloResults:         (exec as any).sloResults ?? {},
  });
});

export default router;
