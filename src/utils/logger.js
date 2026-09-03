const { WebhookClient } = require('discord.js');

/**
 * Centralized Nora Logging Engine
 * Provides clean, transparent terminal logs and optional webhook escalation.
 */
class Logger {
    constructor() {
        this.webhookUrl = process.env.ERROR_WEBHOOK_URL || 'https://discord.com/api/webhooks/1446358991075676172/zlAPHTkqBdjw-8ilFOjGXvgVf3PgKLkWbVK8gYZcNibhTGGsXAH6aVGXnrh29PzsgBUP';
        this.errorChannelId = '1516140475059273929';
        this.client = null;
    }

    setClient(client) {
        if (client) this.client = client;
    }

    /**
     * Send an error embed directly to the dedicated Error Monitoring Channel (1516140475059273929)
     */
    async forwardToErrorChannel({ title, context, error, user, guild, extraFields = [] }) {
        if (!this.client) return;

        try {
            const channel = this.client.channels.cache.get(this.errorChannelId) || 
                            await this.client.channels.fetch(this.errorChannelId).catch(() => null);

            if (!channel) return;

            const { EmbedBuilder } = require('discord.js');
            const errMsg = error?.message || String(error || 'Unknown Error');
            let stackTrace = error?.stack ? String(error.stack) : 'No stack trace available';
            if (stackTrace.length > 1000) stackTrace = stackTrace.substring(0, 997) + '...';

            const embed = new EmbedBuilder()
                .setTitle(title || '🚨 System Exception Alert')
                .setColor(0xED4245) // Vivid Red
                .addFields(
                    { name: 'Scope / Context', value: `\`${context || 'System'}\``, inline: true }
                );

            if (user) embed.addFields({ name: 'User', value: user, inline: true });
            if (guild) embed.addFields({ name: 'Guild / Environment', value: guild, inline: true });

            embed.addFields(
                { name: 'Error Details', value: `\`\`\`js\n${errMsg}\n\`\`\``, inline: false },
                { name: 'Stack Trace', value: `\`\`\`js\n${stackTrace}\n\`\`\``, inline: false }
            );

            if (extraFields.length > 0) {
                embed.addFields(extraFields);
            }

            embed.setFooter({ text: `Nora System Error Forwarder • Channel: ${this.errorChannelId}` })
                 .setTimestamp();

            await channel.send({ embeds: [embed] }).catch(err => {
                console.error('[Logger] Error sending alert to error channel:', err.message);
            });
        } catch (e) {
            console.error('[Logger] Error forwarding to error channel:', e.message);
        }
    }

