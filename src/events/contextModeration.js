const { Events, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const settingsCache = require('../utils/settingsCache');
const Warning = require('../database/models/Warning');
const { assessMessageThreatContext } = require('../bot/engines/moderation');

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot) return;

        // Skip if message was sent by the bot itself or user has moderate permissions
        if (message.author.id === client.user.id) return;
        if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

        try {
            const settings = await settingsCache.get(message.guild.id);
            if (!settings) return;

            // Check immune roles
            if (settings.automodImmuneRoles && message.member) {
                try {
                    const immuneRoles = JSON.parse(settings.automodImmuneRoles || '[]');
                    if (Array.isArray(immuneRoles) && immuneRoles.some(rId => message.member.roles.cache.has(rId))) {
                        return;
                    }
                } catch (e) {}
            }

            // Forward-only timeline privacy check
            const botJoinTime = settings.installedAt ? new Date(settings.installedAt).getTime() : Date.now();
            const messageTime = new Date(message.createdAt).getTime();
            if (messageTime < botJoinTime) return;

            const res = await assessMessageThreatContext(settings, message);
            if (!res.actionRequired) return;

            if (res.contextClassification === "MENTION_LIMIT_EXCEEDED") {
                // Delete message
                if (message.deletable) {
                    await message.delete().catch(() => {});
                }

                // Temporary notice to user
                const notice = await message.channel.send(`⚠️ <@${message.author.id}>, your message was deleted for exceeding the server's mention limit.`);
                setTimeout(() => notice.delete().catch(() => {}), 5000);

                // Dispatch log to staff channel
                if (settings.loggingChannelId) {
                    const logChannel = message.guild.channels.cache.get(settings.loggingChannelId) 
                        || await message.guild.channels.fetch(settings.loggingChannelId).catch(() => null);
                    if (logChannel) {
                        const embed = new EmbedBuilder()
                            .setTitle('🛡️ AutoMod V2: Mention Limit Exceeded')
                            .setDescription(`**User:** ${message.author.tag} (${message.author.id})\n**Channel:** <#${message.channel.id}>\n**Details:** ${res.reason}\n**Message Snippet:** ${message.content.substring(0, 500)}`)
                            .setColor(0xffaa00)
                            .setTimestamp();
                        await logChannel.send({ embeds: [embed] }).catch(() => {});
                    }
                }
            } else if (res.contextClassification === "TARGETED_HARASSMENT") {
                // Delete message
                if (message.deletable) {
                    await message.delete().catch(() => {});
                }

                // Create warning
                const warningCount = await Warning.count({
                    where: { userId: message.author.id, guildId: message.guild.id }
                }) + 1;

                await Warning.create({
                    userId: message.author.id,
                    guildId: message.guild.id,
                    moderatorId: client.user.id,
                    reason: `[AutoMod V2] Targeted Harassment: ${res.reason}`
                });

                // Reply to user in the channel
                const warnMsg = await message.channel.send(`⚠️ <@${message.author.id}>, your message was deleted by AutoMod for targeted harassment/slurs.`);
                setTimeout(() => warnMsg.delete().catch(() => {}), 5000);

                // Execute timeout escalation if limit reached
                const maxWarnings = settings.maxWarningsBeforeAction || 3;
                if (warningCount >= maxWarnings) {
                    const member = message.member;
                    if (member && member.moderatable) {
                        const durationMs = (settings.muteDurationMinutes || 60) * 60 * 1000;
                        await member.timeout(durationMs, `Warning limit hit (${warningCount} warnings) via AutoMod V2 escalation.`);
                        
                        // Notify in channel
                        const timeoutMsg = await message.channel.send(`🛡️ <@${message.author.id}> has been timed out for ${settings.muteDurationMinutes} minutes after reaching ${warningCount} warnings.`);
                        setTimeout(() => timeoutMsg.delete().catch(() => {}), 8000);
                    }
                }

                // Dispatch log to staff channel
                if (settings.loggingChannelId) {
                    const logChannel = message.guild.channels.cache.get(settings.loggingChannelId) 
                        || await message.guild.channels.fetch(settings.loggingChannelId).catch(() => null);
                    if (logChannel) {
                        const embed = new EmbedBuilder()
                            .setTitle('🛡️ AutoMod V2: Targeted Harassment / Slur Violation')
                            .setDescription(`**User:** ${message.author.tag} (${message.author.id})\n**Channel:** <#${message.channel.id}>\n**Violation:** ${res.reason}\n**Message:** ${message.content}\n**Total Warnings:** ${warningCount}`)
                            .setColor(0xff5555)
                            .setTimestamp();
                        await logChannel.send({ embeds: [embed] }).catch(() => {});
                    }
                }
            } else if (res.contextClassification === "CASUAL_EXPRESSION") {
                // If conversational use of flagged word is restricted, delete quietly and notify privately
                if (message.deletable) {
                    await message.delete().catch(() => {});
                }
                
                try {
                    await message.author.send(`⚠️ Hi! The language used in your message on **${message.guild.name}** is restricted in general chat. Please keep the discussion friendly!`);
                } catch (e) {
                    const temp = await message.channel.send(`⚠️ <@${message.author.id}>, conversational use of that word is restricted in this channel.`);
                    setTimeout(() => temp.delete().catch(() => {}), 3000);
                }

                if (settings.loggingChannelId) {
                    const logChannel = message.guild.channels.cache.get(settings.loggingChannelId) 
                        || await message.guild.channels.fetch(settings.loggingChannelId).catch(() => null);
                    if (logChannel) {
                        const embed = new EmbedBuilder()
                            .setTitle('🛡️ AutoMod V2: Casual Language Filter')
                            .setDescription(`**User:** ${message.author.tag} (${message.author.id})\n**Channel:** <#${message.channel.id}>\n**Violation:** ${res.reason}\n**Message:** ${message.content}\n**Action:** Message deleted & user notified privately.`)
                            .setColor(0xffaa00)
                            .setTimestamp();
                        await logChannel.send({ embeds: [embed] }).catch(() => {});
                    }
                }
            }
        } catch (e) {
            console.error('[AutoMod V2 Error]:', e);
        }
    }
};
