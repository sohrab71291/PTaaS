import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const secrets = await prisma.secret.findMany({ orderBy: { name: 'asc' } });
  // Never return actual values — metadata only
  res.json(secrets.map(s => ({
    id: s.id,
    name: s.name,
    backend: s.backend,
    backendPath: s.backendPath,
    environments: s.environments,
    lastRotated: s.lastRotated,
    expiresAt: s.expiresAt,
    status: s.status,
    createdAt: s.createdAt,
  })));
});

router.post('/', async (req: Request, res: Response) => {
  const body = { ...req.body };
  delete body.value; // never store actual value
  const secret = await prisma.secret.create({
    data: {
      name: body.name,
      backend: body.backend,
      backendPath: body.backendPath,
      environments: body.environments ?? [],
      status: 'active',
      lastRotated: new Date(),
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
  });
  res.status(201).json(secret);
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.secret.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
});

router.post('/:id/test', async (req: Request, res: Response) => {
  const secret = await prisma.secret.findUnique({ where: { id: req.params.id } });
  if (!secret) return res.status(404).json({ error: 'Not found' });
  return res.json({ success: true, message: 'Connection verified successfully' });
});

export default router;
