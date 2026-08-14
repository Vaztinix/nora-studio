/**
 * Animated Name & Presence Controller for Nora
 * Cycles cool styled fonts and glowing symbols for Nora's server nickname and presence status.
 */

const ANIMATED_FRAMES = [
    '✦ 𝗡𝗼𝗿𝗮 ✦',
    '⚡ 𝗡𝗼𝗿𝗮 ⚡',
    '⬡ 𝗡𝗼𝗿𝗮 ⬡',
    '❖ 𝗡𝗼𝗿𝗮 ❖',
    '🪐 𝗡𝗼𝗿𝗮 🪐',
    '✨ 𝗡𝗼𝗿𝗮 ✨',
    '◈ 𝗡𝗼𝗿𝗮 ◈',
    '✵ 𝗡𝗼𝗿𝗮 ✵'
];

let frameIndex = 0;

/**
 * Get the current animated name frame.
 */
function getCurrentFrame() {
    return ANIMATED_FRAMES[frameIndex % ANIMATED_FRAMES.length];
}

/**
 * Advance to next frame.
 */
function nextFrame() {
    frameIndex = (frameIndex + 1) % ANIMATED_FRAMES.length;
    return getCurrentFrame();
}

async function updateAllGuildNicknames(client, nickname) {
    const targetName = nickname || '𝗡𝗼𝗿𝗮';
    for (const guild of client.guilds.cache.values()) {
        try {
            const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
            if (me && me.nickname && me.nickname !== targetName) {
                // Reset nickname if it's plain text so global_name (𝗡𝗼𝗿𝗮) displays automatically
                await me.setNickname(targetName).catch(async () => {
                    await me.setNickname(null).catch(() => {});
                });
            }
        } catch (e) {}
    }
}

/**
 * Start the Nickname & Status Animation Loop
 */
function startNameAnimator(client) {
    console.log('[Name Animator] Setting Nora cool bold font name (𝗡𝗼𝗿𝗮) across servers...');

    // 1. Immediate sync on startup
    setTimeout(() => {
        updateAllGuildNicknames(client, '𝗡𝗼𝗿𝗮');
    }, 3000);

    // 2. Status Activity Animation every 12 seconds
    setInterval(() => {
        const frame = nextFrame();
        if (client.user) {
            client.user.setPresence({
                activities: [
                    {
                        name: frame,
                        type: 4, // Custom Status
                        state: `${frame} | https://vaztinix.dev`
                    }
                ],
                status: 'online'
            });
        }
    }, 12000);

    // 3. Server Nickname Sync every 60 seconds
    setInterval(() => {
        const frame = getCurrentFrame();
        updateAllGuildNicknames(client, frame);
    }, 60000);
}

module.exports = {
    ANIMATED_FRAMES,
    getCurrentFrame,
    nextFrame,
    startNameAnimator,
    updateAllGuildNicknames
};
