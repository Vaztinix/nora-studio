const Topgg = require('@top-gg/sdk');
const axios = require('axios');

const NORA_BOT_ID = '1375943730951098549';
const NORA_V1 = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfdCI6IjgzMDU5NjgxMTMwOTk3NzYwMCIsImlkIjoiNzQwOTk4NTczMjM3ODI1NTM2IiwiaWF0IjoxNzc1ODY5NDg2fQ.cl3e3W2-8YYVVZHNFAevbSruTBNwnbDcuWRMhdk1udg';
const NORA_V0 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJib3QiOiJ0cnVlIiwiaWQiOiIxMzc1OTQzNzMwOTUxMDk4NTQ5IiwiaWF0IjoiMTc3MDc3MTYxNCJ9.o96WlKCfGM-Gzidt0laP_TYy2vEj6aaQ20qMXJRwc44';

module.exports = {
    updateStats: async (client) => {
        const serverCount = client.guilds.cache.size;

        try {
            await axios.post(`https://top.gg/api/bots/${client.user.id}/stats`, {
                server_count: serverCount
            }, {
                headers: { 'Authorization': NORA_V0, 'Content-Type': 'application/json' },
                timeout: 5000
            });
            console.log(`[Top.gg] Stats synchronized: ${serverCount} nodes.`);
        } catch (error) {
            console.error(`[Top.gg Error] Stat sync failed:`, error.message);
        }
    },

    publishCommands: async (client) => {
        const commandPayload = client.commands.map(cmd => cmd.data.toJSON());

        try {
            await axios.post(`https://top.gg/api/v1/projects/@me/commands`, commandPayload, {
                headers: { 'Authorization': NORA_V1, 'Content-Type': 'application/json' },
                timeout: 5000
            });
            console.log(`[Top.gg] Global command matrix published.`);
        } catch (error) {
            console.error(`[Top.gg Error] Command publish failed:`, error.message);
        }
    },

    hasVoted: async (userId) => {
        try {
            // Updated to the correct Bot-Specific Vote Check endpoint
            const res = await axios.get(`https://top.gg/api/bots/${NORA_BOT_ID}/check?userId=${userId}`, {
                headers: { 'Authorization': NORA_V0 },
                timeout: 5000
            });
            return res.data?.voted === 1 || res.data?.voted === true;
        } catch (error) {
            console.error('[Top.gg Error] Vote check failed:', error.message);
            return false;
        }
    }
};
