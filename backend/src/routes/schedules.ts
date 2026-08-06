import { Router, Request, Response } from 'express';
import { schedulerService } from '../services/schedulerService';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  res.json(await schedulerService.listSchedules());
});

router.post('/', async (req: Request, res: Response) => {
  const {
    name, specId, environmentId, cronExpression, enabled, notificationConfigId, fetchFromGithub,
    scmProvider, githubRepoUrl, githubBranch, githubScriptPath, githubToken,
    gitlabRepoUrl, gitlabBranch, gitlabScriptPath, gitlabToken,
  } = req.body;

  if (!name || !specId || !cronExpression) {
    return res.status(400).json({ error: 'name, specId, and cronExpression are required' });
  }

  const schedule = await schedulerService.createSchedule({
    name,
    specId,
    environmentId: environmentId || null,
    cronExpression,
    enabled: enabled !== false,
    notificationConfigId: notificationConfigId || null,
    fetchFromGithub: fetchFromGithub === true,
    scmProvider: scmProvider === 'gitlab' ? 'gitlab' : 'github',
    githubRepoUrl: githubRepoUrl || null,
    githubBranch: githubBranch || null,
    githubScriptPath: githubScriptPath || null,
    githubToken: githubToken || null,
    gitlabRepoUrl: gitlabRepoUrl || null,
    gitlabBranch: gitlabBranch || null,
    gitlabScriptPath: gitlabScriptPath || null,
    gitlabToken: gitlabToken || null,
  });

  return res.status(201).json(schedule);
});

router.put('/:id', async (req: Request, res: Response) => {
  const updated = await schedulerService.updateSchedule(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Schedule not found' });
  return res.json(updated);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const deleted = await schedulerService.deleteSchedule(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Schedule not found' });
  return res.status(204).send();
});

router.post('/:id/trigger', async (req: Request, res: Response) => {
  const result = await schedulerService.triggerNow(req.params.id);
  if ('notFound' in result) return res.status(404).json({ error: 'Schedule not found' });
  if ('skipped' in result) return res.status(409).json({ error: 'A run for this schedule is already in progress' });
  return res.json(result.execution);
});

router.get('/:id/executions', async (req: Request, res: Response) => {
  res.json(await schedulerService.listExecutions(req.params.id));
});

export default router;
