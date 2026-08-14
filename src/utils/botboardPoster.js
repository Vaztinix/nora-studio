const axios = require('axios');

let lastPostTime = 0;
const MIN_POST_INTERVAL = 15000; // 15 seconds debounce/cooldown for join/leave events

/**
 * Posts live server count to BotBoard.gg API.
 * @param {import('discord.js').Client} client 
 * @param {boolean} force 
 */
async function postToBotBoard(client, force = false) {
    const token = process.env.BOTBOARD_API_TOKEN || process.env.BOTBOARD_API_KEY || 'bb_k7uWDA-H9uAZcNaufnFcpgdKVRI3oYGN';

    const now = Date.now();
    if (!force && (now - lastPostTime < MIN_POST_INTERVAL)) {
        return;
    }

    try {
        const serverCount = client.guilds && client.guilds.cache ? client.guilds.cache.size : 0;
        if (serverCount <= 0) return;

        const botId = client.user ? client.user.id : '1375943730951098549';
        const authHeader = token.startsWith('Bearer ') ? token : token;

        await axios.post(`https://www.botboard.gg/api/v1/bots/${botId}/stats`, 
            { server_count: serverCount },
            {
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        lastPostTime = Date.now();
        console.log(`[BotBoard Poster] Successfully posted live server count of ${serverCount} to BotBoard.gg.`);
    } catch (err) {
        if (err.response && err.response.status === 404) {
            // Bot listing unapproved or pending on BotBoard API
        } else {
            console.warn(`[BotBoard Poster Warning] Failed to post server count to BotBoard.gg:`, err.message);
        }
    }
}

module.exports = { postToBotBoard };
