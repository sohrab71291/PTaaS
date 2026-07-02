"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateSlos = evaluateSlos;
/** Extract the numeric metric value from the final metrics object. */
function getActual(metric, metrics) {
    switch (metric) {
        case 'p50': return metrics.p50 ?? null;
        case 'p90': return metrics.p90 ?? null;
        case 'p95': return metrics.p95 ?? null;
        case 'p99': return metrics.p99 ?? null;
        case 'avg': return metrics.avg ?? null;
        // errorRate stored as 0–1 fraction in DB; convert to %
        case 'errorRate': return metrics.errorRate != null ? metrics.errorRate * 100 : null;
        case 'throughput': return metrics.rps ?? null;
        default: return null;
    }
}
/** Evaluate a list of SLO definitions against the execution's final metrics. */
function evaluateSlos(slos, metrics) {
    if (!slos.length || !metrics) {
        return { overall: 'none', results: [], evaluatedAt: new Date().toISOString() };
    }
    const results = slos.map(slo => {
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
