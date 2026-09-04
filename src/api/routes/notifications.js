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

        const rawNotifications = await Notification.findAll({
            where: {
                [Op.or]: [
                    { userId: userId || 'anonymous' },
                    { userId: 'global' }
                ]
            },
            order: [['createdAt', 'DESC']],
            limit: 50
        }).catch(() => []);

        // Deduplicate notifications by title, content, and type
        const seen = new Set();
        const notifications = rawNotifications.filter(n => {
            const key = `${n.title}|${n.content}|${n.type}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

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
 * POST Test Web Push Notification Delivery
 */
router.post('/test-push', async (req, res) => {
    try {
        const { userId, endpoint, subscription } = req.body || {};
        const PushSubscription = require('../../database/models/PushSubscription');
        
        if (subscription && subscription.endpoint && subscription.keys) {
            await pushManager.saveSubscription(userId || 'anonymous', subscription);
        }

        let subRecord = null;
        if (endpoint || (subscription && subscription.endpoint)) {
            const targetEndpoint = endpoint || (subscription && subscription.endpoint);
            subRecord = await PushSubscription.findOne({ where: { endpoint: targetEndpoint } });
        }
        if (!subRecord && userId && userId !== 'anonymous') {
            subRecord = await PushSubscription.findOne({ where: { userId }, order: [['updatedAt', 'DESC']] });
        }

        if (!subRecord) {
            return res.status(404).json({ error: 'No active Web Push subscription found for your device. Please click Enable Push Notifications first.' });
        }

        const testPayload = {
            title: '🔔 Nora Test Push Notification',
            body: 'Web Push is active and working on your device! You will receive personal alerts and reminders.',
            icon: '/favicon.ico',
            data: { url: '/dashboard' }
        };

        const success = await pushManager.sendPushNotification(subRecord, testPayload);
        if (success) {
            return res.json({ status: 'ok', message: 'Test Web Push notification delivered successfully!' });
        } else {
            return res.status(500).json({ error: 'Failed to deliver push notification to browser endpoint.' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET User Reminders
 */
router.get('/reminders', async (req, res) => {
    try {
        const userId = req.query.userId || req.headers['x-user-id'];
        if (!userId || userId === 'anonymous') {
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
        
        // Strict user validation: Reminders MUST belong to a specific Discord user
        if (!userId || userId === 'anonymous' || !/^\d{17,20}$/.test(String(userId).trim())) {
            return res.status(401).json({ error: 'You must be logged in with Discord to schedule personal reminders.' });
        }

        if (!message || !message.trim()) {
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
            userId: String(userId).trim(),
            message: message.trim().slice(0, 500),
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
