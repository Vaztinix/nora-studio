const express = require('express');
const router = express.Router();
const pushManager = require('../../utils/pushManager');
const Reminder = require('../../database/models/Reminder');
const SiteAlert = require('../../database/models/SiteAlert');
const Notification = require('../../database/models/Notification');

/**
 * GET VAPID Public Key for Web Push Subscriptions
 */
router.get('/vapid-key', (req, res) => {
    const key = pushManager.getVapidPublicKey();
    res.json({ publicKey: key });
});

/**
 * GET User Notifications & Broadcasts
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.query.userId || req.headers['x-user-id'];
        const { Op } = require('sequelize');

        const notifications = await Notification.findAll({
            where: {
                [Op.or]: [
                    { userId: userId || 'anonymous' },
                    { isOwnerAction: true },
                    { isSpecial: true }
                ]
            },
            order: [['createdAt', 'DESC']],
            limit: 50
        }).catch(() => []);

        res.json({ notifications });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST Subscribe to Web Push Notifications
 */
router.post('/subscribe', async (req, res) => {
    try {
        const { subscription, userId } = req.body || {};
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ error: 'Valid push subscription object required.' });
        }
        const record = await pushManager.saveSubscription(userId || 'anonymous', subscription);
        res.json({ status: 'ok', message: 'Subscribed to Web Push Notifications successfully.', id: record ? record.id : null });
    } catch (err) {
        console.error('[Notifications API] Error saving subscription:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET User Reminders
 */
router.get('/reminders', async (req, res) => {
    try {
        const userId = req.query.userId || req.headers['x-user-id'];
        if (!userId) {
            return res.json({ reminders: [] });
        }
        const reminders = await Reminder.findAll({
            where: { userId, isTriggered: false }
        }).catch(() => []);

        res.json({ reminders });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST Create New Reminder
 */
router.post('/reminders', async (req, res) => {
    try {
        const { userId, message, triggerTime, delayMinutes } = req.body || {};
        if (!message) {
            return res.status(400).json({ error: 'Reminder message content required.' });
        }

        let computedTime = triggerTime;
        if (!computedTime && delayMinutes) {
            computedTime = Date.now() + (parseInt(delayMinutes, 10) * 60 * 1000);
        }
        if (!computedTime || computedTime <= Date.now()) {
            return res.status(400).json({ error: 'Valid future trigger time required.' });
        }

        const reminder = await Reminder.create({
            userId: userId || 'anonymous',
            message: message.slice(0, 500),
            triggerTime: computedTime,
            isTriggered: false
        });

        res.json({ status: 'ok', reminder });
    } catch (err) {
        console.error('[Reminders API] Error creating reminder:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE Delete Reminder
 */
router.delete('/reminders/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await Reminder.destroy({ where: { id } }).catch(() => {});
        res.json({ status: 'ok', message: 'Reminder deleted.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET Active Owner Site Alerts for Dashboard Banner
 */
router.get('/site-alerts', async (req, res) => {
    try {
        const alerts = await SiteAlert.findAll({
            where: { isActive: true },
            order: [['createdAt', 'DESC']],
            limit: 5
        }).catch(() => []);

        res.json({ alerts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
