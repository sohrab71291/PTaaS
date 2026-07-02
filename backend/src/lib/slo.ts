export type SloMetric = 'p50' | 'p90' | 'p95' | 'p99' | 'avg' | 'errorRate' | 'throughput';
export type SloOperator = 'lte' | 'gte';
export type SloType = 'slo' | 'sla';

export interface SloDefinition {
  id: string;
  label: string;
  metric: SloMetric;
  operator: SloOperator;
  target: number;
  unit: 'ms' | '%' | 'rps';
  type: SloType;
}

export interface SloResult extends SloDefinition {
  actual: number | null;
  passed: boolean;
}

export interface SloResults {
  overall: 'pass' | 'fail' | 'none';
  results: SloResult[];
  evaluatedAt: string;
}

/** Extract the numeric metric value from the final metrics object. */
function getActual(metric: SloMetric, metrics: Record<string, any>): number | null {
  switch (metric) {
    case 'p50':        return metrics.p50  ?? null;
    case 'p90':        return metrics.p90  ?? null;
    case 'p95':        return metrics.p95  ?? null;
    case 'p99':        return metrics.p99  ?? null;
    case 'avg':        return metrics.avg  ?? null;
    // errorRate stored as 0–1 fraction in DB; convert to %
    case 'errorRate':  return metrics.errorRate != null ? metrics.errorRate * 100 : null;
    case 'throughput': return metrics.rps  ?? null;
    default:           return null;
  }
}

/** Evaluate a list of SLO definitions against the execution's final metrics. */
export function evaluateSlos(slos: SloDefinition[], metrics: Record<string, any> | null): SloResults {
  if (!slos.length || !metrics) {
    return { overall: 'none', results: [], evaluatedAt: new Date().toISOString() };
  }

  const results: SloResult[] = slos.map(slo => {
    const actual = getActual(slo.metric, metrics);
    let passed = false;
    if (actual !== null) {
      passed = slo.operator === 'lte' ? actual <= slo.target : actual >= slo.target;
    }
    return { ...slo, actual, passed };
  });

  const overall = results.every(r => r.actual === null)
    ? 'none'
    : results.every(r => r.passed)
      ? 'pass'
      : 'fail';

  return { overall, results, evaluatedAt: new Date().toISOString() };
}
