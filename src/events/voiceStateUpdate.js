const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState, client) {
        if (!oldState.guild) return;

        // 🤫 VajjyVC auto-leave: if the summoner leaves VC, bot disconnects & stops player
        try {
            const member = newState.member || oldState.member;
            if (member && oldState.client?.vajjyVC?.has(member.id)) {
                const userLeft = oldState.channelId && !newState.channelId;
                const userMoved = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;
                if (userLeft || userMoved) {
                    const { connection, player } = oldState.client.vajjyVC.get(member.id);
                    if (player) {
                        try { player.stop(true); } catch (_) {}
                    }
                    if (connection) {
                        try { connection.destroy(); } catch (_) {}
                    }
                    oldState.client.vajjyVC.delete(member.id);
                }
            }
        } catch (e) { /* silent */ }

        try {
            const member = newState.member || oldState.member;
            const settings = await GuildSettings.findOne({ where: { guildId: oldState.guild.id } });
            if (!settings) return;

            let action = '';
            let color = 0x57acf2;
            let logCategory = '';

            if (!oldState.channelId && newState.channelId) {
                // Join Voice
                if (!settings.logVoiceJoins) return;
                action = `Joined Voice Channel <#${newState.channelId}>`;
                color = 0x43b581;
                logCategory = 'voiceJoins';
            } else if (oldState.channelId && !newState.channelId) {
                // Leave Voice
                if (!settings.logVoiceLeaves) return;
                action = `Left Voice Channel <#${oldState.channelId}>`;
                color = 0xff4b4b;
                logCategory = 'voiceLeaves';
            } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                // Move Voice
                if (!settings.logVoiceMoves) return;
                action = `Moved from <#${oldState.channelId}> to <#${newState.channelId}>`;
                color = 0xffa500;
                logCategory = 'voiceMoves';
            }

            if (!action || !logCategory) return; // Ignore mute/deafen updates

            const loggerUtil = require('../utils/logger');
            const logChannelId = loggerUtil.resolveLogChannelId(settings, logCategory);
            if (!logChannelId) return;

            let logChannel = oldState.guild.channels.cache.get(logChannelId) || await oldState.guild.channels.fetch(logChannelId).catch(() => null);
            if (!logChannel) return;

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
