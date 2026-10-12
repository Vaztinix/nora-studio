const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ChannelType, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const settingsCache = require('../../utils/settingsCache');
const adaptiveSlowmodeManager = require('../../utils/adaptiveSlowmodeManager');
const { handleError, handleSuccess } = require('../../utils/embeds');
const { logServerAction } = require('../../utils/actionLogger');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('adaptiveslowmode')
        .setDescription('Dynamically regulate channel slowmode based on real-time chat activity & velocity.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addSubcommand(sub => 
            sub.setName('status')
                .setDescription('View live adaptive slowmode metrics, active tier, and configuration.')
                .addChannelOption(opt => 
                    opt.setName('channel')
                        .setDescription('Channel to inspect (default: current channel)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub => 
            sub.setName('enable')
                .setDescription('Enable adaptive slowmode for this server or specific channels.')
                .addChannelOption(opt => 
                    opt.setName('channel')
                        .setDescription('Specific channel to bind (optional; leaves server-wide if empty)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub => 
            sub.setName('disable')
                .setDescription('Turn off adaptive slowmode and reset active channel cooldowns.')
        )
        .addSubcommand(sub => 
            sub.setName('configure')
                .setDescription('Customize slowmode durations, velocity thresholds, and decay timers.')
                .addIntegerOption(opt => 
                    opt.setName('small_activity')
                        .setDescription('Slowmode seconds during small activity (default: 3s)')
                        .setMinValue(1)
                        .setMaxValue(15)
                        .setRequired(false)
                )
                .addIntegerOption(opt => 
                    opt.setName('large_activity')
                        .setDescription('Slowmode seconds during large activity (default: 6s)')
                        .setMinValue(2)
                        .setMaxValue(60)
                        .setRequired(false)
                )
                .addIntegerOption(opt => 
                    opt.setName('surge_activity')
                        .setDescription('Slowmode seconds during raid / surge bursts (default: 10s)')
                        .setMinValue(5)
                        .setMaxValue(120)
                        .setRequired(false)
                )
                .addIntegerOption(opt => 
                    opt.setName('decay_time')
                        .setDescription('Seconds of quiet chat before slowmode decays back to 0 (default: 20s)')
                        .setMinValue(5)
                        .setMaxValue(120)
                        .setRequired(false)
                )
                .addStringOption(opt => 
                    opt.setName('sensitivity')
                        .setDescription('Threshold sensitivity for activity detection')
                        .addChoices(
                            { name: 'Casual (Higher tolerance for messages)', value: 'casual' },
                            { name: 'Balanced (Recommended)', value: 'balanced' },
                            { name: 'Strict (Triggers quickly on small bursts)', value: 'strict' }
                        )
                        .setRequired(false)
                )
                .addBooleanOption(opt => 
                    opt.setName('chat_notice')
                        .setDescription('Send temporary in-chat notification when slowmode escalates')
                        .setRequired(false)
                )
                .addIntegerOption(opt => 
                    opt.setName('inactive_floor')
                        .setDescription('Lowest slowmode floor in seconds (0 = off, default: 0s)')
                        .setMinValue(0)
                        .setMaxValue(10)
                        .setRequired(false)
                )
                .addBooleanOption(opt => 
                    opt.setName('ai_velocity')
                        .setDescription('Enable AI flood and pattern intelligence')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub => 
            sub.setName('channels')
                .setDescription('Manage which channels are monitored by Adaptive Slowmode.')
                .addStringOption(opt => 
                    opt.setName('action')
                        .setDescription('Action to perform on monitored channels')
                        .addChoices(
                            { name: 'Add Channel', value: 'add' },
                            { name: 'Remove Channel', value: 'remove' },
                            { name: 'Reset to All Text Channels', value: 'clear' }
                        )
                        .setRequired(true)
                )
                .addChannelOption(opt => 
                    opt.setName('target')
                        .setDescription('The channel to add or remove')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        const guild = interaction.guild;
        const guildId = guild.id;
        const settings = await settingsCache.get(guildId);

        // Check bot permissions
        if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return handleError(
                interaction, 
                'Permission Missing', 
                'I require the **Manage Channels** permission in order to dynamically regulate slowmode rates.'
            );
        }

        // 1. STATUS
        if (subcommand === 'status') {
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
            const status = await adaptiveSlowmodeManager.getStatus(targetChannel.id, guild);

            let channelsListDesc = '🌐 **All Text Channels** (Global Server Shield)';
            if (settings.adaptiveSlowmodeChannels) {
                try {
                    const parsed = JSON.parse(settings.adaptiveSlowmodeChannels);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        channelsListDesc = parsed.map(cId => `<#${cId}>`).join(', ');
                    }
                } catch (_) {}
            }

            const statusEmbed = new EmbedBuilder()
                .setTitle('⚡ Adaptive Slowmode Telemetry & Status')
                .setColor(status.enabled ? 0x10B981 : 0x6B7280)
                .setDescription(
                    `Adaptive Slowmode uses live message context and velocity to automatically raise slowmode during fast chat and drop it to **0s** when quiet.\n\n` +
                    `**System State:** ${status.enabled ? '🟢 **Active & Monitoring**' : '⚪ **Disabled**'}\n` +
                    `**Inspected Channel:** <#${targetChannel.id}> (${status.isChannelMonitored ? '✅ Monitored' : '⚠️ Bypassed'})\n` +
                    `**Current Channel Slowmode:** \`${status.currentRateLimit}s\`\n` +
                    `**Current Velocity:** \`${status.recentMessages10s} msgs / 10s\` (${status.uniqueChatters10s} unique chatters)\n` +
                    `**Current Tier:** \`${status.currentTier}\``
                )
                .addFields(
                    {
                        name: '⏱️ Dynamic Tier Durations',
                        value: 
                            `• **Quiet / Inactive:** \`${status.inactiveSec}s\` (Cooldown drops to zero)\n` +
                            `• **Small Activity:** \`${status.smallSec}s\` (Trigger: $\\ge${status.smallThreshold}$ msgs/10s)\n` +
                            `• **Large Activity:** \`${status.largeSec}s\` (Trigger: $\\ge${status.largeThreshold}$ msgs/10s)\n` +
                            `• **Surge / Raid:** \`${status.surgeSec}s\` (Trigger: $\\ge${status.surgeThreshold}$ msgs/10s)`,
                        inline: true
                    },
                    {
                        name: '⚙️ Controls & Decay',
                        value: 
                            `• **Quiet Decay Timeout:** \`${status.decaySec}s\` of silence\n` +
                            `• **Chat Notice:** \`${settings.adaptiveSlowmodeNotify ? 'Enabled' : 'Disabled'}\`\n` +
                            `• **Mod Log:** \`${settings.adaptiveSlowmodeModLog ? 'Enabled' : 'Disabled'}\`\n` +
                            `• **Ignored Roles:** \`${status.ignoredRoleCount} role(s)\``,
                        inline: true
                    },
                    {
                        name: '🎯 Monitored Target Channels',
                        value: channelsListDesc,
                        inline: false
                    }
                )
                .setFooter({ text: 'Nora Adaptive Defense • Real-Time Chat Engine' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('adaptive_toggle_quick')
                    .setLabel(status.enabled ? 'Disable Adaptive Slowmode' : 'Enable Adaptive Slowmode')
                    .setStyle(status.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            );

            const reply = await interaction.editReply({ embeds: [statusEmbed], components: [row] });

            // Handle interactive button
            const collector = reply.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 60000
            });

            collector.on('collect', async i => {
                const newEnabled = !status.enabled;
                await settingsCache.update(guildId, { adaptiveSlowmodeEnabled: newEnabled });
                if (!newEnabled) {
                    await adaptiveSlowmodeManager.manualReset(targetChannel);
                }
                await i.update({
                    content: `✅ Adaptive Slowmode has been **${newEnabled ? 'Enabled' : 'Disabled'}**.`,
                    embeds: [],
                    components: []
                });
            });

            return;
        }

        // 2. ENABLE
        if (subcommand === 'enable') {
            const specificChannel = interaction.options.getChannel('channel');
            let updates = { adaptiveSlowmodeEnabled: true };

            if (specificChannel) {
                let currentChannels = [];
                try {
                    currentChannels = JSON.parse(settings.adaptiveSlowmodeChannels || '[]');
                } catch (_) {}
                if (!currentChannels.includes(specificChannel.id)) {
                    currentChannels.push(specificChannel.id);
                }
                updates.adaptiveSlowmodeChannels = JSON.stringify(currentChannels);
            }

            await settingsCache.update(guildId, updates);
            await logServerAction({
                guildId,
                userId: interaction.user.id,
                username: interaction.user.tag,
                userAvatar: interaction.user.displayAvatarURL(),
                action: 'ADAPTIVE_SLOWMODE_ENABLE',
                details: specificChannel 
                    ? `Enabled adaptive slowmode on #${specificChannel.name}` 
                    : 'Enabled adaptive slowmode server-wide'
            }).catch(() => {});

            return handleSuccess(
                interaction,
                'Adaptive Slowmode Activated ⚡',
                specificChannel
                    ? `Adaptive Slowmode is now **enabled** for <#${specificChannel.id}>. Cooldowns will automatically adjust with message frequency.`
                    : `Adaptive Slowmode is now **enabled server-wide**. Channels will dynamically scale slowmode between **0s** (quiet), **${settings.adaptiveSlowmodeSmallSec || 3}s** (small), and **${settings.adaptiveSlowmodeLargeSec || 6}s** (large).`
            );
        }

        // 3. DISABLE
        if (subcommand === 'disable') {
            await settingsCache.update(guildId, { adaptiveSlowmodeEnabled: false });
            await adaptiveSlowmodeManager.manualReset(interaction.channel);

            await logServerAction({
                guildId,
                userId: interaction.user.id,
                username: interaction.user.tag,
                userAvatar: interaction.user.displayAvatarURL(),
                action: 'ADAPTIVE_SLOWMODE_DISABLE',
                details: 'Disabled adaptive slowmode server-wide'
            }).catch(() => {});

            return handleSuccess(
                interaction,
                'Adaptive Slowmode Disabled',
                'Adaptive Slowmode has been turned off. Channel rate limits have been restored.'
            );
        }

        // 4. CONFIGURE
        if (subcommand === 'configure') {
            const smallSec = interaction.options.getInteger('small_activity');
            const largeSec = interaction.options.getInteger('large_activity');
            const surgeSec = interaction.options.getInteger('surge_activity');
            const decayTime = interaction.options.getInteger('decay_time');
            const sensitivity = interaction.options.getString('sensitivity');
            const chatNotice = interaction.options.getBoolean('chat_notice');
            const inactiveFloor = interaction.options.getInteger('inactive_floor');
            const aiVelocity = interaction.options.getBoolean('ai_velocity');

            const updates = {};
            if (smallSec !== null) updates.adaptiveSlowmodeSmallSec = smallSec;
            if (largeSec !== null) updates.adaptiveSlowmodeLargeSec = largeSec;
            if (surgeSec !== null) updates.adaptiveSlowmodeSurgeSec = surgeSec;
            if (decayTime !== null) updates.adaptiveSlowmodeDecaySec = decayTime;
            if (chatNotice !== null) updates.adaptiveSlowmodeNotify = chatNotice;
            if (inactiveFloor !== null) updates.adaptiveSlowmodeInactiveSec = Math.max(0, inactiveFloor);
            if (aiVelocity !== null) updates.adaptiveSlowmodeAiEnabled = aiVelocity;

            if (sensitivity === 'casual') {
                updates.adaptiveSlowmodeSmallThreshold = 5;
                updates.adaptiveSlowmodeLargeThreshold = 10;
                updates.adaptiveSlowmodeSurgeThreshold = 16;
            } else if (sensitivity === 'balanced') {
                updates.adaptiveSlowmodeSmallThreshold = 3;
                updates.adaptiveSlowmodeLargeThreshold = 7;
                updates.adaptiveSlowmodeSurgeThreshold = 13;
            } else if (sensitivity === 'strict') {
                updates.adaptiveSlowmodeSmallThreshold = 2;
                updates.adaptiveSlowmodeLargeThreshold = 5;
                updates.adaptiveSlowmodeSurgeThreshold = 9;
            }

            if (Object.keys(updates).length === 0) {
                return handleError(
                    interaction,
                    'No Changes Specified',
                    'Please specify at least one option to configure (e.g. `small_activity`, `large_activity`, `decay_time`, `sensitivity`, or `inactive_floor`).'
                );
            }

            await settingsCache.update(guildId, updates);
            const fresh = await settingsCache.get(guildId);

            return handleSuccess(
                interaction,
                'Configuration Updated ⚙️',
                `Adaptive Slowmode parameters updated:\n\n` +
                `• **AI Velocity Intelligence:** \`${fresh.adaptiveSlowmodeAiEnabled !== false ? 'Active' : 'Disabled'}\`\n` +
                `• **Lowest Floor (0 = Off):** \`${fresh.adaptiveSlowmodeInactiveSec ?? 0}s\`\n` +
                `• **Small Activity:** \`${fresh.adaptiveSlowmodeSmallSec}s\` (Threshold: ${fresh.adaptiveSlowmodeSmallThreshold} msgs/10s)\n` +
                `• **Large Activity:** \`${fresh.adaptiveSlowmodeLargeSec}s\` (Threshold: ${fresh.adaptiveSlowmodeLargeThreshold} msgs/10s)\n` +
                `• **Surge Activity:** \`${fresh.adaptiveSlowmodeSurgeSec}s\` (Threshold: ${fresh.adaptiveSlowmodeSurgeThreshold} msgs/10s)\n` +
                `• **Quiet Decay Timeout:** \`${fresh.adaptiveSlowmodeDecaySec}s\`\n` +
                `• **In-Chat Notices:** \`${fresh.adaptiveSlowmodeNotify ? 'Enabled' : 'Disabled'}\``
            );
        }

        // 5. CHANNELS
        if (subcommand === 'channels') {
            const action = interaction.options.getString('action');
            const target = interaction.options.getChannel('target');

            let channelList = [];
            try {
                channelList = JSON.parse(settings.adaptiveSlowmodeChannels || '[]');
            } catch (_) {}

            if (action === 'clear') {
                await settingsCache.update(guildId, { adaptiveSlowmodeChannels: '[]' });
                return handleSuccess(
                    interaction,
                    'Channel Filter Cleared',
                    'Adaptive Slowmode is now configured to monitor **all text channels** across the server.'
                );
            }

            if (!target) {
                return handleError(interaction, 'Channel Required', 'Please specify a `target` channel to add or remove.');
            }

            if (action === 'add') {
                if (channelList.includes(target.id)) {
                    return handleError(interaction, 'Already Added', `<#${target.id}> is already in the adaptive slowmode list.`);
                }
                channelList.push(target.id);
                await settingsCache.update(guildId, { adaptiveSlowmodeChannels: JSON.stringify(channelList) });
                return handleSuccess(interaction, 'Channel Added 📌', `<#${target.id}> has been added to Adaptive Slowmode monitoring.`);
            }

            if (action === 'remove') {
                if (!channelList.includes(target.id)) {
                    return handleError(interaction, 'Not Monitored', `<#${target.id}> is not in the monitored channel list.`);
                }
                channelList = channelList.filter(id => id !== target.id);
                await settingsCache.update(guildId, { adaptiveSlowmodeChannels: JSON.stringify(channelList) });
                await adaptiveSlowmodeManager.manualReset(target);
                return handleSuccess(interaction, 'Channel Removed 🗑️', `<#${target.id}> was removed from Adaptive Slowmode monitoring.`);
            }
        }
    }
};
