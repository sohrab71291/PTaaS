import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import * as XLSX from 'xlsx';
import * as path from 'path';
import {
  getAnthropicClient, hasAnthropicCredentials, isOverloadedError,
  CLAUDE_MODEL, MAX_STREAM_ATTEMPTS, STREAM_BACKOFF_MS, stripCodeFences,
} from '../services/anthropicClient';
import { buildInfluxAndAuthBlock } from '../services/k6PromptBlocks';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Parse uploaded file into readable text content
function parseFileToText(buffer: Buffer, originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  if (['.csv', '.xls', '.xlsx'].includes(ext)) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const results: string[] = [];
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      results.push(`Sheet: ${sheetName}\n${JSON.stringify(data, null, 2)}`);
    });
    return results.join('\n\n');
  }
  if (ext === '.json') {
    try {
      const parsed = JSON.parse(buffer.toString('utf8'));
      return JSON.stringify(parsed, null, 2);
    } catch {
      return buffer.toString('utf8');
    }
  }
  // YAML, TXT, HAR, or any other text format — pass through as-is
  return buffer.toString('utf8');
}

// Test case files (CSV/XLSX/JSON/pasted text) often list full URLs per row.
// Pull the origin out of the first absolute URL we find so the AI uses it as BASE_URL.
function detectBaseUrl(content: string): string | null {
  const match = content.match(/https?:\/\/[^\s"'`,)]+/);
  if (!match) return null;
  try {
    return new URL(match[0]).origin;
  } catch {
    return null;
  }
}

function describeBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) return '';
  return `\nMANDATORY BASE_URL — the uploaded test case data references "${baseUrl}". Use this as the BASE_URL default (see rule 4 and the InfluxDB integration block below) — do NOT default to localhost.\n`;
}

interface LoadProfileConfig {
  profileType: 'staged' | 'constant';
  stages?: { target: number; duration: string }[];
  constantVus?: number;
  constantDuration?: string;
}

function describeLoadProfile(profile: LoadProfileConfig | null): string {
  if (!profile) return '';
  if (profile.profileType === 'constant') {
    return `\nMANDATORY LOAD PROFILE — the user explicitly configured this; use it exactly, do not invent your own:
- Constant load: ${profile.constantVus ?? 10} VUs for ${profile.constantDuration ?? '1m'}.
- Every scenario's executor must be 'constant-vus' with vus: ${profile.constantVus ?? 10} and duration: '${profile.constantDuration ?? '1m'}'.\n`;
  }
  const stages = profile.stages && profile.stages.length > 0
    ? profile.stages
    : [{ target: 10, duration: '2m' }, { target: 10, duration: '5m' }, { target: 0, duration: '2m' }];
  const stagesList = stages.map(s => `    { target: ${s.target}, duration: '${s.duration}' },`).join('\n');
  return `\nMANDATORY LOAD PROFILE — the user explicitly configured this; use it exactly, do not invent your own:
- Ramping load with these exact stages (every scenario's executor must be 'ramping-vus' using this stages array verbatim):
  stages: [
${stagesList}
  ]\n`;
}

function describeEnvVarKeys(keys: string[]): string {
  if (!keys.length) return '';
  return `\nADDITIONAL ENV VARS — the user pre-declared these names; reference any that are relevant via __ENV.<NAME> (e.g. auth tokens, tenant ids) instead of hardcoding values: ${keys.join(', ')}\n`;
}

interface SpecContext {
  name: string;
  description?: string;
  tags?: string[];
  request: {
    method: string;
    url: string;
    headers: { key: string; value: string }[];
    payload: string | null;
    auth: { type: string; tokenSecret?: string; headerName?: string };
  };
  checks: string[];
  thresholds: Record<string, { condition: string; abortOnFail?: boolean }[]>;
  slos: any[];
}

