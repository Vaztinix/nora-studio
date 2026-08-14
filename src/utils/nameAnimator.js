/**
 * Static Bold Font & Presence Controller for Nora
 * Keeps a clean static bold font name (𝗡𝗼𝗿𝗮) without server nickname changes or emojis.
 */

const STATUS_FRAMES = [
    'https://vaztinix.dev',
    '/help',
    'Nora Studio'
];

let frameIndex = 0;

function nextStatusFrame() {
    frameIndex = (frameIndex + 1) % STATUS_FRAMES.length;
    return STATUS_FRAMES[frameIndex];
}

/**
 * Start the Presence Controller (Zero Nickname Changes = Zero Audit Logs)
 */
function startNameAnimator(client) {
    console.log('[Presence Controller] Active with static bold font name (𝗡𝗼𝗿𝗮).');

    // Status Activity Rotation every 30 seconds (Presence state only, no nicknames, no emojis)
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
