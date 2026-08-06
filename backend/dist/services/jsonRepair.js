"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryRepairJson = tryRepairJson;
const jsonrepair_1 = require("jsonrepair");
/**
 * Validates and attempts to repair `raw` if it looks like JSON.
 *
 * Returns one of four statuses:
 *   'not-json'      — content doesn't start with { or [; returned untouched
 *   'valid'         — content is already valid JSON; returned untouched
 *   'repaired'      — content was malformed; jsonrepair fixed it successfully
 *   'repair-failed' — content looks like JSON, is invalid, and jsonrepair
 *                     could not fix it; original text returned
 *
 * jsonrepair handles: trailing commas, single quotes, unquoted keys, JS
 * comments, BOM, truncated content, escaped characters, and more.
 */
function tryRepairJson(raw) {
    const trimmed = raw.trimStart();
    const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    if (!looksLikeJson) {
        return { text: raw, status: 'not-json', note: '' };
    }
    // Fast path — already valid
    try {
        JSON.parse(raw);
        return { text: raw, status: 'valid', note: '' };
    }
    catch { }
    // Capture the original parse error for display
    let parseError = '';
    try {
        JSON.parse(raw);
    }
    catch (e) {
        parseError = e.message;
    }
    // Repair path
    try {
        const fixed = (0, jsonrepair_1.jsonrepair)(raw);
        JSON.parse(fixed); // verify output is actually valid
        return {
            text: fixed,
            status: 'repaired',
            note: 'File contained invalid JSON — automatically repaired before processing.',
        };
    }
    catch {
        return {
            text: raw,
            status: 'repair-failed',
            note: 'File contains invalid JSON that could not be automatically repaired.',
            parseError,
        };
    }
}
