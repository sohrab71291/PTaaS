"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const notificationService_1 = require("../services/notificationService");
const router = (0, express_1.Router)();
router.get('/', (_req, res) => {
    res.json(notificationService_1.notificationService.listConfigs());
});
router.post('/', (req, res) => {
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
    const config = notificationService_1.notificationService.createConfig({
        id: (0, uuid_1.v4)(),
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
router.put('/:id', (req, res) => {
    const updated = notificationService_1.notificationService.updateConfig(req.params.id, req.body);
    if (!updated)
        return res.status(404).json({ error: 'Notification config not found' });
    return res.json(updated);
});
router.delete('/:id', (req, res) => {
    const deleted = notificationService_1.notificationService.deleteConfig(req.params.id);
    if (!deleted)
        return res.status(404).json({ error: 'Notification config not found' });
    return res.status(204).send();
});
router.post('/:id/test', async (req, res) => {
    const result = await notificationService_1.notificationService.sendTest(req.params.id);
    if (!result)
        return res.status(404).json({ error: 'Notification config not found' });
    return res.json(result);
});
exports.default = router;
