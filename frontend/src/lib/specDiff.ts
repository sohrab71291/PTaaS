import { Stage, EnvVar } from './testProfiles';

// Snapshot of every test-suite field that materially affects the generated
// k6 script — captured whenever a script is generated (or loaded from a
// saved suite) so later edits can be diffed against it.
export interface ScriptSpecSnapshot {
  name: string;
  request: {
    method: string;
    url: string;
    headers: { key: string; value: string }[];
    payload: string | null;
    auth: { type: string; tokenSecret?: string; headerName?: string };
  };
  checks: string[];
  thresholds: Record<string, { condition: string; abortOnFail?: boolean }[]>;
  profileType: 'staged' | 'constant';
  stages: Stage[];
  constantVus: number;
  constantDuration: string;
  envVars: EnvVar[];
  slos: any[];
  testType: string | null;
  complexity: string;
}

export function buildScriptSpecSnapshot(input: ScriptSpecSnapshot): ScriptSpecSnapshot {
  // Deep-clone via JSON round-trip so later mutations to live state can't
  // reach back into the snapshot.
  return JSON.parse(JSON.stringify(input));
}

// Produces a human-readable, bulleted list of exactly what changed between
// two snapshots — fed straight into the /api/ai-refine prompt so the AI is
// told precisely what to touch instead of being asked to regenerate the
// whole script from scratch.
export function computeSpecDiff(prev: ScriptSpecSnapshot, next: ScriptSpecSnapshot): string[] {
  const diffs: string[] = [];

  if (prev.name !== next.name) {
    diffs.push(`Test name changed from "${prev.name}" to "${next.name}"`);
  }

  // Request
  if (prev.request.method !== next.request.method) {
    diffs.push(`HTTP method changed from ${prev.request.method} to ${next.request.method}`);
  }
  if (prev.request.url !== next.request.url) {
    diffs.push(`Request URL changed from "${prev.request.url}" to "${next.request.url}"`);
  }
  if (JSON.stringify(prev.request.payload) !== JSON.stringify(next.request.payload)) {
    diffs.push(
      next.request.payload
        ? `Request payload changed to: ${next.request.payload}`
        : 'Request payload was removed'
    );
  }
  if (JSON.stringify(prev.request.auth) !== JSON.stringify(next.request.auth)) {
    diffs.push(`Authentication changed from "${prev.request.auth.type}" to "${next.request.auth.type}"${next.request.auth.type !== 'none' ? ` (secret name: ${next.request.auth.tokenSecret || 'n/a'}${next.request.auth.headerName ? `, header: ${next.request.auth.headerName}` : ''})` : ''}`);
  }
  const prevHeaders = new Map(prev.request.headers.map(h => [h.key, h.value]));
  const nextHeaders = new Map(next.request.headers.map(h => [h.key, h.value]));
  for (const [key, value] of nextHeaders) {
    if (!prevHeaders.has(key)) diffs.push(`Header added: "${key}: ${value}"`);
    else if (prevHeaders.get(key) !== value) diffs.push(`Header "${key}" changed from "${prevHeaders.get(key)}" to "${value}"`);
  }
  for (const key of prevHeaders.keys()) {
    if (!nextHeaders.has(key)) diffs.push(`Header removed: "${key}"`);
  }

  // Checks
  const prevChecks = prev.checks.filter(c => c.trim());
  const nextChecks = next.checks.filter(c => c.trim());
  for (const c of nextChecks) if (!prevChecks.includes(c)) diffs.push(`Check added: "${c}"`);
  for (const c of prevChecks) if (!nextChecks.includes(c)) diffs.push(`Check removed: "${c}"`);

  // Thresholds
  const prevThresh = prev.thresholds;
  const nextThresh = next.thresholds;
  for (const [metric, conditions] of Object.entries(nextThresh)) {
    const cond = conditions[0]?.condition;
    const prevCond = prevThresh[metric]?.[0]?.condition;
    if (prevCond === undefined) diffs.push(`Threshold added for "${metric}": ${cond}`);
    else if (prevCond !== cond) diffs.push(`Threshold for "${metric}" changed from "${prevCond}" to "${cond}"`);
    const abortNext = !!conditions[0]?.abortOnFail;
    const abortPrev = !!prevThresh[metric]?.[0]?.abortOnFail;
    if (prevCond !== undefined && abortPrev !== abortNext) {
      diffs.push(`Threshold "${metric}" abort-on-fail changed to ${abortNext}`);
    }
  }
  for (const metric of Object.keys(prevThresh)) {
    if (!(metric in nextThresh)) diffs.push(`Threshold removed for "${metric}"`);
  }

  // Load profile
  if (prev.profileType !== next.profileType) {
    diffs.push(`Load profile type changed from "${prev.profileType}" to "${next.profileType}"`);
  }
  if (next.profileType === 'staged') {
    if (JSON.stringify(prev.stages) !== JSON.stringify(next.stages)) {
      diffs.push(`Load profile stages changed to: ${next.stages.map(s => `${s.target} VUs for ${s.duration}`).join(', ')}`);
    }
  } else {
    if (prev.constantVus !== next.constantVus || prev.constantDuration !== next.constantDuration) {
      diffs.push(`Constant load changed to ${next.constantVus} VUs for ${next.constantDuration}`);
    }
  }

  // Env vars
  const prevEnv = new Map(prev.envVars.filter(e => e.key.trim()).map(e => [e.key, e.value]));
  const nextEnv = new Map(next.envVars.filter(e => e.key.trim()).map(e => [e.key, e.value]));
  for (const [key, value] of nextEnv) {
    if (!prevEnv.has(key)) diffs.push(`Env variable added: ${key}=${value}`);
    else if (prevEnv.get(key) !== value) diffs.push(`Env variable "${key}" changed from "${prevEnv.get(key)}" to "${value}"`);
  }
  for (const key of prevEnv.keys()) {
    if (!nextEnv.has(key)) diffs.push(`Env variable removed: ${key}`);
  }

  // SLOs — summarized rather than itemized field-by-field (structure varies)
  if (JSON.stringify(prev.slos) !== JSON.stringify(next.slos)) {
    diffs.push('SLO/SLA targets were changed');
  }

  // Test type / complexity (informational — mainly affects narrative comments)
  if (prev.testType !== next.testType) {
    diffs.push(`Test type changed from "${prev.testType ?? 'unset'}" to "${next.testType ?? 'unset'}"`);
  }
  if (prev.complexity !== next.complexity) {
    diffs.push(`Script complexity changed from "${prev.complexity}" to "${next.complexity}"`);
  }

  return diffs;
}
