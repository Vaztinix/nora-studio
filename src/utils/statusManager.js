const axios = require('axios');
const { ActivityType } = require('discord.js');

/**
 * Nora Dynamic Status & Presence Controller
 * Includes motivational quotes, shard metrics, site advertisements, feature tips, and live stream alerts.
 */

let statusIndex = 0;
let lastTwitchCheck = 0;
let cachedIsLive = false;

const MOTIVATIONAL_QUOTES = [
    '✨ "Small steps every day lead to big results."',
    '🌟 "Keep pushing forward — you\'re doing great!"',
    '💫 "The best way to predict the future is to create it."',
    '🎯 "Stay focused, stay positive, stay inspired."',
    '🚀 "Success starts with the courage to begin."',
    '⭐ "Believe you can and you\'re halfway there."',
    '🌱 "Every moment is a fresh beginning."',
    '🧠 "Your only limit is your mind."',
    '☀️ "Make today count!"',
    '🔥 "Dream big, work hard, stay humble."',
    '💡 "Turn obstacles into opportunities."',
    '🏆 "Consistency is the key to breakthrough."',
    '🌄 "Difficult roads often lead to beautiful destinations."'
];

const SITE_PROMOTIONS = [
    '🌐 https://vaztinix.dev',
    '⚙️ https://vaztinix.dev | Dashboard & Logs',
    '🛡️ https://vaztinix.dev | Secure Discord Bot',
    '🎮 https://vaztinix.dev/verify | Roblox Portal',
    '👥 https://vaztinix.dev/team | Nora Studio Team',
    '✨ Manage your server at vaztinix.dev'
];

const FEATURE_TIPS = [
    '📖 /help | Explore 50+ slash commands',
    '🔢 Play /counting with your server!',
    '📝 Play /onewordstory collaboratively!',
    '🏆 Earn chat XP and rank up with /level',
    '🛡️ Native Discord AutoMod ready via /setup automod',
    '🎫 Private Support Tickets ready via /setup ticket',
    '⭐ Starboard community voting via /setup starboard',
    '🔗 Safe Roblox account linking via /verify'
];

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

async function checkTwitchLive() {
    const now = Date.now();
    // Cache check for 60 seconds
    if (now - lastTwitchCheck < 60000) {
        return cachedIsLive;
    }
    lastTwitchCheck = now;
    const twitchUser = 'vaztinix';
    try {
        const response = await axios.get(`https://decapi.me/twitch/uptime/${twitchUser}`, { timeout: 3000 }).catch(() => ({ data: 'offline' }));
        cachedIsLive = Boolean(response.data && !response.data.toLowerCase().includes('offline'));
    } catch {
        cachedIsLive = false;
    }
    return cachedIsLive;
}

async function updateBotStatus(client) {
    if (!client.user) return;

    try {
        const isLive = await checkTwitchLive();

        if (isLive) {
            client.user.setPresence({
                activities: [{
                    name: 'vaztinix is LIVE!',
                    type: ActivityType.Streaming,
                    url: 'https://www.twitch.tv/vaztinix'
                }],
                status: 'online'
            });
            return;
        }

        const serverCount = client.guilds.cache.size;
        const memberCount = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
        const shardId = client.shard ? client.shard.ids[0] : 0;
        const pingMs = Math.round(client.ws.ping) || 0;
        const uptimeStr = formatUptime(process.uptime());

        const SHARD_METRICS = [
            `📡 Shard #${shardId} | Serving ${serverCount} servers`,
            `👥 Shard #${shardId} | Protecting ${memberCount.toLocaleString()} members`,
            `⚡ Shard #${shardId} | Ping: ${pingMs}ms • Uptime: ${uptimeStr}`,
            `🛡️ Shard #${shardId} | 100% Online`
        ];

        // Group status pools
        const pools = [
            SITE_PROMOTIONS,
            SHARD_METRICS,
            MOTIVATIONAL_QUOTES,
            FEATURE_TIPS
        ];

        // Cycle through categories evenly, picking next item
        const selectedPool = pools[statusIndex % pools.length];
        const currentStatus = selectedPool[Math.floor(statusIndex / pools.length) % selectedPool.length];
        statusIndex++;

        client.user.setPresence({
            activities: [
                {
                    name: 'Nora',
                    type: ActivityType.Playing
                },
                {
                    name: 'Custom Status',
                    type: ActivityType.Custom,
                    state: currentStatus
                }
            ],
            status: 'online'
        });
    } catch (error) {
        console.error('[Status Manager] Error updating status:', error?.message || error);
        try {
            client.user.setPresence({
                activities: [
                    {
                        name: 'Nora',
                        type: ActivityType.Playing
                    },
                    {
                        name: 'Custom Status',
                        type: ActivityType.Custom,
                        state: 'https://vaztinix.dev | /help'
                    }
                ],
                status: 'online'
            });
        } catch (_) {}
    }
}

module.exports = { updateBotStatus };
