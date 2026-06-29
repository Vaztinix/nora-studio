const { WebhookClient } = require('discord.js');

/**
 * Centralized Nora Logging Engine
 * Provides clean, transparent terminal logs and optional webhook escalation.
 */
class Logger {
    constructor() {
        this.webhookUrl = process.env.ERROR_WEBHOOK_URL || 'https://discord.com/api/webhooks/1446358991075676172/zlAPHTkqBdjw-8ilFOjGXvgVf3PgKLkWbVK8gYZcNibhTGGsXAH6aVGXnrh29PzsgBUP';
    }

    /**
     * Log a command error to the terminal and escalation channel
     */
    async logCommandError(interaction, error) {
        const cmdName = interaction.commandName || 'Unknown Command';
        const user = interaction.user ? `${interaction.user.tag} (${interaction.user.id})` : 'Unknown User';
        const guild = interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DMs';

        // 💻 Terminal Output (High Visibility)
        console.error('\x1b[31m%s\x1b[0m', '--- 🚨 NORA COMMAND ERROR 🚨 ---');
        console.error(`Command: /${cmdName}`);
        console.error(`User:    ${user}`);
        console.error(`Guild:   ${guild}`);
        console.error(`Reason:  ${error.message}`);
        console.error('\x1b[31m%s\x1b[0m', '--- TRACE ---');
        console.error(error.stack);
        console.error('\x1b[31m%s\x1b[0m', '--------------------------------');

        //  escalation
        if (this.webhookUrl) {
            try {
                const { WebhookClient, EmbedBuilder } = require('discord.js');
                const webhook = new WebhookClient({ url: this.webhookUrl });
                const embed = new EmbedBuilder()
                    .setTitle('🚨 Command Error Alert')
                    .addFields(
                        { name: 'Command', value: `\`/${cmdName}\``, inline: true },
                        { name: 'User', value: user, inline: true },
                        { name: 'Guild', value: guild, inline: false },
                        { name: 'Error Message', value: `\`${error.message}\``, inline: false }
                    )
                    .setColor(0xff3333)
                    .setTimestamp();
                await webhook.send({
                    embeds: [embed],
                    username: 'Nora Internal Logs'
                });
            } catch (e) {
                console.error('[Logger] Failed to send escalation webhook:', e.message);
            }
        }
    }

    /**
     * Log a general system error
     */
    error(context, error) {
        console.error('\x1b[41m%s\x1b[0m', `[${context}] Error: ${error.message}`);
        if (error.stack) console.error(error.stack);
    }

    /**
     * Resolve the target logging channel ID for a specific category.
     * Fallback to the main settings.loggingChannelId if the split channel is not configured.
     */
    resolveLogChannelId(settings, category) {
        if (!settings) return null;
        
        if (settings.loggingChannels) {
            let channelsObj = settings.loggingChannels;
            if (typeof channelsObj === 'string') {
                try {
                    channelsObj = JSON.parse(channelsObj);
                } catch (e) {
                    channelsObj = {};
                }
            }
            if (channelsObj && channelsObj[category]) {
                if (channelsObj[category] === 'none') {
                    return null;
                }
                return channelsObj[category];
            }
        }

        return settings.loggingChannelId;
    }

    /**
     * Success log
     */
    info(context, message) {
        console.log('\x1b[32m%s\x1b[0m', `[${context}] ${message}`);
    }

    async logDashboardOrCommandAction(guild, title, fields, color = 0x57acf2) {
        if (!guild) return;
        try {
            const GuildSettings = require('../database/models/GuildSettings');
            const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
            if (!settings || !settings.logDashboardActions) return;

            const logChannelId = this.resolveLogChannelId(settings, 'dashboardActions');
            if (!logChannelId) return;

            let logChannel = guild.channels.cache.get(logChannelId);
            if (!logChannel) logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (!logChannel) return;

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setColor(color)
                .addFields(fields)
                .setTimestamp();

            await logChannel.send({ embeds: [embed] }).catch(err => {
                console.error(`[Logger ERROR] Failed to send log to ${logChannel.name}:`, err.message);
            });
        } catch (e) {
            console.error('[Logger] Error sending dashboard or command log:', e);
        }
    }
}

module.exports = new Logger();
