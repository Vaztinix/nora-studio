const axios = require('axios');
const { ActivityType } = require('discord.js');

/**
 * Nora Status Control
 * V18.6 - User Requested Presence Alignment
 */
async function updateBotStatus(client) {
    const defaultLink = 'https://vaztinix.github.io/Nora';
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
            // 🎯 User Defined: "Playing Nora" with the Link as Text
            client.user.setPresence({
                activities: [
                    {
                        name: 'Nora',
                        type: ActivityType.Playing
                    },
                    {
                        name: 'Custom Status',
                        type: ActivityType.Custom,
                        state: defaultLink
                    }
                ],
                status: 'online',
            });
        }
    } catch (error) {
        // Fallback to strict User requested defaults
        client.user.setPresence({
            activities: [
                {
                    name: 'Nora',
                    type: ActivityType.Playing
                },
                {
                    name: 'Custom Status',
                    type: ActivityType.Custom,
                    state: defaultLink
                }
            ],
            status: 'online',
        });
    }
}

module.exports = { updateBotStatus };
