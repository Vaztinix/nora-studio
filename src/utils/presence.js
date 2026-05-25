const RPC = require('discord-rpc');

function startPresence() {
    const clientId = '1375943730951098549'; // Nora Application ID
    const rpc = new RPC.Client({ transport: 'ipc' });

    rpc.on('ready', () => {
        // May 24, 2025 timestamp
        const startTime = new Date('May 24, 2025').getTime();

        rpc.setActivity({
            details: "Empowering your community",
            state: "Level up with Nora! 🚀",
            type: 0, // Playing
            startTimestamp: startTime, 
            largeImageKey: "nora", 
            largeImageText: "Nora Bot",
            party: {
                id: 'nora-activity',
                size: [1, 10],
            },
            buttons: [
                { label: "Community", url: "https://discord.gg/vaz74uUXNr" },
                { label: "Add Nora", url: "https://vaztinix.github.io/Nora" }
            ],
            instance: false,
        }).then(() => {
            console.log("-----------------------------------------");
            console.log("Nora Rich Presence is now LIVE!");
            console.log("Status: Empowering your community");
            console.log("Since: May 24, 2025");
            console.log("-----------------------------------------");
        }).catch(err => {
            console.error("RPC Error:", err);
        });
    });

    rpc.login({ clientId }).catch(err => {
        console.error("Failed to connect to Discord RPC:", err.message);
        console.log("Presence: Make sure local Discord client is running.");
    });
}

module.exports = { startPresence };
