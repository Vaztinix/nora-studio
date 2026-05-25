const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
    name: Events.AutoModerationActionExecution,
    async execute(autoModerationActionExecution) {
        const guild = autoModerationActionExecution.guild;
        const GuildSettings = require('../database/models/GuildSettings');

        const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
        if (!settings || !settings.loggingChannelId || !settings.logAutomod) return;

        const logChannel = guild.channels.cache.get(settings.loggingChannelId);
        if (!logChannel) return;

        const { action, userId, channelId, matchedKeyword, matchedContent, ruleName } = autoModerationActionExecution;

        // Ignore native "Send Alert Message" actions to prevent duplicate logs in Nora's custom system
        if (action.type === 2) return;

        // AutoMod Immunity Bypass
        const immuneRoles = JSON.parse(settings.automodImmuneRoles || '[]');
        const member = await guild.members.fetch(userId).catch(() => null);
        
        if (member && immuneRoles.some(roleId => member.roles.cache.has(roleId))) {
            if (action.type === 3) await member.timeout(null, 'AutoMod Immunity Override').catch(() => {});
            return;
        }

        let descriptiveAction = 'Restricted';
        if (action.type === 1) descriptiveAction = 'Message Blocked';
        if (action.type === 2) descriptiveAction = 'Alert Sent';
        if (action.type === 3) descriptiveAction = 'User Timed Out';

        const Warning = require('../database/models/Warning');
        try {
            await Warning.create({
                userId: userId,
                guildId: guild.id,
                moderatorId: guild.client.user.id,
                reason: `AutoMod: ${ruleName || 'Filter'} (${matchedKeyword || 'Filtered Content'})`
            });

            const warningCount = await Warning.count({
                where: { userId, guildId: guild.id }
            });

            if (settings.warningAction !== 'none' && warningCount >= settings.warningThreshold) {
                if (member && member.moderatable) {
                    if (settings.warningAction === 'kick') {
                        await member.kick(`Warning threshold hit (${warningCount} warnings) via AutoMod`);
                        descriptiveAction += ' & Kicked (Threshold)';
                    } else if (settings.warningAction === 'ban') {
                        await member.ban({ reason: `Warning threshold hit (${warningCount} warnings) via AutoMod` });
                        descriptiveAction += ' & Banned (Threshold)';
                    } else if (settings.warningAction === 'timeout') {
                        const duration = settings.antiSpamMuteDuration || 60000;
                        await member.timeout(duration, `Warning threshold hit (${warningCount} warnings) via AutoMod`);
                        descriptiveAction += ' & Timed Out (Threshold)';
                    }
                }
            }
        } catch (err) {
            console.error('AutoMod Warning Action Failed:', err);
        }

        const embed = new EmbedBuilder()
            .setTitle(`🛡️ Nora Shield: ${ruleName || 'Auto-Mod Filter'}`)
            .setColor(0x57acf2)
            .addFields(
                { name: 'Subject', value: `<@${userId}>`, inline: true },
                { name: 'Location', value: channelId ? `<#${channelId}>` : 'Unknown', inline: true },
                { name: 'Resolution', value: descriptiveAction, inline: true }
            )
            .setTimestamp();

        if (matchedKeyword) {
            embed.addFields({ name: 'Filtered Term', value: `\`${matchedKeyword}\``, inline: true });
        }

        if (matchedContent) {
            const snippet = matchedContent.length > 1024 ? matchedContent.substring(0, 1021) + '...' : matchedContent;
            embed.addFields({ name: 'Context Snippet', value: `\`\`\`${snippet}\`\`\``, inline: false });
        }

        try {
            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Failed to log automod action:', error);
        }
    },
};
