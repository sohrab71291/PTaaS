"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncScriptToRepos = syncScriptToRepos;
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const k6Generator_1 = require("../services/k6Generator");
const githubService_1 = require("../services/githubService");
const gitlabService_1 = require("../services/gitlabService");
const scriptSource_1 = require("../services/scriptSource");
const router = (0, express_1.Router)();
// Postgres' jsonb type caps any single string VALUE at 268,435,455 bytes —
// base64 inflates raw bytes by ~4/3, so this is checked against the encoded
// content, with margin, before ever reaching the DB. Without this check the
// insert/update throws deep inside the Postgres driver as an unhandled
// rejection (no res.status ever gets called), so the request just hangs until
// the client times out instead of getting a clear error.
const MAX_JSONB_STRING_BYTES = 260000000;
function oversizedFile(uploadedFiles) {
    if (!Array.isArray(uploadedFiles))
        return null;
    const hit = uploadedFiles.find((f) => typeof f?.content === 'string' && f.content.length > MAX_JSONB_STRING_BYTES);
    return hit ? hit.name ?? 'uploaded file' : null;
}
// Fire-and-forget push — never let a GitHub/GitLab hiccup fail the save request.
// Each push is independently a no-op if its provider isn't configured via env vars,
// so a suite is synced to whichever remote(s) are set up.
function syncScriptToRepos(specId, name, script) {
    if (!script)
        return;
    const message = `Update script for "${name}" (${specId})`;
    (0, githubService_1.pushScript)(specId, name, script, message).catch(err => {
        console.warn(`[GitHub] Unexpected error pushing script for spec ${specId}: ${err.message}`);
    });
    (0, gitlabService_1.pushScript)(specId, name, script, message).catch(err => {
        console.warn(`[GitLab] Unexpected error pushing script for spec ${specId}: ${err.message}`);
    });
}
router.get('/', async (_req, res) => {
    // uploadedFiles holds the ORIGINAL captured HAR/JSON file(s) as base64 (see
    // schema comment) — up to 200MB each, persisted purely so re-opening a
    // single suite for editing doesn't force a re-upload. The list view never
    // reads it (only name/description/tags/request/loadProfile/lastRunStatus
    // etc. — see TestSuites.tsx), but Prisma's default findMany() returns every
    // column for every row, so a handful of suites with large captures turned
    // this single list response into 100+MB, which fails outright in the
    // browser ("Failed to fetch") rather than just being slow. Excluded here;
    // GET /:id below still returns the full record, including uploadedFiles,
    // since only one suite's worth is ever needed there.
    const specs = await prisma_1.default.testSpec.findMany({
        orderBy: { createdAt: 'desc' },
        omit: { uploadedFiles: true },
    });
    res.json(specs);
});
router.post('/', async (req, res) => {
    const { name, description, tags, request: reqConfig, loadProfile, thresholds, checks, environmentId, generatedScript, slos, testType, complexity, envVars, uploadedFiles, } = req.body;
    const oversized = oversizedFile(uploadedFiles);
    if (oversized) {
        return res.status(413).json({ error: `"${oversized}" is too large to save — captured files must be under ~190MB.` });
    }
    try {
        // Upsert by name: same name → update existing suite; new name → create new suite.
        const existing = await prisma_1.default.testSpec.findFirst({ where: { name } });
        if (existing) {
            const updated = await prisma_1.default.testSpec.update({
                where: { id: existing.id },
                data: {
                    description: description ?? null,
                    tags: tags ?? [],
                    request: reqConfig,
                    loadProfile,
                    thresholds: thresholds ?? {},
                    checks: checks ?? [],
                    slos: slos ?? [],
                    environmentId: environmentId ?? null,
                    generatedScript: generatedScript ?? existing.generatedScript,
                    testType: testType ?? null,
                    complexity: complexity ?? null,
                    envVars: envVars ?? [],
                    // Only overwrite when the caller actually sent files this time —
                    // otherwise a save that didn't touch Section F would wipe out files
                    // uploaded in an earlier session.
                    ...(uploadedFiles != null ? { uploadedFiles } : {}),
                },
            });
            syncScriptToRepos(updated.id, updated.name, generatedScript);
            return res.json(updated);
        }
        const spec = await prisma_1.default.testSpec.create({
            data: {
                name,
                description: description ?? null,
                tags: tags ?? [],
                request: reqConfig,
                loadProfile,
                thresholds: thresholds ?? {},
                checks: checks ?? [],
                slos: slos ?? [],
                environmentId: environmentId ?? null,
                generatedScript: generatedScript ?? null,
                testType: testType ?? null,
                complexity: complexity ?? null,
                envVars: envVars ?? [],
                uploadedFiles: uploadedFiles ?? [],
                lastRunStatus: null,
                lastRunAt: null,
            },
        });
        syncScriptToRepos(spec.id, spec.name, generatedScript);
        return res.status(201).json(spec);
    }
    catch (err) {
        console.error(`[TestSpecs] Save failed for "${name}": ${err.message}`);
        return res.status(500).json({ error: 'Failed to save test suite' });
    }
});
router.get('/:id', async (req, res) => {
    const spec = await prisma_1.default.testSpec.findUnique({ where: { id: req.params.id } });
    if (!spec)
        return res.status(404).json({ error: 'Not found' });
    return res.json(spec);
});
// GET /:id/repo-script — the script content as it currently exists in the
// configured GitHub/GitLab repo, i.e. what an execution will actually run.
// TestSpec.generatedScript is retained only as the last-known-good copy for
// display before a suite's first push; it's never used to run a test.
router.get('/:id/repo-script', async (req, res) => {
    const spec = await prisma_1.default.testSpec.findUnique({ where: { id: req.params.id } });
    if (!spec)
        return res.status(404).json({ error: 'Not found' });
    try {
        const script = await (0, scriptSource_1.fetchLatestScript)(spec.name);
        return res.json({ script });
    }
    catch (err) {
        return res.status(502).json({ error: err.message ?? 'Failed to fetch script from repo' });
    }
});
router.put('/:id', async (req, res) => {
    const oversized = oversizedFile(req.body.uploadedFiles);
    if (oversized) {
        return res.status(413).json({ error: `"${oversized}" is too large to save — captured files must be under ~190MB.` });
    }
    try {
        const updated = await prisma_1.default.testSpec.update({
            where: { id: req.params.id },
            data: {
                name: req.body.name,
                description: req.body.description ?? null,
                tags: req.body.tags ?? [],
                request: req.body.request,
                loadProfile: req.body.loadProfile,
                thresholds: req.body.thresholds ?? {},
                checks: req.body.checks ?? [],
                slos: req.body.slos ?? [],
                environmentId: req.body.environmentId ?? null,
                testType: req.body.testType ?? null,
                complexity: req.body.complexity ?? null,
                envVars: req.body.envVars ?? [],
                // Only overwrite the saved script when a non-null value is explicitly provided.
                // Sending null (no new script generated this session) preserves the existing one.
                ...(req.body.generatedScript != null ? { generatedScript: req.body.generatedScript } : {}),
                // Same reasoning as generatedScript — only overwrite when files were
                // actually sent this time.
                ...(req.body.uploadedFiles != null ? { uploadedFiles: req.body.uploadedFiles } : {}),
                lastRunStatus: req.body.lastRunStatus,
                lastRunAt: req.body.lastRunAt ? new Date(req.body.lastRunAt) : null,
                scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : null,
            },
        });
        syncScriptToRepos(updated.id, updated.name, req.body.generatedScript);
        return res.json(updated);
    }
    catch (err) {
        // P2025 = Prisma "record to update not found" — the only case that's genuinely a 404.
        if (err.code === 'P2025')
            return res.status(404).json({ error: 'Not found' });
        console.error(`[TestSpecs] Update failed for ${req.params.id}: ${err.message}`);
        return res.status(500).json({ error: 'Failed to save test suite' });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        await prisma_1.default.testSpec.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch {
        return res.status(404).json({ error: 'Not found' });
    }
});
router.get('/:id/preview/json', async (req, res, next) => {
    try {
        const spec = await prisma_1.default.testSpec.findUnique({ where: { id: req.params.id } });
        if (!spec)
            return res.status(404).json({ error: 'Not found' });
        let resolvedEnvironment = { name: '', baseUrl: '', variables: [] };
        if (spec.environmentId) {
            const env = await prisma_1.default.environment.findUnique({ where: { id: spec.environmentId } });
            if (env) {
                resolvedEnvironment = {
                    name: env.name,
                    baseUrl: env.baseUrl,
                    variables: env.variables ?? [],
                };
            }
        }
        return res.json({ ...spec, resolvedEnvironment });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id/preview/k6', async (req, res, next) => {
    try {
        const spec = await prisma_1.default.testSpec.findUnique({ where: { id: req.params.id } });
        if (!spec)
            return res.status(404).json({ error: 'Not found' });
        let baseUrl = 'https://api.example.com';
        if (spec.environmentId) {
            const env = await prisma_1.default.environment.findUnique({ where: { id: spec.environmentId } });
            if (env)
                baseUrl = env.baseUrl;
        }
        const script = (0, k6Generator_1.generateK6Script)(spec, baseUrl);
        return res.type('text/plain').send(script);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
