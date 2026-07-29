import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import * as XLSX from 'xlsx';
import * as path from 'path';
import {
  getAnthropicClient, hasAnthropicCredentials, isOverloadedError,
  CLAUDE_MODEL, MAX_STREAM_ATTEMPTS, STREAM_BACKOFF_MS, stripCodeFences,
} from '../services/anthropicClient';
import {
  buildInfluxBlock, buildGenericAuthPatternBlock, buildCsvCredentialAuthPatternBlock, HANDLE_SUMMARY_BLOCK,
  buildModuleRecordAccessPatternBlock,
  DATA_PLACEHOLDER, injectCapturedData, extractCapturedData, injectCredentials,
  extractCredentials, injectCredentialsBlock,
} from '../services/k6PromptBlocks';
import { fetchScriptCredentials } from '../services/credentialStore';
import { isBraceBalanced } from '../services/k6ScriptValidator';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

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
  useCsvCredentials: boolean,
  hasModuleRecordAccessCall: boolean,
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
10. Declare 'export const options = { scenarios: {...}, thresholds: {...} };' EXACTLY ONCE, using 'const' (never 'let'/'var') — a script with more than one export named 'options' fails to load entirely with "Duplicate export name 'options'" before any request runs. Use options.scenarios with ramping-vus executor and explicit exec function names, and put thresholds in that SAME object literal — never a second options block later.
11. Set thresholds from test case data or sensible defaults (p(95)<800, rate<0.05).
12. SCENARIO_MAX_VUS must be computed with Math.max and ?? (not ||): const SCENARIO_MAX_VUS = Math.max(...Object.values(options.scenarios).flatMap(s => (s.stages||[]).map(st => st.target ?? 0)), 1);
13. Auth tokens: extract defensively — const token = (body.token ?? body.sessionToken ?? body.access_token ?? (body.data && body.data.token) ?? '');
14. All test data that must be unique per VU/iteration (names, emails, usernames) must embed __VU and __ITER: e.g. 'user_' + __VU + '_' + __ITER + '@example.com'.
15. Use ?? instead of || when the right-hand side is a fallback for null/undefined (stage.target ?? 0, not stage.target || 0).
16. handleSummary must output ONLY stdout — do NOT write any file (no summary.json).
17. ${useCsvCredentials
    ? 'Login credentials come from an uploaded CSV pool (one login per VU) — see the CSV-BASED PER-VU CREDENTIALS pattern below. This is MANDATORY: do not write a shared setup() login for this script; every VU must authenticate independently via ensureAuth(), and the getVuCredential()/ensureAuth()/reauth() helper functions from that pattern must be reproduced verbatim, including the REQUIRED InstanceName field in the login payload — do not simplify, rename, or omit it. RE-AUTH ON 401/403 IS MANDATORY: reauth() must be called on a 401/403 response and the SAME request retried exactly once with the refreshed headers — never treat a 401/403 as a silent pass, and never retry more than once (a second consecutive 401/403 is a real failure).'
    : 'If the test cases require authentication (a login/token endpoint), perform the login ONCE in setup() — never per-VU or per-iteration — and pass the resulting session token to exec functions via setup()\'s return value. See AUTHENTICATION PATTERN below; this is mandatory whenever a login step exists, to avoid concurrent-login failures under load. RE-AUTH ON 401/403 IS ALSO MANDATORY — reproduce the reauthenticate() helper and the retry-once-on-401/403 pattern shown in AUTHENTICATION PATTERN below verbatim; a 401/403 must never be silently treated as a pass, and never retried more than once.'}
${hasModuleRecordAccessCall ? `18. GetModuleRecordAccess CSRF PROPAGATION IS MANDATORY — the .../api/internal/Permission/GetModuleRecordAccess call's response carries a 'csrf-token' response header. Capture that exact header value into a variable right after that call, and send it as the 'x-csrf-token' request header on every authenticated call made AFTER it (not on GetModuleRecordAccess itself, and not a hardcoded/captured literal). See the GetModuleRecordAccess HEADER PATTERN block below for the required header shape on the call itself and the exact capture/propagation code. CSRF REFRESH ON REAUTH IS ALSO MANDATORY — a csrf token is bound to the session that produced it, so whichever reauth()/reauthenticate() helper rule 17 requires MUST also re-issue GetModuleRecordAccess and re-capture a fresh csrf token before the caller retries the original failed request — otherwise the retry sends a (new session, old csrf) pair, which Archer's classic /api/* gateway rejects with a generic IIS 403 that looks like a permissions error but is actually this exact mismatch. See the CSRF REFRESH ON REAUTH section of the GetModuleRecordAccess HEADER PATTERN block below.` : ''}

