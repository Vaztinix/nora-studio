const WebSocket = require('ws');
const { cache } = require('../utils/settingsCache');

function startWSSync() {
    const wsUrl = process.env.WS_SERVER_URL || 'ws://localhost:4000';
    console.log(`[Sync Client] Connecting to Central Real-Time Sync Server: ${wsUrl}`);
    
    let ws = new WebSocket(wsUrl);

    ws.on('open', () => {
        console.log('[Sync Client] Connected to Central Real-Time Sync Server.');
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.event === 'GUILD_UPDATE') {
                console.log(`[Sync Client] Hot-refreshing cached settings for guild: ${data.guildId}`);
                cache.set(data.guildId, data.settings);
            }
        } catch (e) {
            console.error('[Sync Client] Failed to parse sync event:', e.message);
        }
    });

    ws.on('close', () => {
        console.warn('[Sync Client] Closed connection. Retrying sync in 5s...');
        setTimeout(startWSSync, 5000);
    });

    ws.on('error', (err) => {
        console.error('[Sync Client] WebSocket Connection Error:', err.message);
    });
}

module.exports = { startWSSync };
