const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const { formatMessage } = require('../utils/messageFormatter');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        try {
            const settings = await GuildSettings.findOne({ where: { guildId: member.guild.id } });
            // console.log(`[Logger DEBUG] MemberLeave event in ${member.guild.name}. LogChannelSet: ${!!settings?.loggingChannelId}, Toggle: ${settings?.logMemberLeaves}, WelcomeChannelSet: ${!!settings?.welcomeChannelId}, Toggle: ${settings?.welcomerEnabled}`);
            if (!settings) return;

            // 1. Leave Announcement (Welcomer Module)
            if (settings.welcomerEnabled && settings.welcomeChannelId) {
                let welcomeChannel = member.guild.channels.cache.get(settings.welcomeChannelId);
                if (!welcomeChannel) welcomeChannel = await member.guild.channels.fetch(settings.welcomeChannelId).catch(() => null);
                
                if (welcomeChannel) {
                    const template = settings.logLeaveMessage;
                    const desc = template ? formatMessage(template, member) : `<@${member.id}> has left the server. See you later!`;

                    const embed = new EmbedBuilder()
                        .setTitle(`Goodbye from ${member.guild.name}`)
                        .setDescription(desc)
                        .setColor(0x57acf2)
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                        .setFooter({ text: `Member Count: ${member.guild.memberCount}` });

                    await welcomeChannel.send({ embeds: [embed] }).catch(() => {});
                }
            }

            // 2. Logging Module (Audit Logs)
            if (settings.loggingChannelId && settings.logMemberLeaves) {
                let logChannel = member.guild.channels.cache.get(settings.loggingChannelId);
                if (!logChannel) logChannel = await member.guild.channels.fetch(settings.loggingChannelId).catch(() => null);
                
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('Member Left')
                        .setColor(0xff4b4b)
                        .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
                        .addFields(
                            { name: 'User', value: `<@${member.id}>`, inline: true },
                            { name: 'ID', value: `\`${member.id}\``, inline: true }
                        )
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }
            }
        } catch (error) {
            console.error('[Logger] Error in MemberLeave:', error);
        }
    },
};
