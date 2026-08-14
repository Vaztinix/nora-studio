const { Events, ActivityType, REST, Routes } = require('discord.js');
const voiceTracker = require('../utils/voiceTracker');
const { syncDowntime, updateHeartbeat } = require('../utils/resync');
const { updateBotStatus } = require('../utils/statusManager');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`[System] Ready! Initializing Nora Mainframe as ${client.user.tag}`);

        // Initialize Animated Cool Name & Status system
        const { startNameAnimator } = require('../utils/nameAnimator');
        startNameAnimator(client);

        // Update Bot Global Display Name to Cat Bot font style (𝗡𝗼𝗿𝗮)
        try {
            await client.rest.patch(Routes.user(), {
                body: { global_name: '𝗡𝗼𝗿𝗮' }
            });
            console.log('[System] Updated Bot Global Display Name to: 𝗡𝗼𝗿𝗮');
        } catch (err) {
            console.log('[System] Global display name update info:', err.message);
        }

        // 1. 🌍 Immediate Global Command Sync: Register commands first before background operations
        const commands = client.commands.map(cmd => cmd.data.toJSON());

        try {
            await client.rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands },
            );
            console.log(`[System Sync] Global Command Matrix synchronized. Badge eligibility: ACTIVE (${commands.length} commands).`);
        } catch (error) {
            console.error(`[System Fatal] Critical Sync Failure:`, error);
        }

        // 2. ⚡ Non-blocking Background Tasks (Invite caching, banner updates, status, duplicate purging)
        (async () => {
            // Initialize invite tracker cache in background
            client.invites = new Map();
            for (const guild of client.guilds.cache.values()) {
                try {
                    const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
                    if (me && me.permissions.has('ManageGuild')) {
                        const invites = await guild.invites.fetch().catch(() => null);
                        if (invites) {
                            client.invites.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses])));
                        }
                    }
                } catch (e) {}
            }
            console.log(`[Invite Tracker] Cached invite states across ${client.invites.size} authorized servers.`);

            // Optics Maintenance: Set Banner in background
            try {
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
                    const bannerRes = await axios.get(BANNER_URL, { responseType: 'arraybuffer', timeout: 4000 }).catch(() => null);
                    if (bannerRes && bannerRes.data) {
                        await client.user.setBanner(bannerRes.data).catch(() => { });
                        metadata.lastBannerUpdate = now;
                        fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2));
                    }
                }
            } catch (e) {}

            // Clear guild-local commands safely in background
            const guildsToPurge = Array.from(client.guilds.cache.keys());
            for (let i = 0; i < guildsToPurge.length; i += 5) {
                const chunk = guildsToPurge.slice(i, i + 5);
                await Promise.all(chunk.map(async (guildId) => {
                    try {
                        const guildObj = client.guilds.cache.get(guildId);
                        if (guildObj) {
                            const localCmds = await guildObj.commands.fetch().catch(() => null);
                            if (localCmds && localCmds.size > 0) {
                                await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] });
                            }
                        }
                    } catch (e) {}
                }));
                if (i + 5 < guildsToPurge.length) {
                    await new Promise(r => setTimeout(r, 400));
                }
            }
        })();

        // 🤖 Nora System Detection: Identity-Linked Status Engine
        await updateBotStatus(client);
        setInterval(() => updateBotStatus(client), 120000);

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
                const { WebhookClient, EmbedBuilder } = require('discord.js');
                const masterWebhook = new WebhookClient({ url: MASTER_WEBHOOK_URL });

                const embed = new EmbedBuilder()
                    .setTitle('⚠️ System Safeguard Alert')
                    .setDescription("Nora's database heartbeat has detected a lock state. Initiating emergency recovery pulse.")
                    .addFields({ name: 'Error / Reason', value: `\`${e.message}\`` })
                    .setColor(0xffaa00)
                    .setTimestamp();

                await masterWebhook.send({
                    embeds: [embed],
                    username: 'Nora Alert',
                    avatarURL: client.user.displayAvatarURL()
                }).catch(() => { });
            }
        }, 300000);

        // Ticket Auto-Archive Scheduler: runs every 15 minutes (900000 ms)
        setInterval(async () => {
            try {
                const ticketsEngine = require('../bot/engines/tickets');
                await ticketsEngine.autoArchiveTickets(client);
            } catch (err) {
                console.error('[Ticket Auto-Archive Scheduler Error]:', err);
            }
        }, 900000);

        // Top.gg Auto-Post Scheduler: runs every 2 hours
        try {
            const { postToTopgg } = require('../utils/topggPoster');
            await postToTopgg(client, true);
            setInterval(async () => {
                await postToTopgg(client, true);
            }, 7200000);
        } catch (err) {
            console.error('[Top.gg Auto-Post Startup Error]:', err);
        }

        // BotBoard.gg Auto-Post Scheduler: runs on startup and every 30 minutes
        try {
            const { postToBotBoard } = require('../utils/botboardPoster');
            await postToBotBoard(client, true);
            setInterval(async () => {
                await postToBotBoard(client, true);
            }, 1800000);
        } catch (err) {
            console.error('[BotBoard.gg Auto-Post Startup Error]:', err);
        }

        console.log(`[System Check] Keeping an eye on things! Heartbeat active.`);
    },
};
