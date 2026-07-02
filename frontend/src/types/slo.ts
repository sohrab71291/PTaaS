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

export const SLO_METRIC_OPTIONS: { value: SloMetric; label: string; defaultUnit: 'ms' | '%' | 'rps'; defaultOp: SloOperator; defaultTarget: number }[] = [
  { value: 'p50',        label: 'P50 Response Time', defaultUnit: 'ms',  defaultOp: 'lte', defaultTarget: 200  },
  { value: 'p90',        label: 'P90 Response Time', defaultUnit: 'ms',  defaultOp: 'lte', defaultTarget: 400  },
  { value: 'p95',        label: 'P95 Response Time', defaultUnit: 'ms',  defaultOp: 'lte', defaultTarget: 500  },
  { value: 'p99',        label: 'P99 Response Time', defaultUnit: 'ms',  defaultOp: 'lte', defaultTarget: 1000 },
  { value: 'avg',        label: 'Avg Response Time', defaultUnit: 'ms',  defaultOp: 'lte', defaultTarget: 300  },
  { value: 'errorRate',  label: 'Error Rate',        defaultUnit: '%',   defaultOp: 'lte', defaultTarget: 1    },
  { value: 'throughput', label: 'Throughput (RPS)',  defaultUnit: 'rps', defaultOp: 'gte', defaultTarget: 10   },
];
