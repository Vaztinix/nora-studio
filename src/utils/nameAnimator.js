/**
 * Static Bold Font & Presence Controller for Nora
 * Coordinates with statusManager for rich dynamic status rotations.
 */

const { updateBotStatus } = require('./statusManager');

function startNameAnimator(client) {
    console.log('[Presence Controller] Active with static bold font name (𝗡𝗼𝗿𝗮) & dynamic status engine.');
    // Initial status update
    updateBotStatus(client).catch(() => {});
    // Regular rotation every 30 seconds
    setInterval(() => {
        updateBotStatus(client).catch(() => {});
    }, 30000);
}

module.exports = {
    startNameAnimator
};
