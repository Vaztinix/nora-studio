const { Events, ActivityType, REST, Routes } = require('discord.js');
const voiceTracker = require('../utils/voiceTracker');
const { updateStats, publishCommands } = require('../utils/topgg');
const { syncDowntime, updateHeartbeat } = require('../utils/resync');
const { updateBotStatus } = require('../utils/statusManager');

module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        console.log(`[System] Ready! Initializing Nora Mainframe as ${client.user.tag}`);

        // System Optimization: Sync Global Metrics
        try {
            await updateStats(client);
            await publishCommands(client);

            // 🔮 Optics Maintenance: Physically Set Banner on Startup - V18.0
            const axios = require('axios');
            const fs = require('fs');
            const path = require('path');
            const METADATA_PATH = path.join(__dirname, '..', '..', 'nora_metadata.json');

            let metadata = { lastBannerUpdate: 0 };
            if (fs.existsSync(METADATA_PATH)) {
                try { metadata = JSON.parse(fs.readFileSync(METADATA_PATH)); } catch (e) { }
            }

            const now = Date.now();
            const TEN_MINUTES = 10 * 60 * 1000;

            if (now - metadata.lastBannerUpdate > TEN_MINUTES) {
                const BANNER_URL = 'https://cdn.discordapp.com/attachments/1484684098994835579/1492306353916612728/Nora_Banner_UPD_680_x_240_px.gif?ex=69dada18&is=69d98898&hm=ee425538cef2762d6b919ac0b40bb472d82ee8fbab101de65a9e25ea72e897b2&';
                const bannerRes = await axios.get(BANNER_URL, { responseType: 'arraybuffer' }).catch(() => null);
                if (bannerRes && bannerRes.data) {
                    await client.user.setBanner(bannerRes.data).catch(() => { });
                    metadata.lastBannerUpdate = now;
                    fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2));
                    console.log(`[System Service] Global Identity & Nora Banner synchronized.`);
                }
            }
        } catch (e) {
            // Silently skip if image host is down to prevent log spam
        }

        // 🤖 Nora System Detection: Identity-Linked Status Engine - V17.5
        // Navigation Status (Standard HQ Identity) - Updated to Corn Hub Latest & Dynamic Twitch
        await updateBotStatus(client);
        
        // Dynamic Status Loop: Check stream status every 2 minutes
        setInterval(() => updateBotStatus(client), 120000);

        // Command Synchronization
        const commands = client.commands.map(cmd => cmd.data.toJSON());
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

        try {
            // 🌍 Global Command Sync: This ensures commands are available everywhere without duplication.
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands },
            );
            console.log(`[System Sync] Global Command Matrix synchronized. Badge eligibility: ACTIVE.`);

            // 🧹 Duplicate Purge: Clear guild-local commands to ensure only the global ones show up.
            const guildIds = client.guilds.cache.map(guild => guild.id);
            console.log(`[System Sync] Purging local overrides from ${guildIds.length} nodes...`);

            await Promise.all(guildIds.map(async (guildId) => {
                try {
                    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] });
                    return true;
                } catch (e) {
                    return false;
                }
            }));

            console.log(`[System Sync] Global consistency restored.`);
        } catch (error) {
            console.error(`[System Fatal] Critical Sync Failure:`, error);
        }

        // System Re-Sync: Award Catch-Up XP for downtime - V17.3
        try {
            await syncDowntime(client);
        } catch (e) {
            console.error('[System Re-Sync Fault]:', e.message);
        }

        // Start autonomous voice tracking engine
        voiceTracker.start(client);

        // Start System Heartbeat (5 min intervals)
        setInterval(async () => {
            try {
                // Heartbeat Pulse: Physically probe the SQL Registry
                const GlobalSettings = require('../database/models/GlobalSettings');
                await GlobalSettings.findByPk(1);
            } catch (e) {
                console.error('[System Safeguard ALERT]: Database Lock Detected. Initiating Emergency Pulse.');

                // 🔥 Master Red Alert Webhook
                const MASTER_WEBHOOK_URL = 'https://discord.com/api/webhooks/1446358991075676172/zlAPHTkqBdjw-8ilFOjGXvgVf3PgKLkWbVK8gYZcNibhTGGsXAH6aVGXnrh29PzsgBUP';
                const { WebhookClient } = require('discord.js');
                const masterWebhook = new WebhookClient({ url: MASTER_WEBHOOK_URL });

                await masterWebhook.send({
                    content: `👋 **Quick Heads-up**\nNora's feeling a bit stuck (Database hang) on her end.\nProblem: \`${e.message}\`\nCaught it: <t:${Math.floor(Date.now() / 1000)}:R>`,
                    username: 'Nora Alert',
                    avatarURL: client.user.displayAvatarURL()
                }).catch(() => { });
            }
        }, 300000);

        console.log(`[System Check] Keeping an eye on things! Heartbeat active.`);
    },
};
