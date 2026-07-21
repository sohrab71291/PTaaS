import { ParsedTestCase } from './k6FromTestCases';

// Extensions/patterns to skip — static assets, sourcemaps, analytics
const SKIP_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|otf|map|webp|avif|pdf|zip|gz)(\?.*)?$/i;

// URL substrings that indicate non-API traffic to exclude
const SKIP_URL_PATTERNS = [
  /\/(analytics|telemetry|tracking|metrics|beacon|pixel|collect)($|\/|\?)/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /segment\.com/i,
  /mixpanel\.com/i,
  /hotjar\.com/i,
  /amplitude\.com/i,
  /sentry\.io/i,
  // Third-party chat/support widgets — incidentally captured whenever they're
  // embedded on the page under test, not part of the app itself.
  /intercom\.io/i,
  // RUM/session-replay telemetry beacons — e.g. Coralogix's browser SDK fires
  // a burst of these on every page interaction. Real app APIs never target
  // this domain, and left unfiltered these repeated beacons can outnumber the
  // actual captured calls several-to-one, burying them in both the Captured
  // Requests preview and the generated script's replay list.
  /rum-ingress-coralogix\.com/i,
  /coralogix\.com\/(browser|logs)/i,
  /localhost:8086\/api\/v2\/write/i,   // InfluxDB write — internal
  /\/api\/v2\/(write|query)/i,         // InfluxDB — internal
  /\/api\/grafana-proxy/i,             // Grafana proxy — internal
];

// Request headers that are browser/connection internals — not useful in k6
const SKIP_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'upgrade-insecure-requests',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'if-none-match', 'if-modified-since', 'cache-control', 'pragma',
  'cookie',   // handled separately — sensitive
  'origin',   // set by k6 or omitted
  'referer',  // not meaningful in load tests
  ':method', ':path', ':scheme', ':authority',  // HTTP/2 pseudo-headers
]);

interface HarEntry {
  request: {
    method: string;
    url: string;
    headers: { name: string; value: string }[];
    postData?: { mimeType?: string; text?: string };
    queryString?: { name: string; value: string }[];
  };
  response?: {
    status?: number;
    content?: { text?: string; mimeType?: string };
  };
  time?: number;
}

interface HarDoc {
  log?: {
    entries?: HarEntry[];
  };
}

function shouldSkipUrl(url: string): boolean {
  if (SKIP_EXTENSIONS.test(url)) return true;
  for (const pattern of SKIP_URL_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  return false;
}

function extractPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function dedupeKey(method: string, url: string): string {
  // Normalise path: replace UUIDs and numeric IDs with placeholders so
  // GET /users/123 and GET /users/456 are treated as the same endpoint.
  const path = extractPath(url)
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}')
    .replace(/\/\d{4,}/g, '/{id}');
  return `${method.toUpperCase()} ${path}`;
}

// ── ID correlation ─────────────────────────────────────────────────────────
//
// A captured session is a stateful CRUD flow: a POST creates a resource and
// returns its id, then later captured calls reference that exact id in their
// URL (e.g. /contents/786451/fields) or payload. Replaying those later calls
// with the literal capture-time id verbatim will drift the moment the id
// changes for any reason (fresh run creates a different id, an earlier
// replay's own DELETE removed the captured id, etc.) — producing 100%
// failures on every downstream call even though the flow itself is fine.
//
// This pass finds those literal-id links between captured calls and rewrites
// the later ones to reference a `{{token:capturedValue}}` placeholder instead
// of the bare literal, while tagging the producing call with which JSON path
// in ITS OWN response to re-extract the real value from at replay time. The
// generated k6 script (see harGenerate.ts REPLAY HARNESS PATTERN) resolves
// these placeholders per-iteration from the actual response of the producing
// call, falling back to the captured literal only if extraction fails.

const ID_KEY_RE = /(^id$|Id$|_id$)/i;

interface IdCandidate { jsonPath: string; value: string }

