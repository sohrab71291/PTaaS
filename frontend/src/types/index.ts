export interface Header {
  key: string;
  value: string;
}

export interface Stage {
  duration: string;
  target: number;
}

export interface LoadProfile {
  type: 'staged' | 'constant' | 'arrival-rate';
  stages: Stage[];
  thinkTime: number;
  constantVus?: number;
  constantDuration?: string;
}

export interface ThresholdCondition {
  condition: string;
  abortOnFail: boolean;
}

export interface RequestConfig {
  url: string;
  method: string;
  headers: Header[];
  payload: string | null;
  auth: {
    type: 'none' | 'bearer' | 'apikey' | 'basic';
    tokenSecret?: string;
    headerName?: string;
    username?: string;
    passwordSecret?: string;
  };
}

export interface TestSpec {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  request: RequestConfig;
  loadProfile: LoadProfile;
  thresholds: Record<string, ThresholdCondition[]>;
  checks: string[];
  environmentId: string;
  generatedScript?: string | null;
  slos?: import('./slo').SloDefinition[];
  testType?: string | null;
  complexity?: string | null;
  envVars?: { key: string; value: string }[];
  lastRunStatus: 'pass' | 'fail' | 'running' | 'scheduled' | null;
  lastRunAt: string | null;
  scheduledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThresholdResult {
  metric: string;
  condition: string;
  actual: string;
  passed: boolean;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  passRate: number;
}

export interface TimePoint {
  time: string;
  p50: number;
  p95: number;
}

export interface ExecutionMetrics {
  p50: number;
  p90: number;
  p95: number;
  p99: number | null;
  errorRate: number;
  rps: number;
  maxVUs: number;
  totalRequests: number;
}

export interface Execution {
  id: string;
  specId: string;
  specName: string;
  environment: string;
  status: 'pass' | 'fail' | 'running' | 'scheduled';
  triggeredBy: string;
  startedAt: string | null;
  finishedAt: string | null;
  scheduledFor?: string;
  duration: number | null;
  errorMessage?: string | null;
  metrics: ExecutionMetrics | null;
  thresholdBreaches: number;
  checksPassed: number;
  checksFailed: number;
  thresholdResults: ThresholdResult[];
  checkResults: CheckResult[];
  responseTimeSeries: TimePoint[];
}

export interface EnvVariable {
  key: string;
  value: string;
}

export interface Environment {
  id: string;
  name: string;
  baseUrl: string;
  variables: EnvVariable[];
  secrets: string[];
  requiresApproval: boolean;
  executionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Secret {
  id: string;
  name: string;
  backend: 'vault' | 'aws-secretsmanager' | 'env' | 'azure-keyvault';
  backendPath: string;
  environments: string[];
  lastRotated: string;
  expiresAt: string | null;
  status: 'active' | 'expiring-soon' | 'expired' | 'error';
  createdAt: string;
}

export interface DashboardData {
  lastRun: {
    name: string;
    status: string;
    p95: number;
    maxVUs: number;
    thresholdBreaches: number;
    environment: string;
    ranAt: string;
    sloResults?: import('./slo').SloResults | null;
  } | null;
  healthScore: number;
  stats: {
    passing: number;
    failing: number;
    warning: number;
    scheduled: number;
  };
  recentExecutions: Execution[];
  responseTimeTrend: Array<{ day: string; p95: number; p50: number; threshold: number }>;
  errorRateTrend: Array<{ day: string; rate: number }>;
  throughputData: Array<{ day: string; rps: number }>;
  thresholdBreachHistory: Array<{ day: string; breaches: number }>;
  activeTests: Execution[];
  scheduledTests: Execution[];
}
