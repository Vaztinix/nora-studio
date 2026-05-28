const axios = require('axios');
const { ActivityType } = require('discord.js');

/**
 * Nora Status Control
 * V18.6 - User Requested Presence Alignment
 */
let statusIndex = 0;

async function updateBotStatus(client) {
    const twitchUser = 'vaztinix';

    try {
        const response = await axios.get(`https://decapi.me/twitch/uptime/${twitchUser}`).catch(() => ({ data: 'offline' }));
        const isLive = response.data && !response.data.toLowerCase().includes('offline');

        if (isLive) {
            client.user.setPresence({
                activities: [{
                    name: `vaztinix is LIVE!`,
                    type: ActivityType.Streaming,
                    url: `https://www.twitch.tv/${twitchUser}`
                }],
                status: 'online',
            });
        } else {
            const serverCount = client.guilds.cache.size;
            const memberCount = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);

            const statuses = [
                'https://vaztinix.dev',
                'https://vaztinix.dev | /help',
                `https://vaztinix.dev | ${serverCount} servers`,
                `https://vaztinix.dev | ${memberCount} members`,
                'https://vaztinix.dev | Nora Studio'
            ];

            const currentStatus = statuses[statusIndex % statuses.length];
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
                status: 'online',
            });
        }
    } catch (error) {
        console.error('[Status Manager] Error updating status:', error);
        client.user.setPresence({
            activities: [
                {
                    name: 'Nora',
                    type: ActivityType.Playing
                },
                {
                    name: 'Custom Status',
                    type: ActivityType.Custom,
                    state: 'https://vaztinix.dev'
                }
            ],
            status: 'online',
        });
    }
}

module.exports = { updateBotStatus };
