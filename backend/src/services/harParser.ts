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

export interface HarParseResult {
  testCases: ParsedTestCase[];
  warnings: string[];
  skipped: number;
}

export function parseHar(content: string, filename = 'file'): HarParseResult {
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
  let skipped = 0;

  for (const entry of entries) {
    const req = entry.request;
    if (!req?.url || !req?.method) { skipped++; continue; }

    if (shouldSkipUrl(req.url)) { skipped++; continue; }

    const key = dedupeKey(req.method, req.url);
    if (seen.has(key)) { skipped++; continue; }
    seen.set(key, true);

    // ── Headers ─────────────────────────────────────────────────────────────
    const headers: Record<string, string> = {};
    for (const h of req.headers ?? []) {
      if (!h.name || SKIP_HEADERS.has(h.name.toLowerCase())) continue;
      headers[h.name] = h.value;
    }

    // ── Payload ──────────────────────────────────────────────────────────────
    let payload: string | null = null;
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
        // application/x-www-form-urlencoded — keep as string note
        payload = JSON.stringify({ _formData: req.postData.text });
        warnings.push(`${filename}: form-encoded body for ${req.method} ${req.url} converted to JSON object`);
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
    });
  }

  if (testCases.length === 0) {
    warnings.push(`${filename}: all ${entries.length} entries were filtered out (static assets, duplicates, or internal calls)`);
  }

  return { testCases, warnings, skipped };
}
