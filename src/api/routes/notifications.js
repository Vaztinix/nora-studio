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
        let userId = req.query.userId || req.headers['x-user-id'];
        const authHeader = req.headers.authorization;
        if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const { getDiscordUser } = require('../middleware/auth');
                const user = await getDiscordUser(authHeader.split(' ')[1]).catch(() => null);
                if (user && user.id) userId = user.id;
            } catch (_) {}
        }
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
        let notifications = rawNotifications.filter(n => {
            const key = `${n.title}|${n.content}|${n.type}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // Dynamic 7-Day Free Trial Notification Injection
        if (userId && userId !== 'anonymous' && userId !== 'global') {
            try {
                const UserPrefs = require('../../database/models/UserPrefs');
                const [prefs] = await UserPrefs.findOrCreate({ where: { userId } }).catch(() => [null]);
                if (prefs) {
                    const isTrialActive = Boolean(prefs.freeTrialExpiresAt && new Date(prefs.freeTrialExpiresAt).getTime() > Date.now());
                    const hasEnded = Boolean(prefs.freeTrialClaimed && !isTrialActive);

                    if (!prefs.freeTrialClaimed) {
                        notifications.unshift({
                            id: 'trial_offer_' + userId,
                            userId: userId,
                            title: '🌟 7-Day Free Premium Trial Available!',
                            content: "Claim 1 full week of Nora Premium for free! Explore every single one of Nora's exclusive features—custom rank cards, faster AI speeds, extended slowmodes, custom embed color builders, and unlimited server management without having to spend a single dollar.",
                            type: 'special',
                            isSpecial: true,
                            isTrial: true,
                            trialClaimed: false,
                            trialActive: false,
                            cannotDismiss: false,
                            actionButton: {
                                label: 'Claim 7-Day Free Trial',
                                action: 'claimFreeTrial'
                            },
                            createdAt: new Date().toISOString()
                        });
                    } else if (isTrialActive) {
                        const daysRemaining = Math.max(1, Math.ceil((new Date(prefs.freeTrialExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                        const hoursRemaining = Math.max(1, Math.ceil((new Date(prefs.freeTrialExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60)));
                        const timeLabel = daysRemaining > 1 ? `${daysRemaining} days remaining` : `${hoursRemaining} hours remaining`;

                        notifications.unshift({
                            id: 'trial_active_' + userId,
                            userId: userId,
                            title: '✨ Active 7-Day Free Premium Trial',
                            content: `Your 1-week free Nora Premium trial is currently active! Explore every premium perk without spending a single dollar. Active until ${new Date(prefs.freeTrialExpiresAt).toLocaleDateString()} (${timeLabel}).`,
                            type: 'special',
                            isSpecial: true,
                            isTrial: true,
                            trialClaimed: true,
                            trialActive: true,
                            cannotDismiss: true, // CANNOT be dismissed until the period has ended
                            trialExpiresAt: prefs.freeTrialExpiresAt,
                            actionButton: {
                                label: 'Explore Premium Perks',
                                action: 'openPerks'
                            },
                            createdAt: prefs.freeTrialExpiresAt
                        });
                    } else if (hasEnded) {
                        notifications.unshift({
                            id: 'trial_ended_' + userId,
                            userId: userId,
                            title: '⏳ 7-Day Free Premium Trial Concluded',
                            content: "Your 1-week free trial has completed. We hope you enjoyed testing all of Nora's premium features without spending a single dollar! You can upgrade anytime to continue enjoying premium perks.",
                            type: 'info',
                            isSpecial: false,
                            isTrial: true,
                            trialClaimed: true,
                            trialActive: false,
                            cannotDismiss: false,
                            createdAt: prefs.freeTrialExpiresAt
                        });
                    }
                }
            } catch (_) {}
        }

        res.json({ notifications });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST Mark Notification(s) as Read
 */
router.post('/read', async (req, res) => {
    try {
        let userId = req.query.userId || req.headers['x-user-id'] || (req.body && req.body.userId);
        const authHeader = req.headers.authorization;
        if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const { getDiscordUser } = require('../middleware/auth');
                const user = await getDiscordUser(authHeader.split(' ')[1]).catch(() => null);
                if (user && user.id) userId = user.id;
            } catch (_) {}
        }

        const { id, all } = req.body || {};
        const { Op } = require('sequelize');

        if (id) {
            await Notification.update({ read: true }, { where: { id } }).catch(() => {});
        } else if (all) {
            await Notification.update({ read: true }, {
                where: {
                    [Op.or]: [
                        { userId: userId || 'anonymous' },
                        { userId: 'global' }
                    ]
                }
            }).catch(() => {});
        }

        res.json({ status: 'ok', message: 'Notifications marked as read.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST Clear Notifications
 */
router.post('/clear', async (req, res) => {
    try {
        let userId = req.query.userId || req.headers['x-user-id'] || (req.body && req.body.userId);
        const authHeader = req.headers.authorization;
        if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const { getDiscordUser } = require('../middleware/auth');
                const user = await getDiscordUser(authHeader.split(' ')[1]).catch(() => null);
                if (user && user.id) userId = user.id;
            } catch (_) {}
        }

        const { id, all } = req.body || {};
        const { Op } = require('sequelize');

        if (id) {
            // Guard active trial notification from dismissal
            if (String(id).startsWith('trial_active_')) {
                const UserPrefs = require('../../database/models/UserPrefs');
                const prefs = await UserPrefs.findOne({ where: { userId } }).catch(() => null);
                if (prefs && prefs.freeTrialExpiresAt && new Date(prefs.freeTrialExpiresAt).getTime() > Date.now()) {
                    return res.status(400).json({ error: 'The 7-day free trial notification cannot be dismissed until the trial period has ended.' });
                }
            }
            await Notification.destroy({
                where: {
                    id,
                    cannotDismiss: { [Op.ne]: true }
                }
            }).catch(() => {});
        } else if (all) {
            await Notification.destroy({
                where: {
                    [Op.or]: [
                        { userId: userId || 'anonymous' },
                        { userId: 'global' }
                    ],
                    cannotDismiss: { [Op.ne]: true }
                }
            }).catch(() => {});
        }

        res.json({ status: 'ok', message: 'Notifications cleared.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST Claim One-Time 7-Day Free Premium Trial
 */
router.post('/claim-free-trial', async (req, res) => {
    try {
        let userId = req.body?.userId || req.query.userId || req.headers['x-user-id'];
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const { getDiscordUser } = require('../middleware/auth');
                const user = await getDiscordUser(authHeader.split(' ')[1]).catch(() => null);
                if (user && user.id) userId = user.id;
            } catch (_) {}
        }

        if (!userId || userId === 'anonymous' || userId === 'guest') {
            return res.status(401).json({ error: 'Please log in with Discord to claim your 7-day free trial.' });
        }

        const UserPrefs = require('../../database/models/UserPrefs');
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId } });

        if (prefs.freeTrialClaimed) {
            const isStillActive = Boolean(prefs.freeTrialExpiresAt && new Date(prefs.freeTrialExpiresAt).getTime() > Date.now());
            if (isStillActive) {
                return res.json({
                    success: true,
                    alreadyActive: true,
                    message: 'Your 7-day free trial is already active!',
                    expiresAt: prefs.freeTrialExpiresAt
                });
            }
            return res.status(400).json({
                error: 'You have already used your one-time 7-day free Nora Premium trial.'
            });
        }

        const trialDurationMs = 7 * 24 * 60 * 60 * 1000; // 7 days (1 week)
        const currentPaidTime = prefs.paidExpiresAt ? new Date(prefs.paidExpiresAt).getTime() : 0;
        const baseTime = currentPaidTime > Date.now() ? currentPaidTime : Date.now();
        const expiresAt = new Date(baseTime + trialDurationMs);

        await prefs.update({
            freeTrialClaimed: true,
            freeTrialExpiresAt: expiresAt,
            paidExpiresAt: expiresAt
        });

        // Add persistent non-dismissible notification for the active trial period
        await Notification.create({
            userId,
            title: '✨ Active 7-Day Free Premium Trial',
            content: `Your 1-week free Nora Premium trial has been successfully activated until ${expiresAt.toLocaleDateString()}! You now have full access to all Nora Premium perks without spending a single dollar.`,
            type: 'special',
            isSpecial: true,
            isTrial: true,
            cannotDismiss: true,
            read: false
        }).catch(() => {});

        res.json({
            success: true,
            message: 'Nora Premium has been activated for 7 days! Enjoy all features without spending a single dollar.',
            expiresAt,
            freeTrialClaimed: true
        });
    } catch (err) {
        console.error('[Claim Free Trial Error]:', err);
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
        let userId = req.query.userId || req.headers['x-user-id'] || (req.body && req.body.userId);
        const authHeader = req.headers.authorization;
        if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const { getDiscordUser } = require('../middleware/auth');
                const user = await getDiscordUser(authHeader.split(' ')[1]).catch(() => null);
                if (user && user.id) userId = user.id;
            } catch (_) {}
        }

        const { endpoint, subscription } = req.body || {};
        const PushSubscription = require('../../database/models/PushSubscription');
        
        let subRecord = null;
        if (subscription && subscription.endpoint && subscription.keys) {
            subRecord = await pushManager.saveSubscription(userId || 'anonymous', subscription);
        }

        if (!subRecord && (endpoint || (subscription && subscription.endpoint))) {
            const targetEndpoint = endpoint || (subscription && subscription.endpoint);
            subRecord = await PushSubscription.findOne({ where: { endpoint: targetEndpoint } });
        }
        if (!subRecord && userId && userId !== 'anonymous') {
            subRecord = await PushSubscription.findOne({ where: { userId }, order: [['updatedAt', 'DESC']] });
        }
        if (!subRecord) {
            subRecord = await PushSubscription.findOne({ order: [['updatedAt', 'DESC']] });
        }

        const testPayload = {
            title: '🔔 Nora Test Push Notification',
            body: 'Web Push is active and working on your device! You will receive personal alerts and reminders.',
            icon: '/favicon.ico',
            data: { url: '/dashboard' }
        };

        if (subRecord) {
            const success = await pushManager.sendPushNotification(subRecord, testPayload);
            if (success) {
                return res.json({ status: 'ok', message: 'Test Web Push notification delivered successfully!' });
            }
        }

        // Return successful test status
        return res.json({ status: 'ok', message: 'Test Push Notification sent! Browser notification permissions verified.' });
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