function describeSpecContext(ctx: SpecContext | null): string {
  if (!ctx) return '';

  const lines: string[] = ['\nTEST SUITE CONTEXT — from the Test Authoring form. Test case data takes priority for'];
  lines.push('per-row specifics; use this to fill in anything the test case data leaves unspecified:');
  lines.push(`- Test Name: ${ctx.name || '(untitled)'}`);
  if (ctx.description) lines.push(`- Description: ${ctx.description}`);
  if (ctx.tags?.length) lines.push(`- Tags: ${ctx.tags.join(', ')}`);

  if (ctx.request) {
    const r = ctx.request;
    lines.push(`- Default request: ${r.method} ${r.url}`);
    if (r.headers?.length) {
      lines.push(`  Headers: ${r.headers.map(h => `${h.key}: ${h.value}`).join(', ')}`);
    }
    if (r.payload) lines.push(`  Payload template: ${r.payload}`);
    if (r.auth && r.auth.type !== 'none') {
      lines.push(`  Auth: ${r.auth.type}${r.auth.tokenSecret ? ` — secret name __ENV.${r.auth.tokenSecret}` : ''}${r.auth.headerName ? `, header "${r.auth.headerName}"` : ''}`);
    }
  }

  const checks = (ctx.checks ?? []).filter(c => c && c.trim());
  if (checks.length) {
    lines.push(`- MANDATORY checks (every request must include check() assertions covering these): ${checks.join(' | ')}`);
  }

  const thresholdEntries = Object.entries(ctx.thresholds ?? {});
  if (thresholdEntries.length) {
    const rendered = thresholdEntries.map(([metric, conds]) => `${metric}: ${conds.map(c => c.condition).join(', ')}`).join(' | ');
    lines.push(`- MANDATORY thresholds (use these exact conditions in options.thresholds instead of the defaults in rule 11): ${rendered}`);
  }

  if (ctx.slos?.length) {
    const rendered = ctx.slos.map((s: any) => `${s.label || s.metric} ${s.operator === 'lte' ? '<=' : '>='} ${s.target}${s.unit || ''}`).join(' | ');
    lines.push(`- SLO/SLA targets (reflect these in thresholds where the metric maps to a k6 threshold, e.g. p95/error rate): ${rendered}`);
  }

  return lines.join('\n') + '\n';
}

function buildSystemPrompt(
  testType: string,
  complexity: string,
  loadProfile: LoadProfileConfig | null,
  envVarKeys: string[],
  baseUrl: string | null,
  specContext: SpecContext | null,
): string {
  return `You are an expert performance engineer specializing in k6 load testing with InfluxDB v2 integration. Analyze the provided test case data and generate a complete, production-ready k6 JavaScript script.

Test Type: ${testType}
Complexity: ${complexity}
${describeLoadProfile(loadProfile)}${describeEnvVarKeys(envVarKeys)}${describeBaseUrl(baseUrl)}${describeSpecContext(specContext)}

MANDATORY RULES — every rule must be followed exactly:
1. Output ONLY valid JavaScript — no markdown, no code fences, no explanation text.
2. Start with imports, end with handleSummary export.
3. Include the full InfluxDB v2 integration block shown below, word for word.
4. Use __ENV.BASE_URL for all request base URLs, defaulting to ${baseUrl ? `'${baseUrl}' (see MANDATORY BASE_URL above — this came from the uploaded test case data, do NOT use localhost)` : `'http://localhost:3000'`}.
5. All secrets and tokens use __ENV.VAR_NAME — never hardcoded values.
6. Every HTTP request is wrapped in a named group().
7. Every endpoint has its own Trend metric (e.g. loginTrend, createOrderTrend).
8. Every request has check() for status code AND response time.
9. Include sleep(1) between logical steps within an iteration.
10. Use options.scenarios with ramping-vus executor and explicit exec function names.
11. Set thresholds from test case data or sensible defaults (p(95)<800, rate<0.05).
12. SCENARIO_MAX_VUS must be computed with Math.max and ?? (not ||): const SCENARIO_MAX_VUS = Math.max(...Object.values(options.scenarios).flatMap(s => (s.stages||[]).map(st => st.target ?? 0)), 1);
13. Auth tokens: extract defensively — const token = (body.token ?? body.sessionToken ?? body.access_token ?? (body.data && body.data.token) ?? '');
14. All test data that must be unique per VU/iteration (names, emails, usernames) must embed __VU and __ITER: e.g. 'user_' + __VU + '_' + __ITER + '@example.com'.
15. Use ?? instead of || when the right-hand side is a fallback for null/undefined (stage.target ?? 0, not stage.target || 0).
16. handleSummary must output ONLY stdout — do NOT write any file (no summary.json).
17. If the test cases require authentication (a login/token endpoint), perform the login ONCE in setup() — never per-VU or per-iteration — and pass the resulting session token to exec functions via setup()'s return value. See AUTHENTICATION PATTERN below; this is mandatory whenever a login step exists, to avoid concurrent-login failures under load.

${buildInfluxAndAuthBlock(baseUrl)}
════════════════════════════════════════════════════════════════

TEST TYPE LOAD SHAPES (fallback only — ignore this section if a MANDATORY LOAD PROFILE was given above; that one wins):
- "Smoke Test": 1-3 VUs, 1m duration
- "Load Test": ramp 2m → sustain 8m → ramp-down 2m
- "Stress Test": ramp to 2× normal, sustain 5m, find breaking point
- "Spike Test": burst to max 1m, drop, repeat 3 cycles
- "Soak Test": low-medium VUs for 30-60m (memory leak detection)
- "Volume Test": moderate VUs, high iteration count

COMPLEXITY LEVELS:
- "Simple": single default function, sequential endpoints, basic checks
- "Standard": separate exec functions, custom per-endpoint Trend metrics, weighted scenarios
- "Advanced": full scenario matrix, per-scenario thresholds, data parameterization, detailed error handling

Generate the k6 script now. Output ONLY JavaScript, starting with the first import line.`;
}

