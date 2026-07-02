import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { notificationService } from '../services/notificationService';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(notificationService.listConfigs());
});

router.post('/', (req: Request, res: Response) => {
  const { name, type, trigger, emailRecipients, teamsWebhookUrl } = req.body;

  if (!name || !type || !trigger) {
    return res.status(400).json({ error: 'name, type, and trigger are required' });
  }
  if (type === 'email' && (!emailRecipients || emailRecipients.length === 0)) {
    return res.status(400).json({ error: 'emailRecipients required for email type' });
  }
  if (type === 'teams' && !teamsWebhookUrl) {
    return res.status(400).json({ error: 'teamsWebhookUrl required for teams type' });
  }

  const config = notificationService.createConfig({
    id: uuidv4(),
    name,
    type,
    trigger,
    emailRecipients: emailRecipients || [],
    teamsWebhookUrl: teamsWebhookUrl || null,
    enabled: true,
    createdAt: new Date().toISOString(),
  });

  return res.status(201).json(config);
});

router.put('/:id', (req: Request, res: Response) => {
  const updated = notificationService.updateConfig(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Notification config not found' });
  return res.json(updated);
});

router.delete('/:id', (req: Request, res: Response) => {
  const deleted = notificationService.deleteConfig(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Notification config not found' });
  return res.status(204).send();
});

router.post('/:id/test', async (req: Request, res: Response) => {
  const result = await notificationService.sendTest(req.params.id);
  if (!result) return res.status(404).json({ error: 'Notification config not found' });
  return res.json(result);
});

export default router;
