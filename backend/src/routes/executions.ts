import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { generateK6Script } from '../services/k6Generator';
import { dispatchJob } from '../services/jobDispatcher';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const executions = await prisma.execution.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(executions);
});

router.post('/', async (req: Request, res: Response) => {
  const { specId, environment } = req.body;

  const spec = await prisma.testSpec.findUnique({ where: { id: specId } });
  if (!spec) return res.status(404).json({ error: 'Spec not found' });

  let baseUrl = 'http://localhost:3000';
  let envName = environment || 'local';
  if (spec.environmentId) {
    const env = await prisma.environment.findUnique({ where: { id: spec.environmentId } });
    if (env) {
      baseUrl = env.baseUrl;
      envName = env.name;
    }
  }

  const execution = await prisma.execution.create({
    data: {
      specId: spec.id,
      specName: spec.name,
      environment: envName,
      status: 'queued',
      triggeredBy: (req as any).user?.email ?? 'api-user@example.com',
      thresholdBreaches: 0,
      checksPassed: 0,
      checksFailed: 0,
      thresholdResults: [],
      checkResults: [],
      responseTimeSeries: [],
      slos: (spec as any).slos ?? [],
    },
  });

  try {
    const script = generateK6Script(spec as any, baseUrl);
    await dispatchJob(execution.id, script, {
      baseUrl,
      profileType: (spec.loadProfile as any)?.type || 'staged',
      stages: (spec.loadProfile as any)?.stages || [],
    });
  } catch (err: any) {
    // No agent available — return execution in queued state
    return res.status(201).json({ ...execution, warning: err.message });
  }

  return res.status(201).json(execution);
});

router.get('/:id', async (req: Request, res: Response) => {
  const exec = await prisma.execution.findUnique({ where: { id: req.params.id } });
  if (!exec) return res.status(404).json({ error: 'Not found' });
  return res.json(exec);
});

export default router;
