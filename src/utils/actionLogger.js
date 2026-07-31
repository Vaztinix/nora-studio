const ActionLog = require('../database/models/ActionLog');
const { getDiscordUser } = require('../api/middleware/auth');

/**
 * Utility function to log an administrative action performed on Nora's site per server.
 * 
 * @param {Object} options
 * @param {string} options.guildId - Server / Guild ID
 * @param {Object} options.req - Express Request object
 * @param {string} options.action - Action identifier (e.g. 'UPDATE_SETTINGS', 'EXECUTE_MOD_ACTION')
 * @param {string} options.details - Human-readable details of what changed
 */
async function logServerAction({ guildId, req, action, details }) {
    try {
        if (!guildId || !action) return;

        let userId = null;
        let username = 'Dashboard Administrator';
        let userAvatar = null;

        if (req) {
            let user = req.discordUser || null;
            if (!user && req.headers && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
                const token = req.headers.authorization.split(' ')[1];
                if (token === 'nora_mock_token') {
                    userId = '1214048435632603137';
                    username = 'Nora Admin';
                    userAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
                } else {
                    user = await getDiscordUser(token).catch(() => null);
                }
            }

            if (user) {
                userId = user.id;
                username = user.discriminator && user.discriminator !== '0'
                    ? `${user.username}#${user.discriminator}`
                    : user.username;

                if (user.avatar) {
                    userAvatar = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
                } else {
                    userAvatar = `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id || 0) >> 22n) % 5n}.png`;
                }
            }
        }

        const ipAddress = req ? (req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || null) : null;

        await ActionLog.create({
            guildId,
            userId,
            username,
            userAvatar,
            action,
            details,
            ipAddress: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : null
        });
    } catch (error) {
        console.error(`[ActionLogger] Error recording action log for guild ${guildId}:`, error);
    }
}

module.exports = {
    logServerAction
};
