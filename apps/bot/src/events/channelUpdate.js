const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.ChannelUpdate,
    async execute(oldChannel, newChannel) {
        if (!oldChannel.guild) return;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: oldChannel.guild.id } });
            if (!settings || !settings.logChannelEdits) return;

            const loggerUtil = require('../utils/logger');
            const logChannelId = loggerUtil.resolveLogChannelId(settings, 'channelEdits');
            if (!logChannelId) return;

            let logChannel = oldChannel.guild.channels.cache.get(logChannelId);
            if (!logChannel) logChannel = await oldChannel.guild.channels.fetch(logChannelId).catch(() => null);
            if (!logChannel) return;

            const channelType = oldChannel.type === 4 ? 'Category' : (oldChannel.type === 2 ? 'Voice Channel' : 'Text Channel');

            if (oldChannel.name !== newChannel.name) {
                const embed = new EmbedBuilder()
                    .setTitle(`✏️ ${channelType} Renamed`)
                    .setColor(0x57acf2)
                    .addFields(
                        { name: 'Old Name', value: oldChannel.name, inline: true },
                        { name: 'New Name', value: newChannel.name, inline: true },
                        { name: 'Channel', value: oldChannel.type === 4 ? newChannel.name : `<#${newChannel.id}>`, inline: false }
                    )
                    .setFooter({ text: `ID: ${newChannel.id}` })
                    .setTimestamp();

                await logChannel.send({ embeds: [embed] }).catch(e => console.error('[ChannelUpdate] Failed to send log:', e.message));
            }
            
            // Can add more checks here like permissions changes if needed, but name is the most common.
        } catch (error) {
            console.error('[Logger] Error in ChannelUpdate:', error);
        }
    },
};
