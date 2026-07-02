import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { queryDashboardTrends } from '../services/influxdb';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const [executions, specs, trends] = await Promise.all([
    prisma.execution.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.testSpec.findMany(),
    queryDashboardTrends(),
  ]);

  const recentExecutions = executions.filter(e => e.status !== 'scheduled').slice(0, 8);

  const finished  = executions.filter(e => e.status === 'pass' || e.status === 'fail');
  const scheduled = executions.filter(e => e.status === 'scheduled').length;

  const lastFinished = finished[0] ?? null;
  const lastRun = lastFinished ? {
    name:              lastFinished.specName,
    status:            lastFinished.status,
    p95:               (lastFinished.metrics as any)?.p95,
    maxVUs:            (lastFinished.metrics as any)?.maxVUs,
    thresholdBreaches: lastFinished.thresholdBreaches,
    environment:       lastFinished.environment,
    ranAt:             lastFinished.startedAt,
    sloResults:        (lastFinished as any).sloResults ?? null,
  } : null;

  // Stats derived from actual execution results (last 30 days) — live feed.
  const cutoff30d   = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent30    = finished.filter(e => e.startedAt && e.startedAt >= cutoff30d);
  const passing     = recent30.filter(e => e.status === 'pass').length;
  const failing     = recent30.filter(e => e.status === 'fail').length;
  const healthScore = (passing + failing) > 0
    ? Math.round((passing / (passing + failing)) * 100)
    : 0;

  const responseTimeTrend = (trends ?? []).map(t => ({ day: t.day, p95: t.p95, p50: t.p50, threshold: 500 }));
  const errorRateTrend    = (trends ?? []).map(t => ({ day: t.day, rate: t.errorRate }));
  const throughputData    = (trends ?? []).map(t => ({ day: t.day, rps: t.rps }));
  const thresholdBreachHistory = (trends ?? []).map(t => ({ day: t.day, breaches: t.breaches }));

  res.json({
    lastRun,
    healthScore,
    stats: { passing, failing, warning: 0, scheduled },
    recentExecutions,
    responseTimeTrend,
    errorRateTrend,
    throughputData,
    thresholdBreachHistory,
    influxConnected: trends !== null,
    activeTests: executions.filter(e => e.status === 'running'),
    scheduledTests: executions.filter(e => e.status === 'scheduled'),
  });
});

export default router;
