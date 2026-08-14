const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const PushSubscription = require('../database/models/PushSubscription');

const VAPID_FILE = path.join(__dirname, '../../.vapid_keys.json');

// Generate or load VAPID Keys dynamically with persistent file fallback
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    if (fs.existsSync(VAPID_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
            if (saved.publicKey && saved.privateKey) {
                process.env.VAPID_PUBLIC_KEY = saved.publicKey;
                process.env.VAPID_PRIVATE_KEY = saved.privateKey;
                console.log('[PushManager] Loaded persistent VAPID keys from file.');
            }
        } catch (e) {
            console.error('[PushManager] Error reading .vapid_keys.json:', e.message);
        }
    }
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        try {
            const vapidKeys = webpush.generateVAPIDKeys();
            process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
            process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
            fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2), 'utf8');
            console.log('[PushManager] Generated & persisted new VAPID keys to file.');
        } catch (e) {
            console.error('[PushManager] Failed to generate VAPID keys:', e.message);
        }
    }
}

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(
            'mailto:vaztinixstudios@gmail.com',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
    } catch (e) {
        console.error('[PushManager] Error configuring VAPID details:', e.message);
    }
}

function getVapidPublicKey() {
    return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Save or update a Web Push subscription.
 */
async function saveSubscription(userId, sub) {
    if (!sub || !sub.endpoint || !sub.keys) return null;
    try {
        const [record] = await PushSubscription.upsert({
            userId: userId || 'anonymous',
            endpoint: sub.endpoint,
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth
        });
        return record;
    } catch (e) {
        console.error('[PushManager] Error saving push subscription:', e.message);
        return null;
    }
}

/**
 * Send Web Push notification to a single subscription.
 */
async function sendPushNotification(subRecord, payload) {
    if (!subRecord || !subRecord.endpoint || !subRecord.p256dh || !subRecord.auth) return false;
    
    const pushSubscription = {
        endpoint: subRecord.endpoint,
        keys: {
            p256dh: subRecord.p256dh,
            auth: subRecord.auth
        }
    };

    try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
        return true;
    } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
            // Subscription expired or unregistered -> clean up from DB
            await PushSubscription.destroy({ where: { endpoint: subRecord.endpoint } }).catch(() => {});
        } else {
            console.error('[PushManager] Failed to deliver push notification:', err.message);
        }
        return false;
    }
}

/**
 * Send Web Push notification to all subscriptions of a specific user.
 */
async function sendPushToUser(userId, payload) {
    if (!userId) return 0;
    try {
        const subs = await PushSubscription.findAll({ where: { userId } }).catch(() => []);
        let count = 0;
        for (const sub of subs) {
            const success = await sendPushNotification(sub, payload);
            if (success) count++;
        }
        return count;
    } catch (e) {
        console.error('[PushManager] Error sending push to user:', e.message);
        return 0;
    }
}

/**
 * Broadcast Web Push notification to ALL registered web app subscribers.
 */
async function broadcastPushNotification(payload) {
    try {
        const subs = await PushSubscription.findAll().catch(() => []);
        let sentCount = 0;
        for (const sub of subs) {
            const success = await sendPushNotification(sub, payload);
            if (success) sentCount++;
        }
        return sentCount;
    } catch (e) {
        console.error('[PushManager] Error broadcasting push notification:', e.message);
        return 0;
    }
}

/**
 * Creates a SiteAlert record, dispatches Web Push notifications, and bulk creates Notification records for all users.
 */
async function broadcastSiteAlert(title, message, type = 'announcement', authorId = '1214048435632603137') {
    const SiteAlert = require('../database/models/SiteAlert');
    const Notification = require('../database/models/Notification');

    const alertRecord = await SiteAlert.create({
        title: title || '📢 Nora Site Announcement',
        message,
        type,
        authorId,
        isActive: true
    });

    const pushPayload = {
        title: title || '📢 Nora Site Announcement',
        body: message,
        icon: '/favicon.ico',
        data: { url: '/dashboard' }
    };
    const sentPushCount = await broadcastPushNotification(pushPayload);

    // Create a single global notification entry for the notification center
    await Notification.create({
        userId: 'global',
        title: title || '📢 Nora Site Announcement',
        content: message,
        type: type === 'warning' ? 'warning' : 'special',
        read: false,
        isSpecial: true,
        isOwnerAction: true
    }).catch(() => {});

    return { alertRecord, sentPushCount };
}

module.exports = {
    getVapidPublicKey,
    saveSubscription,
    sendPushToUser,
    broadcastPushNotification,
    broadcastSiteAlert
};
