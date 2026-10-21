const { Events } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const GlobalSettings = require('../database/models/GlobalSettings');
const { logEvent } = require('../utils/logistics');

module.exports = {
    name: Events.GuildCreate,
    async execute(guild) {
        // 🛡️ Permanent Exile & Revocation Guard
        const ServerBlacklist = require('../database/models/ServerBlacklist');
        const blacklistEntry = await ServerBlacklist.findOne({ where: { guildId: guild.id, isActive: true } }).catch(() => null);

        let global;
        try {
            const [result] = await GlobalSettings.findOrCreate({ where: { id: 1 } });
            global = result;
        } catch (e) {
            global = await GlobalSettings.findOne({ where: { id: 1 } });
        }
        
        const bannedIds = JSON.parse(global?.bannedGuildIds || '[]');
        
        if (blacklistEntry || bannedIds.includes(guild.id)) {
            const reason = blacklistEntry?.reason || 'This server was permanently revoked from using Nora by bot administrators.';
            console.warn(`[PermRevoke Guard] Detected join attempt at Perm-Revoked Server: ${guild.name} (${guild.id}). DMing owner and severing link.`);
            
            // Send advisory DM to the server owner before leaving
            try {
                const owner = await guild.members.fetch(guild.ownerId).catch(() => null) 
                           || await guild.client.users.fetch(guild.ownerId).catch(() => null);
                if (owner) {
                    const { EmbedBuilder } = require('discord.js');
                    const exileEmbed = new EmbedBuilder()
                        .setTitle('🚫 Server Access Denied: Permanent Revocation')
                        .setColor(0xED4245)
                        .setDescription(
                            `Hello <@${guild.ownerId}>,\n\n` +
                            `Nora was invited to **${guild.name}**, but could not join because this server has been **permanently revoked and blacklisted** from using Nora by the bot administrators.\n\n` +
                            `**Reason for Permanent Revocation:**\n>>> ${reason}\n\n` +
                            `Nora has automatically departed from your server.`
                        )
                        .addFields(
                            { name: '🏰 Server', value: `${guild.name} (\`${guild.id}\`)`, inline: true },
                            { name: '🛑 Status', value: 'Permanently Blacklisted', inline: true }
                        )
                        .setFooter({ text: 'Nora Platform Security & Blacklist Enforcement' })
                        .setTimestamp();

                    await owner.send({ embeds: [exileEmbed] }).catch(() => {});
                }
            } catch (dmErr) {
                console.warn(`[PermRevoke Guard] Could not DM owner ${guild.ownerId}:`, dmErr.message);
            }

            try {
                await guild.leave();
            } catch (e) {
                console.error(`[PermRevoke Guard] Failed to physically sever link for server ${guild.id}:`, e);
            }
            return; // Exit immediately
        }

        console.log(`[System] System Connection Synchronized: ${guild.name} (ID: ${guild.id})`);
        
        // Write non-volatile timestamp boundary anchor for forward-only privacy
        try {
            const [settings] = await GuildSettings.findOrCreate({ where: { guildId: guild.id } });
            if (!settings.installedAt) {
                await settings.update({ installedAt: new Date() });
                console.log(`[Privacy Boundary] Initialized installedAt for server ${guild.name} (${guild.id})`);
            }

            // Immediately cache invites for newly joined server
            const { cacheGuildInvites } = require('../utils/inviteTracker');
            await cacheGuildInvites(guild);
        } catch (e) {
            console.error(`[Privacy Boundary Error] Failed to write installedAt for ${guild.id}:`, e.message);
        }

        // Send a thank you DM to the guild owner with setup details
        try {
            const owner = await guild.members.fetch(guild.ownerId).catch(() => null);
            if (owner) {
                const { EmbedBuilder } = require('discord.js');
                const welcomeEmbed = new EmbedBuilder()
                    .setTitle('💜 Thanks for using Nora!')
                    .setDescription(`Hi **${owner.user.username}**,\n\nThanks for adding **Nora** to your server **${guild.name}**! Here is some important setup information to get you started:`)
                    .addFields(
                        { name: '🌐 Web Dashboard', value: 'Configure all features, moderation, leveling, and logs at:\n[https://vaztinix.dev/dashboard](https://vaztinix.dev/dashboard)', inline: false },
                        { name: '🛠️ Server Setup Command', value: 'Run `/setup` in your server to let Nora help you configure channels, roles, and basic automod rules.', inline: false },
                        { name: '📖 Documentation', value: 'Check out the detailed guides and documentation at:\n[https://vaztinix.dev/docs](https://vaztinix.dev/docs)', inline: false },
                        { name: '💬 Need Help?', value: 'Join our official Support Server to get assistance from the team:\n[https://discord.gg/m9WPYV287q](https://discord.gg/m9WPYV287q)', inline: false }
                    )
                    .setColor(0x57acf2)
                    .setFooter({ text: 'Nora Assistant • Premium Automation' })
                    .setTimestamp();
                await owner.send({ embeds: [welcomeEmbed] }).catch(() => {
                    console.log(`[Welcome Message] Could not DM owner of guild ${guild.name} (DMs might be disabled).`);
                });
            }
        } catch (e) {
            console.error('[Welcome Message Error] Failed to send welcome DM:', e.message);
        }

        // Log to Master HQ Logistics Webhook
        await logEvent(guild, 'join');

        // Post server count to Top.gg & BotBoard.gg
        try {
            const { postToTopgg } = require('../utils/topggPoster');
            await postToTopgg(guild.client);
            const { postToBotBoard } = require('../utils/botboardPoster');
            await postToBotBoard(guild.client);
        } catch (err) {
            console.error('[Stats Join Poster Error]:', err);
        }
    },
};
