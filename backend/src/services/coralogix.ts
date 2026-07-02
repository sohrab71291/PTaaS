/**
 * Coralogix log ingestion via their REST Logs API v1.
 * All sends are fire-and-forget — failures are logged to stderr only,
 * never thrown, so observability never blocks the request path.
 *
 * Env vars:
 *   CORALOGIX_API_KEY   — private key from Coralogix Data Flow > API Keys
 *   CORALOGIX_APP_NAME  — application label (default: "PTaaS")
 *   CORALOGIX_ENDPOINT  — full ingestion URL (default: EU1)
 *                         e.g. https://ingress.coralogix.com/logs/v1/singles
 */

export const Severity = {
  DEBUG:    1,
  VERBOSE:  2,
  INFO:     3,
  WARNING:  4,
  ERROR:    5,
  CRITICAL: 6,
} as const;

export type SeverityLevel = (typeof Severity)[keyof typeof Severity];

export interface LogEntry {
  severity:   SeverityLevel;
  subsystem:  string;
  text:       string | Record<string, unknown>;
  timestamp?: number; // epoch ms; defaults to Date.now()
}

function isEnabled(): boolean {
  return !!process.env.CORALOGIX_API_KEY;
}

function endpoint(): string {
  return (
    process.env.CORALOGIX_ENDPOINT ??
    'https://ingress.coralogix.com/logs/v1/singles'
  );
}

function appName(): string {
  return process.env.CORALOGIX_APP_NAME ?? 'PTaaS';
}

/**
 * Send one or more log entries to Coralogix.
 * Returns immediately — the HTTP call runs in the background.
 */
export function sendLogs(entries: LogEntry[]): void {
  if (!isEnabled() || entries.length === 0) return;

  const body = JSON.stringify({
    applicationName: appName(),
    subsystemName:   entries[0].subsystem,
    logEntries: entries.map(e => ({
      timestamp: e.timestamp ?? Date.now(),
      severity:  e.severity,
      text:
        typeof e.text === 'string'
          ? e.text
          : JSON.stringify(e.text),
    })),
  });

  fetch(endpoint(), {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${process.env.CORALOGIX_API_KEY}`,
    },
    body,
  }).catch((err: Error) => {
    console.error('[Coralogix] send failed:', err.message);
  });
}

export interface TraceSpan {
  traceId: string;
  operation: string;
  durationMs: number;
  status: 'ok' | 'error';
  metadata?: Record<string, unknown>;
}

/** Convenience wrappers */
export const coralogix = {
  debug(subsystem: string, text: LogEntry['text']): void {
    sendLogs([{ severity: Severity.DEBUG, subsystem, text }]);
  },
  info(subsystem: string, text: LogEntry['text']): void {
    sendLogs([{ severity: Severity.INFO, subsystem, text }]);
  },
  warn(subsystem: string, text: LogEntry['text']): void {
    sendLogs([{ severity: Severity.WARNING, subsystem, text }]);
  },
  error(subsystem: string, text: LogEntry['text']): void {
    sendLogs([{ severity: Severity.ERROR, subsystem, text }]);
  },
  /** Ships a request/operation span as a log under the "trace" subsystem so it shows up in the Traces tab. */
  trace(span: TraceSpan): void {
    sendLogs([{
      severity: span.status === 'error' ? Severity.ERROR : Severity.INFO,
      subsystem: 'trace',
      text: { kind: 'span', ...span },
    }]);
  },
};

// ── Query side: read logs/traces back out of Coralogix via the DataPrime API ──
//
// Ingestion (above) uses a "Send Your Data" private key. Querying needs an API
// key scoped for "Query Logs/DataPrime" — usually a different key — plus the
// team's domain (e.g. "eu2.coralogix.com", "coralogix.com", "cx498.coralogix.com").
//
// Env vars:
//   CORALOGIX_QUERY_API_KEY — query-scoped API key (falls back to CORALOGIX_API_KEY)
//   CORALOGIX_DOMAIN        — team domain, default "eu2.coralogix.com"

function queryDomain(): string {
  return process.env.CORALOGIX_DOMAIN ?? 'eu2.coralogix.com';
}

function queryApiKey(): string | undefined {
  return process.env.CORALOGIX_QUERY_API_KEY || process.env.CORALOGIX_API_KEY;
}

export function isQueryEnabled(): boolean {
  return !!queryApiKey();
}

export interface DataPrimeResult {
  rows: Record<string, unknown>[];
  warnings: string[];
}

/**
 * Runs a DataPrime query against Coralogix's "logs" or "spans" source.
 * Response is newline-delimited JSON; each result's `userData` is itself a
 * JSON string holding the original fields (since our ingestion side
 * JSON-stringifies non-string `text` payloads — see sendLogs above).
 */
export async function queryDataPrime(
  source: 'logs' | 'spans',
  opts: { text?: string; limit?: number; lookbackMinutes?: number },
): Promise<DataPrimeResult> {
  const apiKey = queryApiKey();
  if (!apiKey) {
    throw new Error(
      'Coralogix query API not configured — set CORALOGIX_QUERY_API_KEY (or CORALOGIX_API_KEY) and CORALOGIX_DOMAIN in backend/.env',
    );
  }

  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const lookbackMinutes = Math.min(Math.max(opts.lookbackMinutes ?? 60, 1), 7 * 24 * 60);
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackMinutes * 60_000);

  const safeText = (opts.text ?? '').trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const filterClause = safeText
    ? ` | filter $d.text.contains('${safeText}') || $m.subsystemname.contains('${safeText}')`
    : '';
  const query = `source ${source}${filterClause} | limit ${limit}`;

  const url = `https://ng-api-http.${queryDomain()}/api/v1/dataprime/query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      metadata: {
        tier: 'TIER_FREQUENT_SEARCH',
        syntax: 'QUERY_SYNTAX_DATAPRIME',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit,
      },
    }),
    signal: AbortSignal.timeout(15000),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Coralogix query failed: HTTP ${response.status} — ${raw.slice(0, 500)}`);
  }

  const rows: Record<string, unknown>[] = [];
  const warnings: string[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (parsed.error) {
      warnings.push(typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
      continue;
    }
    const results = parsed?.result?.results ?? [];
    for (const r of results) {
      let userData: any = r.userData;
      if (typeof userData === 'string') {
        try { userData = JSON.parse(userData); } catch { /* keep as raw string */ }
      }
      rows.push({
        ...(userData && typeof userData === 'object' ? userData : { text: userData }),
        _metadata: r.metadata ?? [],
      });
    }
  }

  return { rows, warnings };
}
