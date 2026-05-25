const RPC = require('./presence/node_modules/discord-rpc');
const rpc = new RPC.Client({ transport: 'ipc' });

rpc.on('ready', () => {
    console.log('SUCCESS: Connected to Discord with Nora ID 1375943730951098549');
    process.exit(0);
});

rpc.on('disconnected', () => {
    console.log('DISCONNECTED');
});

rpc.login({ clientId: '1375943730951098549' }).catch(err => {
    console.log('ERROR LOGGING IN:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.log('TIMEOUT: Did not connect within 5 seconds');
    process.exit(1);
}, 5000);
