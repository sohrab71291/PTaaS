"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const schedulerService_1 = require("../services/schedulerService");
const router = (0, express_1.Router)();
router.get('/', (_req, res) => {
    res.json(schedulerService_1.schedulerService.listSchedules());
});
router.post('/', (req, res) => {
    const { name, specId, environmentId, cronExpression, enabled, notificationConfigId } = req.body;
    if (!name || !specId || !cronExpression) {
        return res.status(400).json({ error: 'name, specId, and cronExpression are required' });
    }
    const schedule = schedulerService_1.schedulerService.createSchedule({
        id: (0, uuid_1.v4)(),
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
router.put('/:id', (req, res) => {
    const updated = schedulerService_1.schedulerService.updateSchedule(req.params.id, req.body);
    if (!updated)
        return res.status(404).json({ error: 'Schedule not found' });
    return res.json(updated);
});
router.delete('/:id', (req, res) => {
    const deleted = schedulerService_1.schedulerService.deleteSchedule(req.params.id);
    if (!deleted)
        return res.status(404).json({ error: 'Schedule not found' });
    return res.status(204).send();
});
router.post('/:id/trigger', async (req, res) => {
    const result = await schedulerService_1.schedulerService.triggerNow(req.params.id);
    if (!result)
        return res.status(404).json({ error: 'Schedule not found' });
    return res.json(result);
});
exports.default = router;