${buildInfluxBlock(baseUrl)}
${useCsvCredentials ? buildCsvCredentialAuthPatternBlock() : buildGenericAuthPatternBlock()}
${hasModuleRecordAccessCall ? buildModuleRecordAccessPatternBlock() : ''}
${HANDLE_SUMMARY_BLOCK}
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
  const { testType, complexity, pastedContent, loadProfile: loadProfileRaw, envVarKeys: envVarKeysRaw, specContext: specContextRaw, useCsvCredentials: useCsvCredentialsRaw, credentialBatchId } = req.body;

  let loadProfile: LoadProfileConfig | null = null;
  try { loadProfile = loadProfileRaw ? JSON.parse(loadProfileRaw) : null; } catch {}
  let envVarKeys: string[] = [];
  try { envVarKeys = envVarKeysRaw ? JSON.parse(envVarKeysRaw) : []; } catch {}
  let specContext: SpecContext | null = null;
  try { specContext = specContextRaw ? JSON.parse(specContextRaw) : null; } catch {}
  const useCsvCredentials = useCsvCredentialsRaw === true || useCsvCredentialsRaw === 'true';

  let csvCredentials: Awaited<ReturnType<typeof fetchScriptCredentials>> = [];
  if (useCsvCredentials) {
    if (typeof credentialBatchId !== 'string' || !credentialBatchId.trim()) {
      res.status(422).json({
        error: 'CSV-based credentials were requested but no credential batch was uploaded. Upload a login credentials CSV before generating the script.',
      });
      return;
    }
    csvCredentials = await fetchScriptCredentials(credentialBatchId);
    if (csvCredentials.length === 0) {
      res.status(422).json({
        error: 'The uploaded credentials CSV/batch resolved to zero usable rows (check that it has URL, Username, Password, and InstanceName columns). Re-upload a valid credentials file.',
      });
      return;
    }
  }

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
  const hasModuleRecordAccessCall = /GetModuleRecordAccess/i.test(fileContent)
    || /GetModuleRecordAccess/i.test(specContext?.request?.url ?? '');
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
          max_tokens: 16000,
          system: buildSystemPrompt(testType || 'Load Test', complexity || 'Standard', loadProfile, envVarKeys, detectedBaseUrl, specContext, useCsvCredentials, hasModuleRecordAccessCall),
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

    // Bake the real uploaded CSV rows into the script now, rather than leaving
    // the CREDENTIALS placeholder for execution time — the credentials are
    // part of the generated script, not something spliced in later.
    if (useCsvCredentials && csvCredentials.length > 0) {
      fullScript = injectCredentials(fullScript, csvCredentials);
    }

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

function buildRefineSystemPrompt(hasCapturedData: boolean): string {
  return `You are an expert performance engineer specializing in k6 load testing with InfluxDB v2 integration. You are given an existing k6 JavaScript script and a follow-up instruction describing a change the user wants made to it.

MANDATORY RULES:
1. Output ONLY the full, updated valid JavaScript script — no markdown, no code fences, no explanation text.
2. Apply the requested change precisely while preserving everything else in the script that the instruction doesn't ask you to touch.
3. Keep the script fully self-contained and runnable (imports, InfluxDB integration block, handleSummary, etc. all preserved).
4. If the instruction is ambiguous, make the most reasonable interpretation for a k6 performance test script rather than asking for clarification.
${hasCapturedData ? `5. The script contains the line ${DATA_PLACEHOLDER} in place of the real captured-request data (removed to keep this prompt a reasonable size). Leave that exact placeholder line in your output — do NOT delete it, move it, or attempt to redeclare/transcribe LOGIN_REQUEST/CAPTURED_REQUESTS yourself; the real data is spliced back in automatically afterward.` : ''}
6. THRESHOLD instructions (e.g. "Threshold for X changed/added/removed") refer to \`options.thresholds\` — this k6 script has EXACTLY ONE \`export const options = { ... }\` declaration (a second one fails to load with "Duplicate export name 'options'"). Locate that EXISTING \`thresholds\` object inside it and edit the matching key's condition array in place — do NOT add a second \`options\`/\`thresholds\` block, and do NOT touch unrelated threshold keys. If the metric key named in the instruction doesn't exist yet, add it as a new key in that SAME object.
7. CHECK instructions (e.g. "Check added/removed: ...") refer to \`check()\` calls. Scripts in this app commonly define checks in ONE of two shapes — inspect the actual script to see which applies before editing:
   (a) a single generic per-request check() (e.g. inside a shared \`replayStep()\`/\`doRequest()\` helper used for every captured call) — for a check ADD/REMOVE instruction here, modify that ONE shared check() block, since it already runs for every request; do not duplicate it per endpoint.
   (b) separate per-endpoint check() calls (one inside each named exec function) — add/remove the assertion in EVERY such check() block consistently, matching the exact key-naming convention already used by the neighboring checks in that same script (e.g. if existing keys are template strings like \`[reqDef.name + ' status is ' + ...]\`, follow that same pattern rather than inventing a different style).
   In both cases, never rename or restructure unrelated existing checks.

Output ONLY JavaScript, starting with the first import line.`;
}

