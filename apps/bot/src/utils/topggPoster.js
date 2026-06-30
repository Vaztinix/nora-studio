const axios = require('axios');

let lastPostTime = 0;
const MIN_POST_INTERVAL = 15000; // 15 seconds debounce/cooldown for manual updates on join/leave

async function postToTopgg(client, force = false) {
    const token = process.env.TOPGG_TOKEN;
    if (!token) {
        console.log('[Top.gg Poster] No TOPGG_TOKEN found in environment. Skipping post.');
        return;
    }

    const now = Date.now();
    if (!force && (now - lastPostTime < MIN_POST_INTERVAL)) {
        console.log('[Top.gg Poster] Post request throttled (cooldown active).');
        return;
    }

    try {
        const serverCount = client.guilds.cache.size;
        const botId = client.user.id;

        const res = await axios.post(`https://top.gg/api/bots/${botId}/stats`, 
            { server_count: serverCount },
            {
                headers: {
                    Authorization: token,
                    'Content-Type': 'application/json'
                }
            }
        );

        lastPostTime = Date.now();
        console.log(`[Top.gg Poster] Successfully posted server count of ${serverCount} to Top.gg.`);
    } catch (e) {
        const errMsg = e.response ? JSON.stringify(e.response.data) : e.message;
        console.error('[Top.gg Poster] Failed to post server count:', errMsg);
    }
}

module.exports = { postToTopgg };
