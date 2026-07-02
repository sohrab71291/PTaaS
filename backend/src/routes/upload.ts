import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { generateK6FromTestCases, ParsedTestCase } from '../services/k6FromTestCases';
import { parseHar } from '../services/harParser';

const router = Router();

const uploadTestCases = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.csv', '.xls', '.xlsx'];
    const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}. Allowed: ${allowed.join(', ')}`));
  },
});

const uploadHar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
    if (['.har', '.json'].includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}. Allowed: .har, .json`));
  },
});

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

function resolveColumn(row: Record<string, any>, ...keys: string[]): any {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return undefined;
}

function parseRows(rawRows: Record<string, any>[]): { testCases: ParsedTestCase[]; warnings: string[] } {
  const testCases: ParsedTestCase[] = [];
  const warnings: string[] = [];

  rawRows.forEach((row, idx) => {
    // Normalize keys
    const normalized: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      normalized[normalizeHeader(k)] = v;
    }

    const name = String(resolveColumn(normalized, 'name') ?? `Test_${idx + 1}`);
    const url = String(resolveColumn(normalized, 'url', 'endpoint', 'path') ?? '');
    if (!url) {
      warnings.push(`Row ${idx + 1} (${name}): missing url/endpoint/path — skipping`);
      return;
    }

    const method = String(resolveColumn(normalized, 'method') ?? 'GET').toUpperCase();
    let headers: Record<string, string> = {};
    const rawHeaders = resolveColumn(normalized, 'headers');
    if (rawHeaders) {
      try { headers = JSON.parse(String(rawHeaders)); } catch {
        warnings.push(`Row ${idx + 1} (${name}): could not parse headers JSON`);
      }
    }

    let payload: string | null = null;
    const rawPayload = resolveColumn(normalized, 'payload', 'body', 'data');
    if (rawPayload) payload = String(rawPayload);

    const expectedStatus = parseInt(String(resolveColumn(normalized, 'expected_status', 'status') ?? '200'), 10) || 200;
    const responseThresholdMs = parseInt(String(resolveColumn(normalized, 'response_time_ms', 'threshold_ms', 'max_response_time') ?? '500'), 10) || 500;
    const weight = parseFloat(String(resolveColumn(normalized, 'weight', 'frequency') ?? '1')) || 1;

    const rawTags = resolveColumn(normalized, 'tags');
    const tags = rawTags ? String(rawTags).split(',').map((t: string) => t.trim()).filter(Boolean) : [];

    testCases.push({ name, url, method, headers, payload, expectedStatus, responseThresholdMs, weight, tags });
  });

  return { testCases, warnings };
}

router.post('/upload/test-cases', uploadTestCases.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field name "file".' });
    return;
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rawRows.length === 0) {
      res.status(422).json({ error: 'File is empty or has no data rows' });
      return;
    }

    const { testCases, warnings } = parseRows(rawRows);

    if (testCases.length === 0) {
      res.status(422).json({ error: 'No valid test cases found', warnings });
      return;
    }

    const script = generateK6FromTestCases(testCases);
    res.json({ script, testCases, warnings });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to process file' });
  }
});

// ── POST /api/upload/har ──────────────────────────────────────────────────────
// Accepts one or more .har / .json files (field name "files" or "file").
// Parses every HAR entry across all uploaded files, deduplicates by
// (method, normalised path), generates a single combined k6 script, and
// returns { script, testCases, warnings, skipped }.
router.post(
  '/upload/har',
  uploadHar.any(),
  (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No files uploaded. Use multipart/form-data with field name "files".' });
      return;
    }

    const allTestCases: ParsedTestCase[] = [];
    const allWarnings: string[] = [];
    let totalSkipped = 0;

    // Load profile forwarded from the Test Authoring form (optional)
    let loadProfile: any;
    try { loadProfile = req.body.loadProfile ? JSON.parse(req.body.loadProfile) : undefined; } catch { /* ignore */ }

    for (const file of files) {
      try {
        const content = file.buffer.toString('utf-8');
        const { testCases, warnings, skipped } = parseHar(content, file.originalname);
        allTestCases.push(...testCases);
        allWarnings.push(...warnings);
        totalSkipped += skipped;
      } catch (err: any) {
        allWarnings.push(`${file.originalname}: ${err.message}`);
      }
    }

    if (allTestCases.length === 0) {
      res.status(422).json({
        error: 'No API requests found across the uploaded file(s). Check that the files are valid HAR exports with captured network traffic.',
        warnings: allWarnings,
      });
      return;
    }

    // Global deduplication across files: same method+normalised-path → keep first
    const seen = new Set<string>();
    const deduped: ParsedTestCase[] = [];
    for (const tc of allTestCases) {
      const key = `${tc.method} ${tc.url}`;
      if (!seen.has(key)) { seen.add(key); deduped.push(tc); }
    }

    if (deduped.length < allTestCases.length) {
      allWarnings.push(`Removed ${allTestCases.length - deduped.length} cross-file duplicate request(s)`);
    }

    const script = generateK6FromTestCases(deduped, loadProfile);
    res.json({
      script,
      testCases: deduped,
      warnings: allWarnings,
      skipped: totalSkipped,
      filesProcessed: files.length,
    });
  },
);

export default router;
