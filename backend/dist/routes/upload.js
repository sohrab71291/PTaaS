"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const XLSX = __importStar(require("xlsx"));
const k6FromTestCases_1 = require("../services/k6FromTestCases");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = ['.csv', '.xls', '.xlsx'];
        const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
        if (allowed.includes(ext))
            cb(null, true);
        else
            cb(new Error(`Unsupported file type: ${ext}. Allowed: ${allowed.join(', ')}`));
    },
});
function normalizeHeader(h) {
    return h.trim().toLowerCase().replace(/\s+/g, '_');
}
function resolveColumn(row, ...keys) {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== '')
            return row[key];
    }
    return undefined;
}
function parseRows(rawRows) {
    const testCases = [];
    const warnings = [];
    rawRows.forEach((row, idx) => {
        // Normalize keys
        const normalized = {};
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
        let headers = {};
        const rawHeaders = resolveColumn(normalized, 'headers');
        if (rawHeaders) {
            try {
                headers = JSON.parse(String(rawHeaders));
            }
            catch {
                warnings.push(`Row ${idx + 1} (${name}): could not parse headers JSON`);
            }
        }
        let payload = null;
        const rawPayload = resolveColumn(normalized, 'payload', 'body', 'data');
        if (rawPayload)
            payload = String(rawPayload);
        const expectedStatus = parseInt(String(resolveColumn(normalized, 'expected_status', 'status') ?? '200'), 10) || 200;
        const responseThresholdMs = parseInt(String(resolveColumn(normalized, 'response_time_ms', 'threshold_ms', 'max_response_time') ?? '500'), 10) || 500;
        const weight = parseFloat(String(resolveColumn(normalized, 'weight', 'frequency') ?? '1')) || 1;
        const rawTags = resolveColumn(normalized, 'tags');
        const tags = rawTags ? String(rawTags).split(',').map((t) => t.trim()).filter(Boolean) : [];
        testCases.push({ name, url, method, headers, payload, expectedStatus, responseThresholdMs, weight, tags });
    });
    return { testCases, warnings };
}
router.post('/upload/test-cases', upload.single('file'), (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field name "file".' });
        return;
    }
    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (rawRows.length === 0) {
            res.status(422).json({ error: 'File is empty or has no data rows' });
            return;
        }
        const { testCases, warnings } = parseRows(rawRows);
        if (testCases.length === 0) {
            res.status(422).json({ error: 'No valid test cases found', warnings });
            return;
        }
        const script = (0, k6FromTestCases_1.generateK6FromTestCases)(testCases);
        res.json({ script, testCases, warnings });
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Failed to process file' });
    }
});
exports.default = router;
