import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { agentRegistry } from '../services/agentRegistry';

const router = Router();

// Public — called by the agent CLI before it has a JWT
router.post('/agents/register', async (req: Request, res: Response) => {
  const { name, hostname } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  // TODO: hash apiKey with bcrypt before storing in production
  const apiKey = crypto.randomBytes(32).toString('hex');

  const agent = await prisma.agent.create({
    data: { name, apiKey, hostname: hostname ?? null },
  });

  // apiKey returned in plaintext only this once
  res.status(201).json({ agentId: agent.id, apiKey, name: agent.name });
});

// Protected — requires admin role
router.get('/agents', requireAuth, requireRole('ADMIN', 'TESTER'), async (req: AuthRequest, res: Response) => {
  const dbAgents = await prisma.agent.findMany({ orderBy: { createdAt: 'desc' } });
  const liveStatus = agentRegistry.listAll();
  const liveMap = new Map(liveStatus.map(a => [a.agentId, a]));

  const agents = dbAgents.map(a => ({
    id: a.id,
    name: a.name,
    hostname: a.hostname,
    k6Version: a.k6Version,
    status: liveMap.get(a.id)?.status ?? 'offline',
    lastSeen: liveMap.get(a.id)?.lastSeen ?? a.lastSeen,
    createdAt: a.createdAt,
  }));

  res.json(agents);
});

export default router;
