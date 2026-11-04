const { ActivityType } = require('discord.js');

/**
 * Nora Dynamic Status & Presence Controller
 * Includes dynamic shard routing, personality/life statuses, motivational quotes,
 * site promotions, and feature tips.
 */

let statusIndex = 0;

const LIVELY_PERSONALITY_STATUSES = [
    '🌸 Humming quietly in voice chat',
    '☕ Sipping iced matcha & moderating chats',
    '✨ Zero-Access RAM Architecture • Ephemeral & Private',
    '🎮 Exploring Roblox worlds with the community',
    '🎵 Vibing to lo-fi beats with Vaztinix',
    '💡 Powered by Google Gemini 2.0 Flash',
    '📺 Helping Vaztinix control the Roku TV',
    '🛡️ Watching over servers with Sentinel AI',
    '🐾 Patting cute dogs in Milo\'s World',
    '🧩 Solving math equations in counting channels',
    '💬 What\'s on your mind? Mention me to chat!',
    '🌟 Level up your community with /setup',
    '⚡ Ultra-low latency | 0.0% background idle',
    '🔒 Inspect and erase your data anytime with /mycard',
    '🎨 Rendering custom canvas rank cards',
    '⭐ Watching the Starboard for top community moments',
    '🤝 Built with love by Vaztinix & Nora Studio Team'
];

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
    '🔗 Safe Roblox account linking via /verify',
    '🔒 1-Click Data Erasure available via /mycard',
    '📬 Contact Vaztinix anytime by DMing me!'
];

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

async function updateBotStatus(client) {
    if (!client.user) return;

    try {
        // Dynamic Sharding Telemetry:
        // Ensures servers only see their shard specific metrics, working dynamically whether single or multi-shard
        const shardId = client.shard ? client.shard.ids[0] : 0;
        const totalShards = client.shard ? client.shard.count : 1;
        const shardServerCount = client.guilds.cache.size;

        let shardMemberSum = 0;
        const uniqueMembers = new Set();
        client.guilds.cache.forEach(g => {
            shardMemberSum += (g.memberCount || g.approximateMemberCount || 0);
            if (g.members && g.members.cache) {
                g.members.cache.forEach((_, id) => uniqueMembers.add(id));
            }
        });
        if (client.users && client.users.cache) {
            client.users.cache.forEach((_, id) => uniqueMembers.add(id));
        }
        const memberCount = Math.max(shardMemberSum, uniqueMembers.size, client.users?.cache?.size || 0);
        const pingMs = Math.round(client.ws.ping) || 0;
        const uptimeStr = formatUptime(process.uptime());

        const shardTag = totalShards > 1 ? `Shard #${shardId}/${totalShards}` : `Shard #${shardId}`;

        const SHARD_METRICS = [
            `📡 ${shardTag} | Serving ${shardServerCount} servers`,
            `👥 ${shardTag} | Protecting ${memberCount.toLocaleString()} members`,
            `⚡ ${shardTag} | Ping: ${pingMs}ms • Uptime: ${uptimeStr}`,
            `🛡️ ${shardTag} | Zero-Access Architecture 100% Online`
        ];

        // Group status pools with high weight on lively & personality statuses
        const pools = [
            LIVELY_PERSONALITY_STATUSES,
            SHARD_METRICS,
            LIVELY_PERSONALITY_STATUSES,
            SITE_PROMOTIONS,
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