    /**
     * Log a command error to the terminal and escalation channel
     */
    async logCommandError(interaction, error) {
        if (interaction.client && !this.client) {
            this.client = interaction.client;
        }

        const cmdName = interaction.commandName || 'Unknown Command';
        const user = interaction.user ? `${interaction.user.tag} (${interaction.user.id})` : 'Unknown User';
        const guild = interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DMs';

        // 💻 Terminal Output (High Visibility)
        console.error('\x1b[31m%s\x1b[0m', '--- 🚨 NORA COMMAND ERROR 🚨 ---');
        console.error(`Command: /${cmdName}`);
        console.error(`User:    ${user}`);
        console.error(`Guild:   ${guild}`);
        console.error(`Reason:  ${error?.message || error}`);
        console.error('\x1b[31m%s\x1b[0m', '--- TRACE ---');
        console.error(error?.stack || error);
        console.error('\x1b[31m%s\x1b[0m', '--------------------------------');

        // Forward to error channel 1516140475059273929
        await this.forwardToErrorChannel({
            title: `🚨 Command Error: /${cmdName}`,
            context: `Slash Command /${cmdName}`,
            error,
            user,
            guild
        });

        // Backup Webhook Escalation
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
                        { name: 'Error Message', value: `\`${error?.message || error}\``, inline: false }
                    )
                    .setColor(0xff3333)
                    .setTimestamp();
                await webhook.send({
                    embeds: [embed],
                    username: 'Nora Internal Logs'
                }).catch(() => {});
            } catch (e) {
                console.error('[Logger] Failed to send escalation webhook:', e.message);
            }
        }
    }

    /**
     * Log a general system error
     */
    error(context, error) {
        console.error('\x1b[41m%s\x1b[0m', `[${context}] Error: ${error?.message || error}`);
        if (error && error.stack) console.error(error.stack);

        const errObj = error instanceof Error ? error : new Error(String(error || 'System Error'));

        // Forward to error channel 1516140475059273929
        this.forwardToErrorChannel({
            title: `⚠️ System Error: ${context}`,
            context,
            error: errObj
        });
    }

    /**
     * Resolve the target logging channel ID for a specific category.
     * Fallback to the main settings.loggingChannelId if the split channel is not configured.
     */
    resolveLogChannelId(settings, category) {
        if (!settings) return null;
        
        let channelsObj = settings.loggingChannels;
        if (typeof channelsObj === 'string') {
            try {
                channelsObj = JSON.parse(channelsObj);
            } catch (e) {
                channelsObj = {};
            }
        }

        if (channelsObj && typeof channelsObj === 'object') {
            // 1. Direct category match e.g. 'messages', 'members', 'channels', 'voice', 'automod', 'moderation'
            if (channelsObj[category] && channelsObj[category] !== 'none') {
                return channelsObj[category];
            }

            // 2. Event key to section group mapping
            const groupMap = {
                messageEdits: 'messages',
                messageDeletes: 'messages',
                memberJoins: 'members',
                memberLeaves: 'members',
                memberUpdates: 'members',
                memberBoosts: 'members',
                channelCreates: 'channels',
                channelEdits: 'channels',
                channelDeletes: 'channels',
                voiceJoins: 'voice',
                voiceLeaves: 'voice',
                voiceMoves: 'voice',
                automod: 'automod',
                roles: 'roles',
                moderation: 'moderation'
            };
            const group = groupMap[category];
            if (group && channelsObj[group] && channelsObj[group] !== 'none') {
                return channelsObj[group];
            }
        }

        return settings.loggingChannelId || null;
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
            const safeFields = (fields || []).map(f => {
                let val = String(f.value || '*None*');
                if (val.length > 1024) {
                    val = val.substring(0, 1020) + '...';
                }
                return {
                    name: String(f.name || 'Detail').substring(0, 256),
                    value: val || '*None*',
                    inline: !!f.inline
                };
            });
            const embed = new EmbedBuilder()
                .setTitle(String(title || 'Dashboard Action').substring(0, 256))
                .setColor(color)
                .addFields(safeFields)
                .setTimestamp();

            await logChannel.send({ embeds: [embed] }).catch(err => {
                console.error(`[Logger ERROR] Failed to send log to ${logChannel.name}:`, err.message);
            });
        } catch (e) {
            console.error('[Logger] Error sending dashboard or command log:', e);
        }
    }

    async sendEventLog(guild, eventKey, embed, settings = null) {
        if (!guild) return;
        try {
            const GuildSettings = require('../database/models/GuildSettings');
            if (!settings) {
                settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
            }
            if (!settings) return;

            // 1. Send to standard Logging Channel if configured and toggled
            const channelToggleMap = {
                'messageDelete': 'logMessageDeletes',
                'messageUpdate': 'logMessageEdits',
                'memberJoin': 'logMemberJoins',
                'memberLeave': 'logMemberLeaves',
                'memberUpdate': 'logMemberUpdates',
                'channelCreate': 'logChannelCreates',
                'channelUpdate': 'logChannelEdits',
                'channelDelete': 'logChannelDeletes',
                'voiceJoin': 'logVoiceJoins',
                'voiceLeave': 'logVoiceLeaves',
                'voiceMove': 'logVoiceMoves',
                'automod': 'logAutomod',
                'roleCreate': 'logRoleEvents',
                'roleDelete': 'logRoleEvents',
                'roleUpdate': 'logRoleEvents'
            };
            const toggleField = channelToggleMap[eventKey];
            if (toggleField && (settings[toggleField] !== false)) {
                const categoryMap = {
                    'messageDelete': 'messageDeletes',
                    'messageUpdate': 'messageEdits',
                    'memberJoin': 'memberJoins',
                    'memberLeave': 'memberLeaves',
                    'memberUpdate': 'memberUpdates',
                    'channelCreate': 'channelCreates',
                    'channelUpdate': 'channelEdits',
                    'channelDelete': 'channelDeletes',
                    'voiceJoin': 'voiceJoins',
                    'voiceLeave': 'voiceLeaves',
                    'voiceMove': 'voiceMoves',
                    'automod': 'automod',
                    'roleCreate': 'roles',
                    'roleDelete': 'roles',
                    'roleUpdate': 'roles'
                };
                const category = categoryMap[eventKey] || 'general';
                const logChannelId = this.resolveLogChannelId(settings, category);
                if (logChannelId) {
                    let logChannel = guild.channels.cache.get(logChannelId);
                    if (!logChannel) logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const perms = logChannel.permissionsFor(guild.members.me);
                        if (perms && perms.has('SendMessages') && perms.has('EmbedLinks')) {
                            await logChannel.send({ embeds: [embed] }).catch(() => null);
                        }
                    }
                }
            }

            // 2. Send to Webhook Logging if enabled
            if (settings.webhookEnabled && settings.webhookUrl) {
                let filters = settings.webhookLogFilters;
                if (typeof filters === 'string') {
                    try { filters = JSON.parse(filters); } catch (e) { filters = []; }
                }
                if (!Array.isArray(filters)) {
                    filters = ['messageDelete', 'messageUpdate', 'memberJoin', 'memberLeave', 'channelCreate', 'channelDelete', 'voiceJoin', 'voiceLeave'];
                }

                if (filters.includes(eventKey)) {
                    const { WebhookClient, EmbedBuilder } = require('discord.js');
                    const webhook = new WebhookClient({ url: settings.webhookUrl });
                    
                    // Clone/Create Webhook specific Embed
                    const webhookEmbed = EmbedBuilder.from(embed);
                    if (settings.webhookLogColor) {
                        try {
                            webhookEmbed.setColor(settings.webhookLogColor);
                        } catch (e) {}
                    }
                    
                    await webhook.send({
                        embeds: [webhookEmbed],
                        username: 'Nora Server Logs',
                        avatarURL: guild.client.user.displayAvatarURL()
                    }).catch(err => {
                        console.error(`[Webhook Logger ERROR] Failed to send webhook log:`, err.message);
                    });
                }
            }
        } catch (e) {
            console.error('[Logger] Error in sendEventLog:', e);
        }
    }
}

module.exports = new Logger();
