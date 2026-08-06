"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const schedulerService_1 = require("../services/schedulerService");
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    res.json(await schedulerService_1.schedulerService.listSchedules());
});
router.post('/', async (req, res) => {
    const { name, specId, environmentId, cronExpression, enabled, notificationConfigId, fetchFromGithub, scmProvider, githubRepoUrl, githubBranch, githubScriptPath, githubToken, gitlabRepoUrl, gitlabBranch, gitlabScriptPath, gitlabToken, } = req.body;
    if (!name || !specId || !cronExpression) {
        return res.status(400).json({ error: 'name, specId, and cronExpression are required' });
    }
    const schedule = await schedulerService_1.schedulerService.createSchedule({
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
router.put('/:id', async (req, res) => {
    const updated = await schedulerService_1.schedulerService.updateSchedule(req.params.id, req.body);
    if (!updated)
        return res.status(404).json({ error: 'Schedule not found' });
    return res.json(updated);
});
router.delete('/:id', async (req, res) => {
    const deleted = await schedulerService_1.schedulerService.deleteSchedule(req.params.id);
    if (!deleted)
        return res.status(404).json({ error: 'Schedule not found' });
    return res.status(204).send();
});
router.post('/:id/trigger', async (req, res) => {
    const result = await schedulerService_1.schedulerService.triggerNow(req.params.id);
    if ('notFound' in result)
        return res.status(404).json({ error: 'Schedule not found' });
    if ('skipped' in result)
        return res.status(409).json({ error: 'A run for this schedule is already in progress' });
    return res.json(result.execution);
});
router.get('/:id/executions', async (req, res) => {
    res.json(await schedulerService_1.schedulerService.listExecutions(req.params.id));
});
exports.default = router;
