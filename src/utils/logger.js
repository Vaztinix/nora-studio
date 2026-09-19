function parseJsonArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return String(val).split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    }
}

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
     * Resolve the target logging channel ID for a specific category or fine-grained event key.
     * Checks:
     * 1. Direct key match in loggingChannels (e.g., 'modBans', 'memberJoins', 'messageDeletes')
     * 2. Category group fallback (e.g., 'moderation', 'members', 'messages', 'channels', 'voice', 'games', 'utility')
     * 3. Dedicated settings columns (modLogChannelId, verificationLogChannelId, ticketLogChannelId, boostChannelId, levelUpChannelId, topggVoteChannelId, welcomeChannelId)
     * 4. Master default loggingChannelId
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
            // 1. Direct specific event key match
            if (channelsObj[category] && channelsObj[category] !== 'none') {
                return channelsObj[category];
            }

            // 2. Section group fallbacks
            const groupMap = {
                // Moderation & Security
                modBans: 'moderation',
                modUnbans: 'moderation',
                modKicks: 'moderation',
                modTimeouts: 'moderation',
                modWarns: 'moderation',
                automod: 'moderation',
                securityRaids: 'moderation',
                verification: 'moderation',
                
                // Member Lifecycle & Welcomer
                memberJoins: 'members',
                memberLeaves: 'members',
                memberNicknames: 'members',
                memberRoles: 'members',
                memberUpdates: 'members',
                boosts: 'boosts',
                memberBoosts: 'boosts',
                invites: 'members',
                
                // Messages & Content
                messageDeletes: 'messages',
                messageEdits: 'messages',
                messagePurges: 'messages',
                messagePins: 'messages',
                
                // Channels, Categories & Roles
                channelCreates: 'channels',
                channelEdits: 'channels',
                channelDeletes: 'channels',
                roleCreates: 'roles',
                roleEdits: 'roles',
                roleDeletes: 'roles',
                serverUpdates: 'channels',
                
                // Voice Activity
                voiceJoins: 'voice',
                voiceLeaves: 'voice',
                voiceMoves: 'voice',
                voiceMuteDeaf: 'voice',
                voiceStream: 'voice',
                
                // Games, Economy & Leveling
                levelUps: 'leveling',
                levelingXp: 'leveling',
                counting: 'games',
                miniGames: 'games',
                
                // Utility, Automation & System
                commands: 'utility',
                commandUsage: 'utility',
                dashboardActions: 'utility',
                tickets: 'tickets',
                reactionRoles: 'utility',
                autoresponder: 'utility',
                topggVotes: 'utility'
            };

            const group = groupMap[category];
            if (group && channelsObj[group] && channelsObj[group] !== 'none') {
                return channelsObj[group];
            }
        }

        // Special dedicated column fallbacks
        if ((category === 'moderation' || category === 'mod' || category === 'modBans' || category === 'modUnbans' || category === 'modKicks' || category === 'modTimeouts' || category === 'modWarns') && settings.modLogChannelId) {
            return settings.modLogChannelId;
        }
        if ((category === 'verify' || category === 'verification') && settings.verificationLogChannelId) {
            return settings.verificationLogChannelId;
        }
        if ((category === 'tickets' || category === 'ticket') && settings.ticketLogChannelId) {
            return settings.ticketLogChannelId;
        }
        if ((category === 'boosts' || category === 'memberBoosts') && settings.boostChannelId) {
            return settings.boostChannelId;
        }
        if ((category === 'levelUps' || category === 'leveling') && settings.levelUpChannelId) {
            return settings.levelUpChannelId;
        }
        if ((category === 'topggVotes' || category === 'voteLog') && settings.topggVoteChannelId) {
            return settings.topggVoteChannelId;
        }
        if (category === 'invites' && settings.inviteTrackerChannelId) {
            return settings.inviteTrackerChannelId;
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
            if (!settings) return;

            const isCommand = String(title || '').toLowerCase().includes('command');
            if (isCommand) {
                if (settings.logCommands === false || settings.logCommandUsage === false) return;
            } else {
                if (settings.logDashboardActions === false) return;
            }

            const targetCategory = isCommand ? 'commands' : 'dashboardActions';
            const logChannelId = this.resolveLogChannelId(settings, targetCategory);
            if (!logChannelId) return;

            let logChannel = guild.channels.cache.get(logChannelId);
            if (!logChannel) logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (!logChannel) return;

            const { EmbedBuilder } = require('discord.js');
            const safeFields = (fields || []).map(f => {
                let val = String(f.value !== undefined && f.value !== null ? f.value : '*None*').trim() || '*None*';
                if (val.length > 1024) {
                    val = val.substring(0, 1020) + '...';
                }
                let name = String(f.name !== undefined && f.name !== null ? f.name : 'Detail').trim() || 'Detail';
                if (name.length > 256) {
                    name = name.substring(0, 252) + '...';
                }
                return {
                    name,
                    value: val,
                    inline: !!f.inline
                };
            });
            const embed = new EmbedBuilder()
                .setTitle(String(title || 'Action Log').substring(0, 256))
                .setColor(color)
                .setTimestamp();

            if (safeFields.length > 0) {
                embed.addFields(safeFields);
            }

            await logChannel.send({ embeds: [embed] }).catch(err => {
                console.error(`[Logger ERROR] Failed to send log to ${logChannel.name}:`, err.message);
            });
        } catch (e) {
            console.error('[Logger] Error sending dashboard or command log:', e);
        }
    }

    async sendEventLog(guild, eventKey, embed, settings = null, originChannelId = null) {
        if (!guild) return;
        try {
            const GuildSettings = require('../database/models/GuildSettings');
            if (!settings) {
                settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
            }
            if (!settings) return;

            // Check Channel Exceptions / Ignored Logging Channels
            if (originChannelId && settings.loggingIgnoredChannels) {
                const ignored = parseJsonArray(settings.loggingIgnoredChannels);
                if (ignored.includes(originChannelId)) {
                    return;
                }
            }

            // 1. Send to standard Logging Channel if configured and toggled
            const channelToggleMap = {
                // Messages
                'messageDelete': 'logMessageDeletes',
                'messageDeletes': 'logMessageDeletes',
                'messageUpdate': 'logMessageEdits',
                'messageEdits': 'logMessageEdits',
                'messagePurges': 'logMessagePurges',
                'messageBulkDelete': 'logMessagePurges',
                'messagePins': 'logMessageEdits',
                
                // Members
                'memberJoin': 'logMemberJoins',
                'memberJoins': 'logMemberJoins',
                'memberLeave': 'logMemberLeaves',
                'memberLeaves': 'logMemberLeaves',
                'memberUpdate': 'logMemberUpdates',
                'memberNicknames': 'logMemberUpdates',
                'memberRoles': 'logRoleEvents',
                'memberBoost': 'logMemberBoosts',
                'boosts': 'logMemberBoosts',
                'invites': 'inviteTrackerEnabled',
                
                // Channels & Roles
                'channelCreate': 'logChannelCreates',
                'channelCreates': 'logChannelCreates',
                'channelUpdate': 'logChannelEdits',
                'channelEdits': 'logChannelEdits',
                'channelDelete': 'logChannelDeletes',
                'channelDeletes': 'logChannelDeletes',
                'roleCreate': 'logRoleEvents',
                'roleCreates': 'logRoleEvents',
                'roleDelete': 'logRoleEvents',
                'roleDeletes': 'logRoleEvents',
                'roleUpdate': 'logRoleEvents',
                'roleEdits': 'logRoleEvents',
                'serverUpdates': 'logChannelEdits',
                
                // Voice
                'voiceJoin': 'logVoiceJoins',
                'voiceJoins': 'logVoiceJoins',
                'voiceLeave': 'logVoiceLeaves',
                'voiceLeaves': 'logVoiceLeaves',
                'voiceMove': 'logVoiceMoves',
                'voiceMoves': 'logVoiceMoves',
                'voiceMuteDeaf': 'logVoiceMoves',
                'voiceStream': 'logVoiceJoins',
                
                // Moderation & Security
                'automod': 'logAutomod',
                'modBans': 'moderationEnabled',
                'modUnbans': 'moderationEnabled',
                'modKicks': 'moderationEnabled',
                'modTimeouts': 'moderationEnabled',
                'modWarns': 'moderationEnabled',
                'securityRaids': 'antiRaidEnabled',
                'verification': 'verifyRoleId',
                
                // Utility & Games
                'commandUsage': 'logCommands',
                'commands': 'logCommands',
                'dashboardActions': 'logDashboardActions',
                'levelUps': 'levelUpNotificationsEnabled',
                'levelingXp': 'levelingEnabled',
                'counting': 'funEnabled',
                'miniGames': 'funEnabled',
                'tickets': 'utilityEnabled',
                'reactionRoles': 'utilityEnabled',
                'autoresponder': 'utilityEnabled',
                'topggVotes': 'utilityEnabled'
            };
            const toggleField = channelToggleMap[eventKey];
            const isEnabled = !toggleField || (settings[toggleField] !== false);
            if (isEnabled) {
                const categoryMap = {
                    'messageDelete': 'messageDeletes',
                    'messageDeletes': 'messageDeletes',
                    'messageUpdate': 'messageEdits',
                    'messageEdits': 'messageEdits',
                    'messagePurges': 'messagePurges',
                    'messagePins': 'messagePins',
                    'memberJoin': 'memberJoins',
                    'memberJoins': 'memberJoins',
                    'memberLeave': 'memberLeaves',
                    'memberLeaves': 'memberLeaves',
                    'memberUpdate': 'memberUpdates',
                    'memberNicknames': 'memberNicknames',
                    'memberRoles': 'memberRoles',
                    'memberBoost': 'boosts',
                    'boosts': 'boosts',
                    'invites': 'invites',
                    'channelCreate': 'channelCreates',
                    'channelCreates': 'channelCreates',
                    'channelUpdate': 'channelEdits',
                    'channelEdits': 'channelEdits',
                    'channelDelete': 'channelDeletes',
                    'channelDeletes': 'channelDeletes',
                    'roleCreate': 'roleCreates',
                    'roleCreates': 'roleCreates',
                    'roleDelete': 'roleDeletes',
                    'roleDeletes': 'roleDeletes',
                    'roleUpdate': 'roleEdits',
                    'roleEdits': 'roleEdits',
                    'serverUpdates': 'serverUpdates',
                    'voiceJoin': 'voiceJoins',
                    'voiceJoins': 'voiceJoins',
                    'voiceLeave': 'voiceLeaves',
                    'voiceLeaves': 'voiceLeaves',
                    'voiceMove': 'voiceMoves',
                    'voiceMoves': 'voiceMoves',
                    'voiceMuteDeaf': 'voiceMuteDeaf',
                    'voiceStream': 'voiceStream',
                    'automod': 'automod',
                    'modBans': 'modBans',
                    'modUnbans': 'modUnbans',
                    'modKicks': 'modKicks',
                    'modTimeouts': 'modTimeouts',
                    'modWarns': 'modWarns',
                    'securityRaids': 'securityRaids',
                    'verification': 'verification',
                    'commandUsage': 'commands',
                    'commands': 'commands',
                    'dashboardActions': 'dashboardActions',
                    'levelUps': 'levelUps',
                    'levelingXp': 'levelingXp',
                    'counting': 'counting',
                    'miniGames': 'miniGames',
                    'tickets': 'tickets',
                    'reactionRoles': 'reactionRoles',
                    'autoresponder': 'autoresponder',
                    'topggVotes': 'topggVotes'
                };
                const category = categoryMap[eventKey] || eventKey;
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
