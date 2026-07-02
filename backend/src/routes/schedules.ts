import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { schedulerService } from '../services/schedulerService';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(schedulerService.listSchedules());
});

router.post('/', (req: Request, res: Response) => {
  const { name, specId, environmentId, cronExpression, enabled, notificationConfigId } = req.body;

  if (!name || !specId || !cronExpression) {
    return res.status(400).json({ error: 'name, specId, and cronExpression are required' });
  }

  const schedule = schedulerService.createSchedule({
    id: uuidv4(),
    name,
    specId,
    environmentId: environmentId || null,
    cronExpression,
    enabled: enabled !== false,
    notificationConfigId: notificationConfigId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunAt: null,
    nextRunAt: null,
  });

  return res.status(201).json(schedule);
});

router.put('/:id', (req: Request, res: Response) => {
  const updated = schedulerService.updateSchedule(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Schedule not found' });
  return res.json(updated);
});

router.delete('/:id', (req: Request, res: Response) => {
  const deleted = schedulerService.deleteSchedule(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Schedule not found' });
  return res.status(204).send();
});

router.post('/:id/trigger', async (req: Request, res: Response) => {
  const result = await schedulerService.triggerNow(req.params.id);
  if (!result) return res.status(404).json({ error: 'Schedule not found' });
  return res.json(result);
});

export default router;
