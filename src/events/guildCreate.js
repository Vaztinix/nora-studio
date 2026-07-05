const { Events } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const GlobalSettings = require('../database/models/GlobalSettings');
const { logEvent } = require('../utils/logistics');

module.exports = {
    name: Events.GuildCreate,
    async execute(guild) {
        // 🛡️ Permanent Exile Guard
        let global;
        try {
            const [result] = await GlobalSettings.findOrCreate({ where: { id: 1 } });
            global = result;
        } catch (e) {
            global = await GlobalSettings.findOne({ where: { id: 1 } });
        }
        
        const bannedIds = JSON.parse(global?.bannedGuildIds || '[]');
        
        if (bannedIds.includes(guild.id)) {
            console.warn(`[Exile System] Detected illegal join attempt at Exiled Server: ${guild.name} (${guild.id}). Severing link instantly.`);
            try {
                await guild.leave();
            } catch (e) {
                console.error(`[Exile System] Failed to physically sever link for server ${guild.id}:`, e);
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
                        { name: '💬 Need Help?', value: 'Join our official Support Server to get assistance from the team:\n[https://discord.gg/nora](https://discord.gg/nora)', inline: false }
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

        // Post server count to Top.gg
        try {
            const { postToTopgg } = require('../utils/topggPoster');
            await postToTopgg(guild.client);
        } catch (err) {
            console.error('[Top.gg Join Poster Error]:', err);
        }
    },
};
