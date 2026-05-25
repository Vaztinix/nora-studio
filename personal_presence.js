const RPC = require('discord-rpc');

const clientId = '1492382737804427384'; // Corn Hub Application ID

const rpc = new RPC.Client({ transport: 'ipc' });

rpc.on('ready', () => {
    rpc.setActivity({
        details: "Watching Corn Hub",
        state: "Solo Gooning Session 🌽",
        type: 3, // Type 3 is 'Watching'
        
        // Set time to the absolute earliest (1970) which shows ~56 years
        startTimestamp: 1, 
        
        largeImageKey: "cornhub", // assets must be uploaded to the dev portal
        largeImageText: "Corn Hub",
        
        instance: false,
    });

    console.log("Corn Hub Rich Presence is now running!");
});

// Keep the process alive
process.stdin.resume();

rpc.login({ clientId }).catch(console.error);
