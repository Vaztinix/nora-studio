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

/**
 * Start the Nickname & Status Animation Loop
 */
function startNameAnimator(client) {
    console.log('[Name Animator] Starting Nora Animated Name system...');

    // 1. Status Activity Animation every 12 seconds
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

    // 2. Server Nickname Animation every 3 minutes (respecting Discord guild rate limits)
    setInterval(async () => {
        const frame = getCurrentFrame();
        for (const guild of client.guilds.cache.values()) {
            try {
                const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
                if (me && me.permissions.has('ChangeNickname')) {
                    if (me.nickname !== frame) {
                        await me.setNickname(frame).catch(() => {});
                    }
                }
            } catch (e) {}
        }
    }, 180000);
}

module.exports = {
    ANIMATED_FRAMES,
    getCurrentFrame,
    nextFrame,
    startNameAnimator
};
