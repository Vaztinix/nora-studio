/**
 * Static Bold Font & Presence Controller for Nora
 * Keeps a clean static bold font name (𝗡𝗼𝗿𝗮) without server nickname spam or audit log alerts.
 */

const STATUS_FRAMES = [
    '𝗡𝗼𝗿𝗮 | https://vaztinix.dev',
    '𝗡𝗼𝗿𝗮 | /help',
    '𝗡𝗼𝗿𝗮 | Privacy First AI & Moderation'
];

let frameIndex = 0;

function nextStatusFrame() {
    frameIndex = (frameIndex + 1) % STATUS_FRAMES.length;
    return STATUS_FRAMES[frameIndex];
}

/**
 * Start the Presence Controller (No Nickname Loop = Zero Audit Log Alerts)
 */
function startNameAnimator(client) {
    console.log('[Presence Controller] Active with clean static bold font (𝗡𝗼𝗿𝗮).');

    // Single static nickname check on startup to reset any custom nicknames if needed (runs once only)
    setTimeout(async () => {
        for (const guild of client.guilds.cache.values()) {
            try {
                const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
                if (me && me.nickname) {
                    // Reset nickname so Global Display Name (𝗡𝗼𝗿𝗮) shows without server nickname override logs
                    await me.setNickname(null).catch(() => {});
                }
            } catch (e) {}
        }
    }, 5000);

    // Status Activity Rotation every 30 seconds (Presence state only, zero audit logs)
    setInterval(() => {
        const statusText = nextStatusFrame();
        if (client.user) {
            client.user.setPresence({
                activities: [
                    {
                        name: 'Nora',
                        type: 0 // Playing
                    },
                    {
                        name: 'Custom Status',
                        type: 4, // Custom Status
                        state: statusText
                    }
                ],
                status: 'online'
            });
        }
    }, 30000);
}

module.exports = {
    startNameAnimator
};
