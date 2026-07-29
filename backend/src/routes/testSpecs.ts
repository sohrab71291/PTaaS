import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { generateK6Script } from '../services/k6Generator';
import { pushScript as pushScriptToGithub } from '../services/githubService';
import { pushScript as pushScriptToGitlab } from '../services/gitlabService';

const router = Router();

// Fire-and-forget push — never let a GitHub/GitLab hiccup fail the save request.
// Each push is independently a no-op if its provider isn't configured via env vars,
// so a suite is synced to whichever remote(s) are set up.
function syncScriptToRepos(specId: string, name: string, script: string | null | undefined) {
  if (!script) return;
  const message = `Update script for "${name}" (${specId})`;
  pushScriptToGithub(specId, script, message).catch(err => {
    console.warn(`[GitHub] Unexpected error pushing script for spec ${specId}: ${err.message}`);
  });
  pushScriptToGitlab(specId, script, message).catch(err => {
    console.warn(`[GitLab] Unexpected error pushing script for spec ${specId}: ${err.message}`);
  });
}

router.get('/', async (_req: Request, res: Response) => {
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
  const specs = await prisma.testSpec.findMany({
    orderBy: { createdAt: 'desc' },
    omit: { uploadedFiles: true },
  });
  res.json(specs);
});

router.post('/', async (req: Request, res: Response) => {
  const {
    name, description, tags, request: reqConfig, loadProfile, thresholds, checks,
    environmentId, generatedScript, slos, testType, complexity, envVars, uploadedFiles,
  } = req.body;

  // Upsert by name: same name → update existing suite; new name → create new suite.
  const existing = await prisma.testSpec.findFirst({ where: { name } });
  if (existing) {
    const updated = await prisma.testSpec.update({
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

  const spec = await prisma.testSpec.create({
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
});

router.get('/:id', async (req: Request, res: Response) => {
  const spec = await prisma.testSpec.findUnique({ where: { id: req.params.id } });
  if (!spec) return res.status(404).json({ error: 'Not found' });
  return res.json(spec);
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const updated = await prisma.testSpec.update({
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
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.testSpec.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
});

router.get('/:id/preview/json', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const spec = await prisma.testSpec.findUnique({ where: { id: req.params.id } });
    if (!spec) return res.status(404).json({ error: 'Not found' });

    let resolvedEnvironment = { name: '', baseUrl: '', variables: [] };
    if (spec.environmentId) {
      const env = await prisma.environment.findUnique({ where: { id: spec.environmentId } });
      if (env) {
        resolvedEnvironment = {
          name: env.name,
          baseUrl: env.baseUrl,
          variables: (env.variables as any) ?? [],
        };
      }
    }

    return res.json({ ...spec, resolvedEnvironment });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/preview/k6', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const spec = await prisma.testSpec.findUnique({ where: { id: req.params.id } });
    if (!spec) return res.status(404).json({ error: 'Not found' });

    let baseUrl = 'https://api.example.com';
    if (spec.environmentId) {
      const env = await prisma.environment.findUnique({ where: { id: spec.environmentId } });
      if (env) baseUrl = env.baseUrl;
    }

    const script = generateK6Script(spec as any, baseUrl);
    return res.type('text/plain').send(script);
  } catch (err) {
    next(err);
  }
});

export default router;
