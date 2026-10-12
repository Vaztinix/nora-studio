const express = require('express');
const router = express.Router();
const rokuController = require('../../utils/rokuController');
const { getDiscordUser } = require('../middleware/auth');

const WHITELISTED_GUILDS = ['1487342521133830174', '1515800329889779954'];
const AUTHORIZED_USER_ID = '1214048435632603137';

module.exports = function (client) {
    /**
     * GET /api/roku/status?guildId=...
     * Returns live status of the Roku Smart TV if guild is whitelisted
     */
    router.get('/status', async (req, res) => {
        try {
            const guildId = req.query.guildId;
            if (!guildId || !WHITELISTED_GUILDS.includes(String(guildId))) {
                return res.status(403).json({
                    success: false,
                    whitelisted: false,
                    message: 'Roku Smart TV hardware integration is strictly restricted to authorized headquarters servers (1487342521133830174, 1515800329889779954).'
                });
            }

            const user = getDiscordUser(req);
            const isAuthorized = user ? rokuController.isAuthorized(user.id) : false;
            const remainingTries = user ? rokuController.getRemainingTries(user.id) : 0;
            const allowedScopes = user ? rokuController.formatAllowedScopes(user.id) : '';

            // Query device info asynchronously with timeout
            const deviceInfo = await Promise.race([
                rokuController.getDeviceInfo(),
                new Promise(resolve => setTimeout(() => resolve(null), 2500))
            ]);

            const activeApp = await Promise.race([
                rokuController.getActiveApp(),
                new Promise(resolve => setTimeout(() => resolve(null), 2000))
            ]);

            const guests = rokuController.refreshGuestAccess();
            const guestList = [];
            for (const [id, data] of Object.entries(guests)) {
                let name = `User ${id}`;
                if (client && client.users) {
                    const u = client.users.cache.get(id);
                    if (u) name = u.tag || u.username;
                }
                guestList.push({
                    id,
                    name,
                    tries: data.tries,
                    allowedScopes: data.allowedScopes || ['full'],
                    grantedAt: data.grantedAt
                });
            }

            return res.json({
                success: true,
                whitelisted: true,
                isOnline: Boolean(deviceInfo),
                powerMode: deviceInfo?.powerMode || (deviceInfo ? 'PowerOn' : 'Unknown'),
                activeApp: activeApp ? { id: activeApp.id, name: activeApp.name } : null,
                deviceInfo: deviceInfo ? {
                    modelName: deviceInfo.modelName || 'Roku TV',
                    friendlyName: deviceInfo.friendlyDeviceName || 'Living Room Roku',
                    softwareVersion: deviceInfo.softwareVersion
                } : null,
                isAuthorized,
                remainingTries,
                allowedScopes,
                isOwner: user?.id === AUTHORIZED_USER_ID,
                guestList: user?.id === AUTHORIZED_USER_ID ? guestList : []
            });
        } catch (err) {
            console.error('[Roku API] Status error:', err);
            return res.status(500).json({ success: false, message: 'Failed to inspect Roku TV state.' });
        }
    });

    /**
     * POST /api/roku/control
     * Dispatches hardware commands to the Roku TV
     */
    router.post('/control', async (req, res) => {
        try {
            const { guildId, action, app, message: tvMessage, amount, text } = req.body;
            if (!guildId || !WHITELISTED_GUILDS.includes(String(guildId))) {
                return res.status(403).json({
                    success: false,
                    message: 'Roku Smart TV hardware integration is strictly restricted to authorized headquarters servers (1487342521133830174, 1515800329889779954).'
                });
            }

            const user = getDiscordUser(req);
            if (!user) {
                return res.status(401).json({ success: false, message: 'You must be logged in to control the Roku TV.' });
            }

            if (!rokuController.isAuthorized(user.id)) {
                return res.status(403).json({
                    success: false,
                    message: `Access Denied: Roku Smart TV control is restricted to developer <@${AUTHORIZED_USER_ID}> or users with active guest passes.`
                });
            }

            const params = { action, app, message: tvMessage, amount, text };
            const result = await rokuController._executeRokuAction(user, action, params);
            const safeMsg = rokuController.sanitizeMessage(result?.message || 'Action executed successfully.');

            return res.json({
                success: result.success,
                message: safeMsg,
                remainingTries: rokuController.getRemainingTries(user.id)
            });
        } catch (err) {
            console.error('[Roku API] Control error:', err);
            return res.status(500).json({ success: false, message: 'Failed to execute Roku action.' });
        }
    });

    /**
     * POST /api/roku/guest-access
     * Developer-only endpoint to grant or revoke guest passes
     */
    router.post('/guest-access', async (req, res) => {
        try {
            const { guildId, op, targetUserId, tries, permissions } = req.body;
            if (!guildId || !WHITELISTED_GUILDS.includes(String(guildId))) {
                return res.status(403).json({ success: false, message: 'Unauthorized server.' });
            }

            const user = getDiscordUser(req);
            if (!user || user.id !== AUTHORIZED_USER_ID) {
                return res.status(403).json({ success: false, message: 'Only the Head Developer can manage guest access.' });
            }

            let resultMsg = '';
            if (op === 'grant') {
                const grantRes = rokuController.grantGuestAccess(targetUserId, tries || 1, permissions || 'full');
                resultMsg = grantRes.message;
            } else if (op === 'revoke') {
                const revRes = rokuController.revokeGuestAccess(targetUserId);
                resultMsg = revRes.message;
            } else {
                return res.status(400).json({ success: false, message: 'Invalid operation.' });
            }

            return res.json({ success: true, message: rokuController.sanitizeMessage(resultMsg) });
        } catch (err) {
            console.error('[Roku API] Guest access error:', err);
            return res.status(500).json({ success: false, message: 'Failed to update guest access.' });
        }
    });

    return router;
};