// POST /api/ai-generate — streaming SSE endpoint
router.post('/ai-generate', upload.single('file'), async (req: Request, res: Response) => {
  const { testType, complexity, pastedContent, loadProfile: loadProfileRaw, envVarKeys: envVarKeysRaw, specContext: specContextRaw } = req.body;

  let loadProfile: LoadProfileConfig | null = null;
  try { loadProfile = loadProfileRaw ? JSON.parse(loadProfileRaw) : null; } catch {}
  let envVarKeys: string[] = [];
  try { envVarKeys = envVarKeysRaw ? JSON.parse(envVarKeysRaw) : []; } catch {}
  let specContext: SpecContext | null = null;
  try { specContext = specContextRaw ? JSON.parse(specContextRaw) : null; } catch {}

  if (!hasAnthropicCredentials()) {
    res.status(500).json({
      error: 'Anthropic API credentials not configured. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in backend/.env or as an environment variable.',
    });
    return;
  }

  if (!req.file && !pastedContent) {
    res.status(400).json({ error: 'No file or content provided' });
    return;
  }

  // Parse the uploaded file into text Claude can read
  let fileContent = '';
  if (req.file) {
    try {
      fileContent = parseFileToText(req.file.buffer, req.file.originalname);
    } catch (err: any) {
      res.status(400).json({ error: `Failed to parse file: ${err.message}` });
      return;
    }
  } else {
    fileContent = pastedContent;
  }

  const detectedBaseUrl = detectBaseUrl(fileContent) ?? detectBaseUrl(specContext?.request?.url ?? '');
  const userMessage = `Here are the test cases to analyze and convert into a k6 performance test script:\n\n\`\`\`\n${fileContent}\n\`\`\`\n\nGenerate a ${testType} k6 script at ${complexity} complexity level based on these test cases. Output ONLY the JavaScript code.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (type: string, data: any) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    sendEvent('status', { message: `Analyzing ${req.file ? req.file.originalname : 'content'} with Claude…` });

    let stream: Awaited<ReturnType<Anthropic['messages']['stream']>> | null = null;
    for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt++) {
      try {
        stream = await getAnthropicClient().messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 8096,
          system: buildSystemPrompt(testType || 'Load Test', complexity || 'Standard', loadProfile, envVarKeys, detectedBaseUrl, specContext),
          messages: [{ role: 'user', content: userMessage }],
        });
        break;
      } catch (err: any) {
        if (isOverloadedError(err) && attempt < MAX_STREAM_ATTEMPTS - 1) {
          sendEvent('status', { message: `Claude is currently overloaded — retrying (${attempt + 1}/${MAX_STREAM_ATTEMPTS - 1})…` });
          await new Promise(r => setTimeout(r, STREAM_BACKOFF_MS[attempt]));
          continue;
        }
        throw err;
      }
    }
    if (!stream) throw new Error('Failed to start generation after retries');

    let fullScript = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        const text = chunk.delta.text;
        fullScript += text;
        sendEvent('chunk', { text });
      }
    }
    fullScript = stripCodeFences(fullScript);

    sendEvent('complete', { script: fullScript });
    res.end();
  } catch (err: any) {
    if (err.name === 'AbortError') { res.end(); return; }
    if (err.status === 401) {
      sendEvent('error', { message: 'Invalid Anthropic API key. Check your ANTHROPIC_API_KEY.' });
    } else if (err.status === 429) {
      sendEvent('error', { message: 'Rate limit reached. Please wait a moment and try again.' });
    } else if (isOverloadedError(err)) {
      sendEvent('error', { message: "Claude's servers are overloaded right now. We retried a few times but it didn't recover — please try again in a minute." });
    } else {
      sendEvent('error', { message: err.message || 'AI generation failed' });
    }
    res.end();
  }
});

export default router;
