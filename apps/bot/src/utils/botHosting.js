const axios = require('axios');

/**
 * Validates a Discord bot token and retrieves basic info
 * @param {string} token - The bot token to validate
 * @returns {Promise<Object>} - Bot info { id, username, avatar, isBot } or throws error
 */
async function validateBotToken(token) {
    try {
        const response = await axios.get('https://discordapp.com/api/v10/users/@me', {
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });

        const data = response.data;
        if (!data.bot) {
            throw new Error('Token belongs to a user account, not a bot. Bots only.');
        }

        return {
            id: data.id,
            username: data.username,
            avatar: data.avatar,
            isBot: data.bot,
            discriminator: data.discriminator || '0',
            publicFlags: data.public_flags || 0
        };
    } catch (error) {
        if (error.response?.status === 401) {
            throw new Error('Invalid or expired bot token. Please verify the token is correct.');
        } else if (error.response?.status === 429) {
            throw new Error('Rate limited by Discord API. Please try again in a few moments.');
        } else if (error.message.includes('Token belongs to a user')) {
            throw error;
        }
        throw new Error(`Failed to validate token: ${error.message}`);
    }
}

/**
 * Generates a Discord OAuth invite URL for a bot
 * @param {string} botId - The bot's Discord ID
 * @param {string} scopes - OAuth scopes (default: bot)
 * @param {string} permissions - Permission integer (default: admin=8)
 * @returns {string} - OAuth invite URL
 */
function generateBotInviteUrl(botId, scopes = 'bot', permissions = '8') {
    return `https://discord.com/api/oauth2/authorize?client_id=${botId}&permissions=${permissions}&scope=${scopes}`;
}

module.exports = {
    validateBotToken,
    generateBotInviteUrl
};
