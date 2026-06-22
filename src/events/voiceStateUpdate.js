const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        if (!oldState.guild) return;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: oldState.guild.id } });
            if (!settings) return;
            const loggerUtil = require('../utils/logger');
            const logChannelId = loggerUtil.resolveLogChannelId(settings, 'voiceStates');
            if (!logChannelId) return;

            let logChannel = oldState.guild.channels.cache.get(logChannelId);
            if (!logChannel) logChannel = await oldState.guild.channels.fetch(logChannelId).catch(() => null);
            if (!logChannel) return;

            const member = newState.member || oldState.member;
            if (!member) return;

            let action = '';
            let color = 0x57acf2;

            if (!oldState.channelId && newState.channelId) {
                // Join Voice
                if (!settings.logVoiceJoins) return;
                action = `Joined Voice Channel <#${newState.channelId}>`;
                color = 0x43b581;
            } else if (oldState.channelId && !newState.channelId) {
                // Leave Voice
                if (!settings.logVoiceLeaves) return;
                action = `Left Voice Channel <#${oldState.channelId}>`;
                color = 0xff4b4b;
            } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                // Move Voice
                if (!settings.logVoiceMoves) return;
                action = `Moved from <#${oldState.channelId}> to <#${newState.channelId}>`;
                color = 0xffa500;
            }

            if (!action) return; // Ignore mute/deafen updates

            const embed = new EmbedBuilder()
                .setTitle('🎤 Voice State Update')
                .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
                .setDescription(`**User:** <@${member.id}>\n**Action:** ${action}`)
                .setColor(color)
                .setTimestamp();

            await logChannel.send({ embeds: [embed] }).catch(e => console.error('[VoiceStateUpdate] Failed to send log:', e.message));
        } catch (error) {
            console.error('[Logger] Error in VoiceStateUpdate:', error);
        }
    },
};