// Recursively collects {key path, value} pairs for fields that look like ids
// (numeric or numeric-string values under a key literally named "id" or
// ending in "Id"/"_id"). Depth-limited and capped to keep this cheap even on
// large captured response bodies.
function collectIdCandidates(body: unknown, prefix = '', depth = 0, out: IdCandidate[] = []): IdCandidate[] {
  if (body == null || depth > 3 || out.length > 25 || typeof body !== 'object') return out;
  if (Array.isArray(body)) {
    if (body.length > 0) collectIdCandidates(body[0], prefix ? `${prefix}.0` : '0', depth + 1, out);
    return out;
  }
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const isIdLike = (typeof value === 'number' && Number.isFinite(value))
      || (typeof value === 'string' && /^\d+$/.test(value));
    if (isIdLike && ID_KEY_RE.test(key) && String(value).length >= 2) {
      out.push({ jsonPath: path, value: String(value) });
    } else if (value && typeof value === 'object' && depth < 3) {
      collectIdCandidates(value, path, depth + 1, out);
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replaces `literal` with `replacement` only where it appears as a standalone
// token (path segment, JSON value, etc.) — not as a substring of a longer
// number — so e.g. correlating "786451" never touches "17864510".
function substituteLiteral(text: string, literal: string, replacement: string): { text: string; count: number } {
  const re = new RegExp(`(?<=[/:"=&?\\s,{]|^)${escapeRegExp(literal)}(?=[/",}=&\\s]|$)`, 'g');
  let count = 0;
  const replaced = text.replace(re, () => { count++; return replacement; });
  return { text: replaced, count };
}

function tokenNameFromPath(jsonPath: string): string {
  const last = jsonPath.split('.').pop() || 'id';
  return last.replace(/[^a-zA-Z0-9]/g, '') || 'id';
}

// Placeholder format is deliberately alnum/underscore-only, NOT `{{token}}` —
// curly braces get percent-encoded by the WHATWG URL parser (toUrlPath() in
// k6FromTestCases.ts round-trips url through `new URL(...)`), which would
// silently corrupt the placeholder into `%7B%7D...` before the replay harness
// ever sees it. `__CORR_<token>_<fallbackDigits>__` survives URL parsing
// unchanged since underscores/digits/letters are all unreserved characters.
// Exported so harGenerate.ts's prompt can document the exact regex the
// generated script must use to parse it back out at runtime.
export const CORRELATION_PLACEHOLDER_RE = /__CORR_([A-Za-z0-9]+)_(\d+)__/g;

// Mutates testCases in place: for every id-like value found in a call's
// captured response, if any LATER call's url/payload contains that exact
// literal, both are rewritten to use a shared `__CORR_<token>_<literal>__`
// placeholder and the producing call is tagged via producesVars so the replay
// harness knows to re-extract the real value from its own response at runtime.
export function applyIdCorrelation(testCases: ParsedTestCase[], responseBodies: (unknown | null)[]): void {
  let tokenCounter = 0;

  for (let i = 0; i < testCases.length; i++) {
    if (testCases[i].method.toUpperCase() === 'GET') continue; // only mutating calls create new resources worth correlating
    const body = responseBodies[i];
    if (!body) continue;

    for (const cand of collectIdCandidates(body)) {
      const token = `${tokenNameFromPath(cand.jsonPath)}${++tokenCounter}`;
      const placeholder = `__CORR_${token}_${cand.value}__`;
      let matched = false;

      for (let j = i + 1; j < testCases.length; j++) {
        const tc = testCases[j];
        const urlResult = substituteLiteral(tc.url, cand.value, placeholder);
        let payloadResult: { text: string; count: number } | null = null;
        if (tc.payload) payloadResult = substituteLiteral(tc.payload, cand.value, placeholder);

        if (urlResult.count > 0 || (payloadResult && payloadResult.count > 0)) {
          tc.url = urlResult.text;
          if (payloadResult) tc.payload = payloadResult.text;
          matched = true;
        }
      }

      if (matched) {
        const producer = testCases[i];
        (producer.producesVars ??= []).push({ token, jsonPath: cand.jsonPath });
      }
    }
  }
}

export interface HarParseResult {
  testCases: ParsedTestCase[];
  warnings: string[];
  skipped: number;
}

export interface ParseHarOptions {
  // When false, every non-skipped entry is kept — including repeat calls to the
  // same endpoint with different ids/params. Used by the AI-driven HAR→k6 flow,
  // which needs the complete captured call sequence rather than one representative
  // call per endpoint. Defaults to true to preserve the existing deterministic
  // /api/upload/har behaviour (one k6 scenario per unique endpoint).
  dedupe?: boolean;
}

// Cookie header values are never reused as-is (they're stale/session-specific by
// the time the script runs), but the cookie NAMES are a useful hint for
// reconstructing the session cookie after a fresh login — e.g. knowing the app
// expects "__ArcherSessionCookie__" rather than a generic "session" cookie.
function extractCookieNames(cookieHeaderValue: string): string[] {
  return cookieHeaderValue
    .split(';')
    .map(part => part.split('=')[0]?.trim())
    .filter((name): name is string => !!name);
}

export function parseHar(content: string, filename = 'file', opts: ParseHarOptions = {}): HarParseResult {
  const dedupe = opts.dedupe ?? true;
  const warnings: string[] = [];
  let doc: HarDoc;

  try {
    doc = JSON.parse(content);
  } catch {
    throw new Error(`${filename}: invalid JSON`);
  }

  const entries: HarEntry[] = doc?.log?.entries ?? [];
  if (entries.length === 0) {
    throw new Error(`${filename}: no HAR entries found (expected { log: { entries: [...] } })`);
  }

  const seen = new Map<string, boolean>();
  const testCases: ParsedTestCase[] = [];
  const responseBodies: (unknown | null)[] = [];
  let skipped = 0;

  for (const entry of entries) {
    const req = entry.request;
    if (!req?.url || !req?.method) { skipped++; continue; }

    if (shouldSkipUrl(req.url)) { skipped++; continue; }

    if (dedupe) {
      const key = dedupeKey(req.method, req.url);
      if (seen.has(key)) { skipped++; continue; }
      seen.set(key, true);
    }

    // ── Headers ─────────────────────────────────────────────────────────────
    const headers: Record<string, string> = {};
    let cookieNames: string[] = [];
    for (const h of req.headers ?? []) {
      if (!h.name) continue;
      if (h.name.toLowerCase() === 'cookie') {
        // Names only — values are stale/session-specific by the time the
        // generated script runs, but the names hint at what the app's session
        // cookie is called (see extractCookieNames above).
        cookieNames = extractCookieNames(h.value);
        continue;
      }
      if (SKIP_HEADERS.has(h.name.toLowerCase())) continue;
      headers[h.name] = h.value;
    }

    // ── Payload ──────────────────────────────────────────────────────────────
    let payload: string | null = null;
    let payloadType: 'json' | 'form' | undefined;
    if (req.postData?.text) {
      const mime = (req.postData.mimeType ?? '').toLowerCase();
      if (mime.includes('json')) {
        try {
          // Validate it's parseable JSON, then re-stringify for clean formatting
          payload = JSON.stringify(JSON.parse(req.postData.text), null, 2);
        } catch {
          payload = req.postData.text;
          warnings.push(`${filename}: non-parseable JSON body for ${req.method} ${req.url} — using raw text`);
        }
      } else if (mime.includes('form')) {
        // application/x-www-form-urlencoded — parse into real field name/value
        // pairs (not a raw string) so the generated script can replay it as an
        // actual form submission (payloadType tells the generators to send it
        // urlencoded, not JSON.stringify'd).
        try {
          const fields: Record<string, string> = {};
          for (const [k, v] of new URLSearchParams(req.postData.text)) fields[k] = v;
          payload = JSON.stringify(fields, null, 2);
          payloadType = 'form';
          warnings.push(`${filename}: form-encoded body for ${req.method} ${req.url} parsed into ${Object.keys(fields).length} field(s)`);
        } catch {
          payload = req.postData.text;
          payloadType = 'form';
          warnings.push(`${filename}: could not parse form-encoded body for ${req.method} ${req.url} — using raw text`);
        }
      } else {
        payload = req.postData.text;
      }
    }

    const expectedStatus = (entry.response?.status ?? 200);
    // Treat 4xx/5xx responses in HAR as the endpoint returning errors under load —
    // still generate the request but use 200 as the expected status for the test.
    const normalizedStatus = expectedStatus >= 400 ? 200 : expectedStatus;

    const urlPath = extractPath(req.url);
    const name = `${req.method.toUpperCase()} ${urlPath}`.replace(/[^a-zA-Z0-9 ]/g, '_').slice(0, 60);

    testCases.push({
      name,
      url: req.url,
      method: req.method.toUpperCase(),
      headers,
      payload,
      expectedStatus: normalizedStatus,
      responseThresholdMs: 500,
      weight: 1,
      tags: [],
      ...(cookieNames.length ? { cookieNames } : {}),
      ...(payloadType ? { payloadType } : {}),
    });

    // Parsed alongside testCases (not dedupe-filtered above) so indices stay
    // aligned 1:1 for the correlation pass below.
    let responseBody: unknown | null = null;
    const respContent = entry.response?.content;
    if (respContent?.text && (respContent.mimeType ?? '').toLowerCase().includes('json')) {
      try { responseBody = JSON.parse(respContent.text); } catch { /* not JSON — no candidates */ }
    }
    responseBodies.push(responseBody);
  }

  if (testCases.length === 0) {
    warnings.push(`${filename}: all ${entries.length} entries were filtered out (static assets, duplicates, or internal calls)`);
  }

  // Only meaningful for the full, sequential capture (dedupe disabled) used by
  // the AI-driven HAR→k6 replay flow — the deduped one-call-per-endpoint flow
  // doesn't replay calls in session order, so literal-id correlation doesn't apply.
  if (!dedupe && testCases.length > 0) {
    applyIdCorrelation(testCases, responseBodies);
  }

  return { testCases, warnings, skipped };
}
