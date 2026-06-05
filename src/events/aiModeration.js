const { Events, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const settingsCache = require('../utils/settingsCache');
const Warning = require('../database/models/Warning');
const { analyzeMessage } = require('../utils/aiModerator');

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot) return;

        // Skip if message was already deleted or author is untracked
        if (message.author.id === client.user.id) return;

        // Bypass checks if member has moderate permissions
        if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

        try {
            const settings = await settingsCache.get(message.guild.id);
            if (!settings || !settings.moderationEnabled) return;

            // Run the adaptive natural-language text analysis
            const res = analyzeMessage(message.content);
            if (!res.flagged) return;

            // Delete the toxic/sarcastic message
            if (message.deletable) {
                await message.delete().catch(() => {});
            }

            // Create warning record in database (issued by client bot itself)
            const warning = await Warning.create({
                userId: message.author.id,
                guildId: message.guild.id,
                moderatorId: client.user.id,
                reason: `[AI AutoMod] ${res.reason}: ${res.context}`
            });

            // Get total warning count
            const warningCount = await Warning.count({
                where: {
                    userId: message.author.id,
                    guildId: message.guild.id
                }
            });

            // Warn user in the channel
            const warnMsg = await message.channel.send(`⚠️ <@${message.author.id}>, your message was deleted by AI AutoMod for: **${res.reason}**.`);
            setTimeout(() => warnMsg.delete().catch(() => {}), 5000);

            // Execute automated warning action if threshold is reached
            let actionResultText = '';
            if (settings.warningAction !== 'none' && warningCount >= settings.warningThreshold) {
                const member = message.member;
                if (member && member.moderatable) {
                    try {
                        if (settings.warningAction === 'kick') {
                            await member.kick(`Warning threshold hit (${warningCount} warnings)`);
                            actionResultText = '\n\n**Threshold Action Taken:** Member has been kicked.';
                        } else if (settings.warningAction === 'ban') {
                            await member.ban({ reason: `Warning threshold hit (${warningCount} warnings)` });
                            actionResultText = '\n\n**Threshold Action Taken:** Member has been banned.';
                        } else if (settings.warningAction === 'timeout') {
                            const duration = settings.antiSpamMuteDuration || 60000;
                            await member.timeout(duration, `Warning threshold hit (${warningCount} warnings)`);
                            actionResultText = `\n\n**Threshold Action Taken:** Member has been timed out for ${duration / 60000} minute(s).`;
                        }
                    } catch (err) {
                        actionResultText = `\n\n**Threshold Action Failed:** ${err.message}`;
                    }
                }
            }

            // Dispatch alert to the staff logging channel
            if (settings.loggingChannelId) {
                let logChannel = message.guild.channels.cache.get(settings.loggingChannelId);
                if (!logChannel) {
                    logChannel = await message.guild.channels.fetch(settings.loggingChannelId).catch(() => null);
                }
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle('🛡️ AI AutoMod Alert')
                        .setDescription(`**User:** ${message.author.tag} (${message.author.id})\n**Channel:** <#${message.channel.id}>\n**Reason:** ${res.reason}\n**Context:** ${res.context}\n**Original Message:** ${message.content}\n**Total Warnings:** ${warningCount}${actionResultText}`)
                        .setColor(0xff5555)
                        .setTimestamp();

                    await logChannel.send({ embeds: [embed] }).catch(() => {});
                }
            }

        } catch (e) {
            console.error('[AI AutoMod Failure]:', e);
        }
    }
};
