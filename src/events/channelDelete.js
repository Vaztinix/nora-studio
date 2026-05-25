const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.ChannelDelete,
    async execute(channel) {
        if (!channel.guild) return;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: channel.guild.id } });
            if (!settings || !settings.loggingChannelId || !settings.logChannelDeletes) return;

            let logChannel = channel.guild.channels.cache.get(settings.loggingChannelId);
            if (!logChannel) logChannel = await channel.guild.channels.fetch(settings.loggingChannelId).catch(() => null);
            if (!logChannel) return;

            const channelType = channel.type === 4 ? 'Category' : (channel.type === 2 ? 'Voice Channel' : 'Text Channel');

            const embed = new EmbedBuilder()
                .setTitle(`🗑️ ${channelType} Deleted`)
                .setColor(0xff4b4b)
                .addFields(
                    { name: 'Name', value: channel.name, inline: true },
                    { name: 'ID', value: `\`${channel.id}\``, inline: true }
                )
                .setTimestamp();

            await logChannel.send({ embeds: [embed] }).catch(e => console.error('[ChannelDelete] Failed to send log:', e.message));
        } catch (error) {
            console.error('[Logger] Error in ChannelDelete:', error);
        }
    },
};
