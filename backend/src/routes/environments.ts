import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const envs = await prisma.environment.findMany({ orderBy: { name: 'asc' } });
  res.json(envs);
});

router.post('/', async (req: Request, res: Response) => {
  const env = await prisma.environment.create({
    data: {
      name: req.body.name,
      baseUrl: req.body.baseUrl,
      variables: req.body.variables ?? [],
      secrets: req.body.secrets ?? [],
      requiresApproval: req.body.requiresApproval ?? false,
      executionCount: 0,
    },
  });
  res.status(201).json(env);
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const updated = await prisma.environment.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        baseUrl: req.body.baseUrl,
        variables: req.body.variables ?? [],
        secrets: req.body.secrets ?? [],
        requiresApproval: req.body.requiresApproval ?? false,
      },
    });
    return res.json(updated);
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.environment.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
});

export default router;