async function streamRefinement(
  scriptForPrompt: string,
  prompt: string,
  hasCapturedData: boolean,
  sendEvent: (type: string, data: any) => void,
): Promise<string> {
  const userMessage = `Here is the current k6 script:\n\n\`\`\`javascript\n${scriptForPrompt}\n\`\`\`\n\nApply this change:\n"${prompt}"\n\nOutput ONLY the full updated JavaScript code.`;

  let stream: Awaited<ReturnType<Anthropic['messages']['stream']>> | null = null;
  for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt++) {
    try {
      stream = await getAnthropicClient().messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        system: buildRefineSystemPrompt(hasCapturedData),
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
  if (!stream) throw new Error('Failed to start refinement after retries');

  let fullScript = '';
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      const text = chunk.delta.text;
      fullScript += text;
      sendEvent('chunk', { text });
    }
  }
  return stripCodeFences(fullScript);
}

// Non-streaming variant of the refine flow, callable server-side (e.g. by the
// executor's auto-fix/retry loop in index.ts) rather than only from an SSE
// route driven by a browser. Reuses the exact same strip/refine/re-inject/
// brace-check pipeline as POST /api/ai-refine.
export async function autoFixScript(
  currentScript: string,
  instruction: string,
  onEvent?: (type: string, data: any) => void,
): Promise<string> {
  const extracted = extractCapturedData(currentScript);
  const scriptAfterCapturedStrip = extracted ? extracted.strippedScript : currentScript;
  const extractedCreds = extractCredentials(scriptAfterCapturedStrip);
  const scriptForPrompt = extractedCreds ? extractedCreds.strippedScript : scriptAfterCapturedStrip;
  const emit = onEvent ?? (() => {});

  const reinject = (script: string) => {
    let out = script;
    if (extracted) out = injectCapturedData(out, extracted.dataBlock);
    if (extractedCreds) out = injectCredentialsBlock(out, extractedCreds.dataBlock);
    return out;
  };

  let fullScript = reinject(await streamRefinement(scriptForPrompt, instruction, !!extracted, emit));
  if (!isBraceBalanced(fullScript)) {
    emit('status', { message: 'Generated fix failed a structural check — retrying once…' });
    fullScript = reinject(await streamRefinement(scriptForPrompt, instruction, !!extracted, emit));
    if (!isBraceBalanced(fullScript)) {
      throw new Error('Auto-fix produced a script with mismatched braces twice in a row.');
    }
  }
  return fullScript;
}

// POST /api/ai-refine — streaming SSE endpoint for iterative script tweaks
router.post('/ai-refine', async (req: Request, res: Response) => {
  const { currentScript, prompt } = req.body;

  if (!hasAnthropicCredentials()) {
    res.status(500).json({
      error: 'Anthropic API credentials not configured. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in backend/.env or as an environment variable.',
    });
    return;
  }

  if (!currentScript || !prompt) {
    res.status(400).json({ error: 'currentScript and prompt are required' });
    return;
  }

  // HAR-imported scripts embed the replayed calls as literal LOGIN_REQUEST/
  // CAPTURED_REQUESTS constants, which can be hundreds of KB. Sending those
  // through Claude and asking it to reproduce them verbatim guarantees
  // truncation past max_tokens, producing invalid JS (see k6PromptBlocks.ts
  // for the full rationale). Strip them out and splice the real data back in
  // after refinement, exactly like /api/har-generate does for initial generation.
  const extracted = extractCapturedData(currentScript);
  const scriptAfterCapturedStrip = extracted ? extracted.strippedScript : currentScript;

  // Same reasoning as above, but for the CSV-based CREDENTIALS pool — strip it
  // before prompting so Claude never sees/retypes real login credentials, and
  // splice the original rows back in afterward untouched.
  const extractedCreds = extractCredentials(scriptAfterCapturedStrip);
  const scriptForPrompt = extractedCreds ? extractedCreds.strippedScript : scriptAfterCapturedStrip;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (type: string, data: any) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    sendEvent('status', { message: `Acknowledged: "${prompt}"` });
    sendEvent('status', { message: 'Analyzing current script…' });
    sendEvent('status', { message: 'Applying requested changes…' });

    let fullScript = await streamRefinement(scriptForPrompt, prompt, !!extracted, sendEvent);
    if (extracted) fullScript = injectCapturedData(fullScript, extracted.dataBlock);
    if (extractedCreds) fullScript = injectCredentialsBlock(fullScript, extractedCreds.dataBlock);

    if (!isBraceBalanced(fullScript)) {
      sendEvent('status', { message: 'Generated script failed a structural check — retrying once…' });
      fullScript = await streamRefinement(scriptForPrompt, prompt, !!extracted, sendEvent);
      if (extracted) fullScript = injectCapturedData(fullScript, extracted.dataBlock);
      if (extractedCreds) fullScript = injectCredentialsBlock(fullScript, extractedCreds.dataBlock);

      if (!isBraceBalanced(fullScript)) {
        sendEvent('error', { message: 'Claude produced a script with mismatched braces twice in a row. Please try again — if this keeps happening, try a smaller or more specific change.' });
        res.end();
        return;
      }
    }

    sendEvent('status', { message: 'Script updated successfully' });
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
      sendEvent('error', { message: err.message || 'Refinement failed' });
    }
    res.end();
  }
});

export default router;
