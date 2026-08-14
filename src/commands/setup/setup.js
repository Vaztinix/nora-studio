const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType, ChannelType } = require('discord.js');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleError, handleSuccess } = require('../../utils/embeds');
const { syncAutoModRule, syncAllAutoModRules } = require('../../utils/automodSync');
const settingsCache = require('../../utils/settingsCache');

module.exports = {
    category: 'setup',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Server setup and configuration system.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('dashboard')
                .setDescription('Open the interactive settings menu dashboard for managing Nora.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('automod')
                .setDescription('Configure Discord native AutoMod rules and chat safety settings.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('ticket')
                .setDescription('Configure Support Ticket system settings and spawn ticket panels.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('roblox')
                .setDescription('Configure Roblox verification settings for this server.')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Enable or disable Roblox verification')
                        .setRequired(true))
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('The role to grant verified members')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('starboard')
                .setDescription('Configure Starboard settings for this server.')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Enable or disable the Starboard system')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The channel where starred messages will be posted')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('threshold')
                        .setDescription('Number of reactions required to feature a message (default: 3)')
                        .setMinValue(1)
                        .setMaxValue(100)
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('emoji')
                        .setDescription('Reaction emoji to trigger starboard (default: ⭐)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('onewordstory')
                .setDescription('Configure One Word Story game settings for this server.')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Enable or disable the One Word Story game')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Dedicated channel for the game')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('consecutive')
                        .setDescription('Allow the same user to post multiple words in a row')
                        .setRequired(false))),

    async execute(interaction) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});
        }
        const subcommand = interaction.options.getSubcommand();
        const settings = await settingsCache.get(interaction.guild.id);

        try {
            if (subcommand === 'dashboard') {
                return await this.runDashboard(interaction, settings);
            } else if (subcommand === 'automod') {
                return await this.runDashboard(interaction, settings, 'view_automod');
            } else if (subcommand === 'ticket') {
                return await this.runDashboard(interaction, settings, 'view_ticketing');
            } else if (subcommand === 'roblox') {
                return await this.runRobloxSetup(interaction, settings);
            } else if (subcommand === 'starboard') {
                return await this.runStarboardSetup(interaction, settings);
            } else if (subcommand === 'onewordstory') {
                return await this.runOneWordStorySetup(interaction, settings);
            }
        } catch (err) {
            console.error(`Error executing /setup ${subcommand}:`, err);
            return await handleError(interaction, 'Execution Error', 'An error occurred while executing the setup command.');
        }
    },

    async runRobloxSetup(interaction, settings) {
        const enabled = interaction.options.getBoolean('enabled');
        const role = interaction.options.getRole('role');

        settings.robloxVerifyEnabled = enabled;
        settings.robloxVerifyRoleId = role.id;
        await settings.save();
        settingsCache.invalidate(interaction.guild.id);

        return await handleSuccess(
            interaction, 
            'Roblox Setup Updated', 
            `Roblox Verification is now **${enabled ? 'ENABLED' : 'DISABLED'}**.\nVerified members will receive the role <@&${role.id}>.`
        );
    },

    async runStarboardSetup(interaction, settings) {
        const enabled = interaction.options.getBoolean('enabled');
        const channel = interaction.options.getChannel('channel');
        const threshold = interaction.options.getInteger('threshold');
        const emoji = interaction.options.getString('emoji');

        let updated = false;

        if (enabled !== null) {
            settings.starboardEnabled = enabled;
            updated = true;
        }
        if (channel) {
            settings.starboardChannelId = channel.id;
            updated = true;
        }
        if (threshold !== null) {
            settings.starboardThreshold = threshold;
            updated = true;
        }
        if (emoji) {
            settings.starboardEmoji = emoji.trim();
            updated = true;
        }

        if (updated) {
            await settings.save();
            settingsCache.invalidate(interaction.guild.id);
            return await handleSuccess(
                interaction,
                'Starboard Setup Updated',
                `**Status:** ${settings.starboardEnabled ? 'ENABLED' : 'DISABLED'}\n**Channel:** ${settings.starboardChannelId ? `<#${settings.starboardChannelId}>` : 'Not set'}\n**Threshold:** ${settings.starboardThreshold} reactions\n**Emoji:** ${settings.starboardEmoji}`
            );
        }

        return await this.runDashboard(interaction, settings, 'view_starboard');
    },

    async runOneWordStorySetup(interaction, settings) {
        const enabled = interaction.options.getBoolean('enabled');
        const channel = interaction.options.getChannel('channel');
        const consecutive = interaction.options.getBoolean('consecutive');

        let updated = false;

        if (enabled !== null) {
            settings.oneWordStoryEnabled = enabled;
            updated = true;
        }
        if (channel) {
            settings.oneWordStoryChannelId = channel.id;
            updated = true;
        }
        if (consecutive !== null) {
            settings.oneWordStoryAllowConsecutive = consecutive;
            updated = true;
        }

        if (updated) {
            await settings.save();
            settingsCache.invalidate(interaction.guild.id);
            return await handleSuccess(
                interaction,
                'One Word Story Setup Updated',
                `**Status:** ${settings.oneWordStoryEnabled ? 'ENABLED' : 'DISABLED'}\n` +
                `**Channel:** ${settings.oneWordStoryChannelId ? `<#${settings.oneWordStoryChannelId}>` : 'Any channel'}\n` +
                `**Consecutive Turns:** ${settings.oneWordStoryAllowConsecutive ? 'Allowed' : 'Disabled (strictly enforced)'}`
            );
        }

        return await this.runDashboard(interaction, settings, 'view_onewordstory');
    },

    async runDashboard(interaction, settings, initialViewName = 'main') {
        const APP_OWNER_IDS = [process.env.APP_OWNER_ID || '1214048435632603137', '1366229304257544213'];

        const Autoresponder = require('../../database/models/Autoresponder');
        const ContentFeed = require('../../database/models/ContentFeed');
        const autoresponderCount = await Autoresponder.count({ where: { guildId: interaction.guild.id } }).catch(() => 0);
        const youtubeFeedCount = await ContentFeed.count({ where: { guildId: interaction.guild.id, platform: 'YOUTUBE' } }).catch(() => 0);

        let state = {
            rewardLevel: null,
            verifyChannel: null,
            verifyRole: null,
            ticketCh: null,
            currentView: 'main',
            autoresponderCount,
            youtubeFeedCount
        };

        const getRoleColor = (interaction) => {
            if (!interaction.guild) return 0x57acf2;
            const color = interaction.guild.members.me.roles.highest.color;
            return color === 0 ? 0x57acf2 : color;
        };

        const buildDashboard = (viewName) => {
            const embed = new EmbedBuilder()
                .setColor(getRoleColor(interaction))
                .setTimestamp()
                .setFooter({ text: `Nora Settings • ${interaction.guild.name}` });

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('go_back').setLabel('Back to Menu').setStyle(ButtonStyle.Secondary)
            );

            // --- MAIN ---
            if (viewName === 'main') {
                embed.setTitle('Nora Settings')
                     .setDescription('Configure how Nora works in your server. Most features are automated for simplicity.');
                const menu = new StringSelectMenuBuilder().setCustomId('config_main').setPlaceholder('Choose a category...').addOptions([
                    { label: 'Safety & Anti-Raid', value: 'view_antiraid', description: 'Stop bot raids and new accounts.' },
                    { label: 'Chat Safety (AutoMod)', value: 'view_automod', description: 'Filter bad words, spam, and scam links via Discord AutoMod.' },
                    { label: 'Member Logs', value: 'view_logging', description: 'Keep track of joins, leaves, and edits.' },
                    { label: 'Leveling & XP', value: 'view_levels', description: 'Reward active chatters with ranks.' },
                    { label: 'Starboard System', value: 'view_starboard', description: 'Community star voting and post highlighting.' },
                    { label: 'One Word Story Game', value: 'view_onewordstory', description: 'Collaborative word-by-word story game.' },
                    { label: 'Strikes & Bans', value: 'view_warnings', description: 'Manage how users are punished for bad behavior.' },
                    { label: 'Support Tickets', value: 'view_ticketing', description: 'Help members with a private ticket system.' },
                    { label: 'Join Verification', value: 'view_verify', description: 'Verify new members before they join.' },
                    { label: 'Roblox Verification', value: 'view_roblox', description: 'Configure Roblox integration and panel.' },
                    { label: 'Self Roles', value: 'view_selfroles', description: 'Create interactive role panels.' },
                    { label: 'Fun & Games', value: 'view_extras', description: 'Welcomer, Counting game, and more.' },
                    { label: 'AI Settings', value: 'view_ai', description: 'Change Nora\'s AI engine and personality.' }
                ]);
                if (APP_OWNER_IDS.includes(interaction.user.id)) {
                    menu.addOptions([
                        { label: 'Dev Settings', value: 'view_dev', description: 'Reboot and sync database.' },
                        { label: 'Premium Settings', value: 'view_premium', description: 'Configure override premium status for users and guilds.' }
                    ]);
                }
                return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
            }

            // --- SAFETY & RAID ---
            if (viewName === 'view_antiraid') {
                embed.setTitle('Safety & Anti-Raid')
                     .setDescription('Settings to prevent your server from being raided by bots.')
                     .addFields(
                        { name: 'Anti-Raid', value: settings.antiRaidEnabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Lockdown', value: settings.lockdownMode ? 'Active' : 'Off', inline: true },
                        { name: 'Photo Check', value: settings.requirePFP ? 'Required' : 'Optional', inline: true },
                        { name: 'Age Gate', value: settings.minAccountAge > 0 ? `${settings.minAccountAge} days` : 'Off', inline: true },
                        { name: 'Nick Filter', value: settings.nicknameRaidFilter ? 'Active' : 'Off', inline: true },
                        { name: 'Action', value: settings.antiRaidAction, inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_antiraid_toggle').setLabel(settings.antiRaidEnabled ? 'Disable Anti-Raid' : 'Enable Anti-Raid').setStyle(settings.antiRaidEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_lockdown_toggle').setLabel(settings.lockdownMode ? 'End Lockdown' : 'Start Lockdown').setStyle(settings.lockdownMode ? ButtonStyle.Success : ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('action_pfp_toggle').setLabel('Toggle Photo Req').setStyle(settings.requirePFP ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_nickfilter_toggle').setLabel('Toggle Nick Filter').setStyle(settings.nicknameRaidFilter ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
                const rowB = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_antiraid_threshold').setPlaceholder('Sensitivity...').addOptions([{label:'Strict',value:'3'},{label:'Normal',value:'5'},{label:'Relaxed',value:'10'}]));
                const rowC = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_accountage_minage').setPlaceholder('Minimum Account Age...').addOptions([{label:'Disabled',value:'0'},{label:'1 Day',value:'1'},{label:'7 Days',value:'7'},{label:'30 Days',value:'30'}]));
                const rowD = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_antiraid_action').setPlaceholder('Action taken on raid detect...').addOptions([{label:'Notify Only',value:'notify'},{label:'Lockdown',value:'lockdown'},{label:'Kick New Users',value:'kick_new'}]));
                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            // --- CHAT SAFETY ---
            if (viewName === 'view_automod') {
                const on  = (v) => v ? '🟢 Blocked' : '🔴 Allowed';
                embed.setTitle('Chat Safety (AutoMod)')
                     .setDescription('All rules are enforced by **Discord\'s native AutoMod engine** — zero false positives, zero delay.\n\nToggle each rule to create or remove it from your server\'s AutoMod rules.')
                     .addFields(
                        { name: '🔤 Profanity', value: on(settings.automodProfanity), inline: true },
                        { name: '🔞 Sexual Content', value: on(settings.automodSexual), inline: true },
                        { name: '🚫 Slurs', value: on(settings.automodSlurs), inline: true },
                        { name: '🔗 Scam Links', value: on(settings.automodScam), inline: true },
                        { name: '💬 Text Spam', value: on(settings.automodSpam), inline: true },
                        { name: '🔞 Hardcore Media', value: on(settings.automodHardcore), inline: true },
                        { name: '📢 Mention Spam', value: settings.automodMentions > 0 ? `🟢 Max ${settings.automodMentions}` : '🔴 Off', inline: true },
                        { name: '🛡️ Bypass Roles', value: (() => { try { const r = JSON.parse(settings.automodImmuneRoles || '[]'); return r.length ? r.map(id => `<@&${id}>`).join(', ') : '*None*'; } catch { return '*None*'; } })(), inline: true }
                     );

                // Row A: Preset word filters (all go into one Discord KeywordPreset rule)
                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_automod_profanity').setLabel('Profanity').setStyle(settings.automodProfanity ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_sexual').setLabel('Sexual Content').setStyle(settings.automodSexual ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_slurs').setLabel('Slurs').setStyle(settings.automodSlurs ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_scam').setLabel('Scam Links').setStyle(settings.automodScam ? ButtonStyle.Success : ButtonStyle.Secondary)
                );

                // Row B: Keyword/Spam rule toggles
                const rowB = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_automod_spam').setLabel('Text Spam').setStyle(settings.automodSpam ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_hardcore').setLabel('Hardcore Media').setStyle(settings.automodHardcore ? ButtonStyle.Success : ButtonStyle.Secondary)
                );

                // Row C: Mention spam threshold
                const rowC = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_automod_mentions').setPlaceholder('Mention Spam Limit...').addOptions([
                        { label: 'Off — No limit', value: '0', default: settings.automodMentions === 0 },
                        { label: '3 Mentions max', value: '3', default: settings.automodMentions === 3 },
                        { label: '5 Mentions max', value: '5', default: settings.automodMentions === 5 },
                        { label: '10 Mentions max', value: '10', default: settings.automodMentions === 10 },
                        { label: '15 Mentions max', value: '15', default: settings.automodMentions === 15 },
                        { label: '20 Mentions max', value: '20', default: settings.automodMentions === 20 },
                    ])
                );

                // Row D: Bypass roles
                const rowD = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_automod_immune').setPlaceholder('Select Bypass Roles...').setMinValues(0).setMaxValues(20)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            // view_antispam is retired — spam detection now handled by Discord's native AutoMod engine
            if (viewName === 'view_antispam') return buildDashboard('view_automod');


            // --- MEMBER LOGS & SECTION ROUTING ---
            if (viewName === 'view_logging') {
                let logChannels = {};
                if (typeof settings.loggingChannels === 'object' && settings.loggingChannels !== null) {
                    logChannels = settings.loggingChannels;
                } else if (typeof settings.loggingChannels === 'string') {
                    try { logChannels = JSON.parse(settings.loggingChannels); } catch(e) { logChannels = {}; }
                }

                const activeSection = state.selectedLogCategory || settings.selectedLogCategory || 'default';
                const categoryLabels = {
                    default: '⚙️ Default Fallback Log Channel',
                    messages: '💬 Message Logs (Edits & Deletes)',
                    members: '👥 Member Logs (Joins, Leaves & Boosts)',
                    channels: '📁 Channel Logs (Creates, Edits & Deletes)',
                    voice: '🎙️ Voice Logs (Joins, Leaves & Moves)',
                    automod: '🛡️ AutoMod & Safety Logs'
                };

                const defaultChStr = settings.loggingChannelId ? `<#${settings.loggingChannelId}>` : '*None*';

                embed.setTitle('Server Logging & Channel Routing')
                     .setDescription(
                        `**Current Target for Selected Category:** ${categoryLabels[activeSection] || 'Default'}\n` +
                        `Assign different channels to different log sections below.`
                     )
                     .addFields(
                          { name: '⚙️ Default Fallback', value: defaultChStr, inline: true },
                          { name: '💬 Message Logs', value: logChannels.messages ? `<#${logChannels.messages}>` : `*(Fallback)*`, inline: true },
                          { name: '👥 Member Logs', value: logChannels.members ? `<#${logChannels.members}>` : `*(Fallback)*`, inline: true },
                          { name: '📁 Channel Logs', value: logChannels.channels ? `<#${logChannels.channels}>` : `*(Fallback)*`, inline: true },
                          { name: '🎙️ Voice Logs', value: logChannels.voice ? `<#${logChannels.voice}>` : `*(Fallback)*`, inline: true },
                          { name: '🛡️ AutoMod Logs', value: logChannels.automod ? `<#${logChannels.automod}>` : `*(Fallback)*`, inline: true },
                          { name: 'Member Joins', value: settings.logMemberJoins ? '🟢 On' : '🔴 Off', inline: true },
                          { name: 'Member Leaves', value: settings.logMemberLeaves ? '🟢 On' : '🔴 Off', inline: true },
                          { name: 'Message Edits', value: settings.logMessageEdits ? '🟢 On' : '🔴 Off', inline: true },
                          { name: 'Message Deletes', value: settings.logMessageDeletes ? '🟢 On' : '🔴 Off', inline: true },
                          { name: 'AutoMod Blocked', value: settings.logAutomod ? '🟢 On' : '🔴 Off', inline: true },
                          { name: 'Channel Creates', value: settings.logChannelCreates ? '🟢 On' : '🔴 Off', inline: true }
                     );

                const rowA = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('action_log_toggle')
                        .setPlaceholder('Configure Logging Events (Select Multiple)...')
                        .setMinValues(0)
                        .setMaxValues(12)
                        .addOptions([
                            { label: 'Member Joins', value: 'logMemberJoins', description: 'Log when a user joins the server.', default: !!settings.logMemberJoins },
                            { label: 'Member Leaves', value: 'logMemberLeaves', description: 'Log when a user leaves the server.', default: !!settings.logMemberLeaves },
                            { label: 'Message Edits', value: 'logMessageEdits', description: 'Log message modifications.', default: !!settings.logMessageEdits },
                            { label: 'Message Deletes', value: 'logMessageDeletes', description: 'Log message deletions.', default: !!settings.logMessageDeletes },
                            { label: 'AutoMod Actions', value: 'logAutomod', description: 'Log messages blocked by AutoMod.', default: !!settings.logAutomod },
                            { label: 'Channel Creates', value: 'logChannelCreates', description: 'Log when a channel is created.', default: !!settings.logChannelCreates },
                            { label: 'Channel Edits', value: 'logChannelEdits', description: 'Log when a channel is updated.', default: !!settings.logChannelEdits },
                            { label: 'Channel Deletes', value: 'logChannelDeletes', description: 'Log when a channel is deleted.', default: !!settings.logChannelDeletes },
                            { label: 'Voice Joins', value: 'logVoiceJoins', description: 'Log when a user joins voice.', default: !!settings.logVoiceJoins },
                            { label: 'Voice Leaves', value: 'logVoiceLeaves', description: 'Log when a user leaves voice.', default: !!settings.logVoiceLeaves },
                            { label: 'Voice Moves', value: 'logVoiceMoves', description: 'Log when a user moves voice channels.', default: !!settings.logVoiceMoves },
                            { label: 'Server Boosts', value: 'logMemberBoosts', description: 'Log when the server is boosted.', default: !!settings.logMemberBoosts }
                        ])
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('action_log_part_select')
                        .setPlaceholder(`1️⃣ Select Log Part: ${categoryLabels[activeSection] || 'Default'}`)
                        .addOptions([
                            { label: 'Default / Master Fallback', value: 'default', description: 'Master log channel used when a specific section is unassigned.', default: activeSection === 'default' },
                            { label: 'Message Logs', value: 'messages', description: 'Dedicated channel for Message Edits & Deletes.', default: activeSection === 'messages' },
                            { label: 'Member Logs', value: 'members', description: 'Dedicated channel for Member Joins, Leaves & Boosts.', default: activeSection === 'members' },
                            { label: 'Channel Logs', value: 'channels', description: 'Dedicated channel for Channel Creates, Edits & Deletes.', default: activeSection === 'channels' },
                            { label: 'Voice Logs', value: 'voice', description: 'Dedicated channel for Voice Joins, Leaves & Moves.', default: activeSection === 'voice' },
                            { label: 'AutoMod & Safety Logs', value: 'automod', description: 'Dedicated channel for AutoMod & Safety Blocks.', default: activeSection === 'automod' }
                        ])
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('action_log_channel')
                        .setPlaceholder(`2️⃣ Select Target Channel for ${categoryLabels[activeSection] || 'Default'}...`)
                        .setChannelTypes(ChannelType.GuildText)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // --- LEVELING ---
            if (viewName === 'view_levels') {
                embed.setTitle('Leveling & XP')
                     .setDescription('Users gain XP by chatting (15-25 XP/min) and being active in voice (50 XP every 5 min).')
                     .addFields(
                        { name: 'Level Alerts', value: settings.levelUpNotificationsEnabled ? 'On' : 'Off', inline: true },
                        { name: 'Alert Channel', value: settings.levelUpChannelId ? `<#${settings.levelUpChannelId}>` : 'Current Channel', inline: true },
                        { name: 'Voice XP Rate', value: '50 XP per 300s (5 min)', inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_leveling_toggle').setLabel(settings.levelingEnabled ? 'Disable XP' : 'Enable XP').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('action_levelalert_toggle').setLabel('Toggle Alerts').setStyle(ButtonStyle.Secondary)
                );
                const rowB = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_levelalert_channel').setPlaceholder('Select Level Up Channel...').setChannelTypes(ChannelType.GuildText));
                return { embeds: [embed], components: [rowA, rowB, backRow] };
            }

            // --- AI SETTINGS ---
            if (viewName === 'view_ai') {
                embed.setTitle('AI Engine')
                     .setDescription(`Active Engine: **${settings.aiPreference}**\n\n⚠️ **Notice:** The AI Engines feature is temporarily disabled.`);
                const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_ai_pref').setPlaceholder('Choose Nora\'s Brain...').setDisabled(true).addOptions([
                    {label:'Built-in Logic (Free) [Disabled]',value:'LOCAL'},
                    {label:'Gemini (Google) [Disabled]',value:'BUILT_IN'},
                    {label:'ChatGPT (OpenAI) [Disabled]',value:'OPENAI'}
                ]));
                return { embeds: [embed], components: [row, backRow] };
            }

            // --- DEV SETTINGS ---
            if (viewName === 'view_dev') {
                embed.setTitle('Developer Operations')
                     .setDescription('High-level administrative commands for the bot owner.')
                     .setColor(getRoleColor(interaction));
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('dev_reboot').setLabel('Force Reboot').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('dev_dbsync').setLabel('Sync Database').setStyle(ButtonStyle.Primary)
                );
                return { embeds: [embed], components: [row, backRow] };
            }

            // --- PREMIUM SETTINGS ---
            if (viewName === 'view_premium') {
                embed.setTitle('Premium Management (Owner Only)')
                     .setDescription('Configure manual/override premium status for users and guilds.')
                     .setColor(getRoleColor(interaction));
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('premium_enable_btn').setLabel('Enable Premium').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('premium_disable_btn').setLabel('Disable Premium').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('premium_remove_btn').setLabel('Remove Premium').setStyle(ButtonStyle.Secondary)
                );
                return { embeds: [embed], components: [row, backRow] };
            }

            // --- WARNINGS ---
            if (viewName === 'view_warnings') {
                embed.setTitle('Strikes & Bans')
                     .setDescription('Manage how users are punished for bad behavior.')
                     .addFields(
                        { name: 'Max Warnings', value: settings.warningThreshold > 0 ? `${settings.warningThreshold}` : 'Off', inline: true },
                        { name: 'Action', value: settings.warningAction, inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_warning_thresh').setPlaceholder('Number of warnings...').addOptions([
                        {label:'1 Warning',value:'1'},
                        {label:'3 Warnings',value:'3'},
                        {label:'5 Warnings',value:'5'},
                        {label:'10 Warnings',value:'10'}
                    ])
                );
                const rowB = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_warning_action').setPlaceholder('Action on max warnings...').addOptions([
                        {label:'None',value:'none'},
                        {label:'Kick',value:'kick'},
                        {label:'Ban',value:'ban'},
                        {label:'Timeout',value:'timeout'}
                    ])
                );
                return { embeds: [embed], components: [rowA, rowB, backRow] };
            }

            // --- TICKETING ---
            if (viewName === 'view_ticketing') {
                embed.setTitle('Support Tickets & Panel System')
                     .setDescription('Configure how tickets are created, assigned, and managed in your server.')
                     .addFields(
                        { name: '📁 Category', value: settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : 'None', inline: true },
                        { name: '📢 Spawn Channel', value: settings.ticketChannelId ? `<#${settings.ticketChannelId}>` : 'Current channel', inline: true },
                        { name: '🛡️ Support Staff Role', value: settings.ticketSupportRoleId ? `<@&${settings.ticketSupportRoleId}>` : 'None (Admins only)', inline: true },
                        { name: '⏰ 24h Auto-Archive', value: settings.ticketAutoArchive ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: '📝 Panel Title', value: settings.ticketPanelTitle || 'Support Center', inline: true },
                        { name: '📄 Panel Description', value: settings.ticketPanelDesc ? 'Customized' : 'Default', inline: true }
                     );

                const rowA = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('action_ticket_category')
                        .setPlaceholder('1️⃣ Select Ticket Category...')
                        .setChannelTypes(ChannelType.GuildCategory)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('action_ticket_channel')
                        .setPlaceholder('2️⃣ Select Panel Spawn Channel...')
                        .setChannelTypes(ChannelType.GuildText)
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('action_ticket_support_role')
                        .setPlaceholder('3️⃣ Select Support Staff Role...')
                );

                const rowD = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('action_ticket_autoarchive_toggle')
                        .setLabel(settings.ticketAutoArchive ? 'Disable 24h Auto-Close' : 'Enable 24h Auto-Close')
                        .setStyle(settings.ticketAutoArchive ? ButtonStyle.Danger : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('action_ticket_customize_panel')
                        .setLabel('Customize Panel Text')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('action_ticket_spawn')
                        .setLabel('Spawn Ticket Panel')
                        .setStyle(ButtonStyle.Success)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            // --- VERIFY ---
            if (viewName === 'view_verify') {
                const rolesDisplay = settings.verifyRoleId ? settings.verifyRoleId.split(',').map(id => `<@&${id}>`).join(' ') : 'None';
                embed.setTitle('Join Verification')
                     .setDescription('Require new members to verify themselves before accessing the server.')
                     .addFields(
                          { name: 'Verify Channel', value: settings.verifyChannelId ? `<#${settings.verifyChannelId}>` : 'Current Channel', inline: true },
                          { name: 'Verified Roles', value: rolesDisplay, inline: false }
                      );
                const rowA = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_verify_channel').setPlaceholder('Select Custom Verify Channel...').setChannelTypes(ChannelType.GuildText));
                const rowB = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('action_verify_role').setPlaceholder('Select Verified Role(s)...').setMinValues(1).setMaxValues(5));
                const rowC = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('action_verify_spawn').setLabel('Spawn Verify Panel').setStyle(ButtonStyle.Success));
                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // --- ROBLOX ---
            if (viewName === 'view_roblox') {
                embed.setTitle('Roblox Verification')
                     .setDescription('Configure Roblox integration and panel spawning.')
                     .addFields(
                          { name: 'Status', value: settings.robloxVerifyEnabled ? 'Enabled' : 'Disabled', inline: true },
                          { name: 'Verified Role', value: settings.robloxVerifyRoleId ? `<@&${settings.robloxVerifyRoleId}>` : 'None', inline: true },
                          { name: 'Spawn Channel', value: settings.robloxVerifyChannelId ? `<#${settings.robloxVerifyChannelId}>` : 'First text channel', inline: true }
                      );
                const rowA = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('action_roblox_toggle').setLabel(settings.robloxVerifyEnabled ? 'Disable Roblox Verify' : 'Enable Roblox Verify').setStyle(settings.robloxVerifyEnabled ? ButtonStyle.Danger : ButtonStyle.Success));
                const rowB = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('action_roblox_role').setPlaceholder('Select Roblox Verified Role...'));
                const rowC = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_roblox_channel').setPlaceholder('Select Spawn Channel...').setChannelTypes(ChannelType.GuildText));
                const rowD = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_roblox_spawn').setLabel('Spawn Roblox Verify Panel').setStyle(ButtonStyle.Success)
                );
                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            // --- STARBOARD ---
            if (viewName === 'view_starboard') {
                embed.setTitle('Starboard System')
                     .setDescription('Community voting system. When members react to messages with the trigger emoji, Nora will automatically repost them to the designated starboard channel.')
                     .addFields(
                        { name: 'Status', value: settings.starboardEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: 'Channel', value: settings.starboardChannelId ? `<#${settings.starboardChannelId}>` : 'None', inline: true },
                        { name: 'Threshold', value: `${settings.starboardThreshold || 3} reactions`, inline: true },
                        { name: 'Emoji', value: settings.starboardEmoji || '⭐', inline: true },
                        { name: 'Webhook Mode', value: settings.starboardWebhookEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: 'Embed Color', value: settings.starboardEmbedColor || '#ffac33', inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_starboard_toggle').setLabel(settings.starboardEnabled ? 'Disable Starboard' : 'Enable Starboard').setStyle(settings.starboardEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_starboard_webhook_toggle').setLabel('Toggle Webhook Mode').setStyle(settings.starboardWebhookEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
                const rowB = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_starboard_channel').setPlaceholder('Select Starboard Channel...').setChannelTypes(ChannelType.GuildText));
                const rowC = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_starboard_threshold').setPlaceholder('Reaction Threshold...').addOptions([
                    { label: '1 Reaction', value: '1', default: settings.starboardThreshold === 1 },
                    { label: '2 Reactions', value: '2', default: settings.starboardThreshold === 2 },
                    { label: '3 Reactions (Default)', value: '3', default: settings.starboardThreshold === 3 },
                    { label: '5 Reactions', value: '5', default: settings.starboardThreshold === 5 },
                    { label: '10 Reactions', value: '10', default: settings.starboardThreshold === 10 }
                ]));
                const rowD = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_starboard_emoji').setPlaceholder('Trigger Emoji...').addOptions([
                    { label: '⭐ Star (Default)', value: '⭐', default: settings.starboardEmoji === '⭐' },
                    { label: '🌟 Glowing Star', value: '🌟', default: settings.starboardEmoji === '🌟' },
                    { label: '❤️ Heart', value: '❤️', default: settings.starboardEmoji === '❤️' },
                    { label: '🔥 Fire', value: '🔥', default: settings.starboardEmoji === '🔥' },
                    { label: '👍 Thumbs Up', value: '👍', default: settings.starboardEmoji === '👍' }
                ]));
                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            // --- ONE WORD STORY ---
            if (viewName === 'view_onewordstory') {
                embed.setTitle('One Word Story Game')
                     .setDescription('Collaborative word-by-word story building game. Members take turns contributing single words to write a story together.')
                     .addFields(
                        { name: 'Status', value: settings.oneWordStoryEnabled !== false ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: 'Dedicated Channel', value: settings.oneWordStoryChannelId ? `<#${settings.oneWordStoryChannelId}>` : 'Any channel (via `/onewordstory`)', inline: true },
                        { name: 'Consecutive Turns', value: settings.oneWordStoryAllowConsecutive ? '🟢 Allowed' : '🔴 Disabled (strictly enforced)', inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_onewordstory_toggle').setLabel(settings.oneWordStoryEnabled !== false ? 'Disable Game' : 'Enable Game').setStyle(settings.oneWordStoryEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_onewordstory_consecutive_toggle').setLabel(settings.oneWordStoryAllowConsecutive ? 'Disable Consecutive Turns' : 'Allow Consecutive Turns').setStyle(settings.oneWordStoryAllowConsecutive ? ButtonStyle.Danger : ButtonStyle.Secondary)
                );
                const rowB = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_onewordstory_channel').setPlaceholder('Select Dedicated Story Channel...').setChannelTypes(ChannelType.GuildText));
                return { embeds: [embed], components: [rowA, rowB, backRow] };
            }

            // --- SELF ROLES ---
            if (viewName === 'view_selfroles') {
                embed.setTitle('Self Roles Panel Builder')
                     .setDescription('Drop an interactive panel in this channel for users to assign themselves roles.')
                     .addFields({ name: 'Instructions', value: 'Click the button below to open the Builder. You will need the IDs of the roles you want to offer.' });
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('action_selfroles_build').setLabel('Build Panel Here').setStyle(ButtonStyle.Success));
                return { embeds: [embed], components: [row, backRow] };
            }

            // --- EXTRAS ---
            if (viewName === 'view_extras') {
                embed.setTitle('Fun & Games')
                     .setDescription('Additional fun features for your server.')
                     .addFields(
                        { name: 'Welcomer', value: settings.welcomerEnabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Welcome Ch.', value: settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : 'None', inline: true },
                        { name: 'Counting Ch.', value: settings.countingChannelId ? `<#${settings.countingChannelId}>` : 'None', inline: true },
                        { name: 'Vote Log', value: settings.voteLogChannelId ? `<#${settings.voteLogChannelId}>` : 'None', inline: true },
                        { name: 'Autoresponder', value: `${state.autoresponderCount} trigger(s)`, inline: true },
                        { name: 'YouTube Alerts', value: `${state.youtubeFeedCount} channel(s)`, inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('action_welcomer_toggle').setLabel(settings.welcomerEnabled ? 'Disable Welcomer' : 'Enable Welcomer').setStyle(settings.welcomerEnabled ? ButtonStyle.Danger : ButtonStyle.Success));
                const rowB = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_welcome_channel').setPlaceholder('Select Welcome Channel...').setChannelTypes(ChannelType.GuildText));
                const rowC = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_counting_channel').setPlaceholder('Select Counting Channel...').setChannelTypes(ChannelType.GuildText));
                const rowD = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_votelog_channel').setPlaceholder('Select Vote Log Channel...').setChannelTypes(ChannelType.GuildText));
                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            embed.setTitle('Under Construction').setDescription('This menu is currently being built. Check back soon!');
            return { embeds: [embed], components: [backRow] };
        };

        const initialView = buildDashboard(initialViewName);
        let response;
        if (interaction.deferred || interaction.replied) {
            response = await interaction.editReply({ ...initialView, ephemeral: true });
        } else {
            response = await interaction.reply({ ...initialView, ephemeral: true });
        }

        const collector = response.createMessageComponentCollector({ time: 600000 });

        collector.on('collect', async i => {
            try {
                if (i.user.id !== interaction.user.id) return i.reply({ content: 'Not your menu.', ephemeral: true });

                // Refresh counts dynamically
                state.autoresponderCount = await Autoresponder.count({ where: { guildId: interaction.guild.id } }).catch(() => 0);
                state.youtubeFeedCount = await ContentFeed.count({ where: { guildId: interaction.guild.id, platform: 'YOUTUBE' } }).catch(() => 0);

                if (i.customId === 'config_main' || i.customId.startsWith('view_')) {
                    const view = i.customId.startsWith('view_') ? i.customId : i.values[0];
                    state.currentView = view;
                    return i.update(buildDashboard(view));
                }

                if (i.customId === 'go_back') {
                    state.currentView = 'main';
                    return i.update(buildDashboard('main'));
                }

                let update = false;
                let sync = null;

                // Starboard
                if (i.customId === 'action_starboard_toggle') { settings.starboardEnabled = !settings.starboardEnabled; update = true; }
                if (i.customId === 'action_starboard_webhook_toggle') { settings.starboardWebhookEnabled = !settings.starboardWebhookEnabled; update = true; }
                if (i.customId === 'action_starboard_channel') { settings.starboardChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_starboard_threshold') { settings.starboardThreshold = parseInt(i.values[0]); update = true; }
                if (i.customId === 'action_starboard_emoji') { settings.starboardEmoji = i.values[0]; update = true; }

                // One Word Story
                if (i.customId === 'action_onewordstory_toggle') { settings.oneWordStoryEnabled = !settings.oneWordStoryEnabled; update = true; }
                if (i.customId === 'action_onewordstory_consecutive_toggle') { settings.oneWordStoryAllowConsecutive = !settings.oneWordStoryAllowConsecutive; update = true; }
                if (i.customId === 'action_onewordstory_channel') { settings.oneWordStoryChannelId = i.values[0]; update = true; }

                // Anti-Raid
                if (i.customId === 'action_antiraid_toggle') { settings.antiRaidEnabled = !settings.antiRaidEnabled; update = true; }
                if (i.customId === 'action_lockdown_toggle') { settings.lockdownMode = !settings.lockdownMode; update = true; }
                if (i.customId === 'action_pfp_toggle') { settings.requirePFP = !settings.requirePFP; update = true; }
                if (i.customId === 'action_nickfilter_toggle') { settings.nicknameRaidFilter = !settings.nicknameRaidFilter; update = true; }
                if (i.customId === 'action_antiraid_threshold') { settings.antiRaidThreshold = parseInt(i.values[0]); update = true; }
                if (i.customId === 'action_accountage_minage') { settings.minAccountAge = parseInt(i.values[0]); update = true; }
                if (i.customId === 'action_antiraid_action') { settings.antiRaidAction = i.values[0]; update = true; }

                // AutoMod — independent toggle per rule type
                if (i.customId === 'action_automod_profanity') { settings.automodProfanity = !settings.automodProfanity; update = true; sync = 'profanity'; }
                if (i.customId === 'action_automod_sexual')    { settings.automodSexual = !settings.automodSexual; update = true; sync = 'profanity'; }
                if (i.customId === 'action_automod_slurs')     { settings.automodSlurs = !settings.automodSlurs; update = true; sync = 'profanity'; }
                if (i.customId === 'action_automod_scam')      { settings.automodScam = !settings.automodScam; update = true; sync = 'scam'; }
                if (i.customId === 'action_automod_spam')      { settings.automodSpam = !settings.automodSpam; update = true; sync = 'spam'; }
                if (i.customId === 'action_automod_hardcore')  { settings.automodHardcore = !settings.automodHardcore; update = true; sync = 'hardcore'; }
                if (i.customId === 'action_automod_mentions')  { settings.automodMentions = parseInt(i.values[0]); update = true; sync = 'mentions'; }
                if (i.customId === 'action_automod_immune')    { settings.automodImmuneRoles = JSON.stringify(i.values); update = true; sync = 'all'; }

                // Anti-Spam (legacy handlers removed — fully managed by Discord native AutoMod)

                // Logging & Section Channel Routing
                if (i.customId === 'action_log_part_select') {
                    state.selectedLogCategory = i.values[0];
                    settings.selectedLogCategory = i.values[0];
                    return i.update(buildDashboard('view_logging'));
                }
                if (i.customId === 'action_log_channel') {
                    const selectedCategory = state.selectedLogCategory || settings.selectedLogCategory || 'default';
                    const targetChannelId = i.values[0];

                    if (selectedCategory === 'default') {
                        settings.loggingChannelId = targetChannelId;
                    } else {
                        let currentMap = {};
                        if (typeof settings.loggingChannels === 'object' && settings.loggingChannels !== null) {
                            currentMap = { ...settings.loggingChannels };
                        } else if (typeof settings.loggingChannels === 'string') {
                            try { currentMap = JSON.parse(settings.loggingChannels); } catch(e) { currentMap = {}; }
                        }
                        currentMap[selectedCategory] = targetChannelId;
                        settings.loggingChannels = currentMap;
                        if (typeof settings.changed === 'function') settings.changed('loggingChannels', true);
                    }
                    update = true;
                }
                if (i.customId === 'action_log_toggle') {
                    const values = i.values;
                    const logFields = [
                        'logMemberJoins', 'logMemberLeaves', 'logMessageEdits', 'logMessageDeletes',
                        'logAutomod', 'logChannelCreates', 'logChannelEdits', 'logChannelDeletes',
                        'logVoiceJoins', 'logVoiceLeaves', 'logVoiceMoves', 'logMemberBoosts'
                    ];
                    for (const field of logFields) {
                        settings[field] = values.includes(field);
                    }
                    update = true;
                }

                // Leveling
                if (i.customId === 'action_leveling_toggle') { settings.levelingEnabled = !settings.levelingEnabled; update = true; }
                if (i.customId === 'action_levelalert_toggle') { settings.levelUpNotificationsEnabled = !settings.levelUpNotificationsEnabled; update = true; }
                if (i.customId === 'action_levelalert_channel') { settings.levelUpChannelId = i.values[0]; update = true; }

                // Base Settings
                if (i.customId === 'action_ai_pref') { settings.aiPreference = i.values[0]; update = true; }
                if (i.customId === 'action_warning_thresh') { settings.warningThreshold = parseInt(i.values[0]); update = true; }
                if (i.customId === 'action_warning_action') { settings.warningAction = i.values[0]; update = true; }
                
                // Ticketing
                if (i.customId === 'action_ticket_category') { settings.ticketCategoryId = i.values[0]; update = true; }
                if (i.customId === 'action_ticket_channel') { settings.ticketChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_ticket_support_role') { settings.ticketSupportRoleId = i.values[0]; update = true; }
                if (i.customId === 'action_ticket_autoarchive_toggle') { settings.ticketAutoArchive = !settings.ticketAutoArchive; update = true; }
                if (i.customId === 'action_ticket_customize_panel') {
                    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                    const modal = new ModalBuilder().setCustomId('modal_ticket_customize_panel').setTitle('Customize Ticket Panel');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('panel_title')
                                .setLabel('Panel Title')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                                .setValue(settings.ticketPanelTitle || 'Support Center')
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('panel_desc')
                                .setLabel('Panel Description')
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                                .setValue(settings.ticketPanelDesc || 'Need assistance? Please select the category that best matches your issue below to open a private channel with the Staff team.\n\n**Categories:**\n**Support:** General questions or assistance.\n**Reporting:** Report a user breaking the rules or a bug.\n**Appeals:** Request an appeal for an action taken against you.\n**Other:** Anything else.')
                        )
                    );
                    await i.showModal(modal);

                    try {
                        const submitted = await i.awaitModalSubmit({ time: 300000, filter: x => x.user.id === interaction.user.id && x.customId === 'modal_ticket_customize_panel' });
                        settings.ticketPanelTitle = submitted.fields.getTextInputValue('panel_title');
                        settings.ticketPanelDesc = submitted.fields.getTextInputValue('panel_desc');
                        await settings.save();
                        settingsCache.invalidate(interaction.guild.id);
                        return submitted.update(buildDashboard('view_ticketing'));
                    } catch (e) {
                        return;
                    }
                }
                if (i.customId === 'action_ticket_spawn') {
                    if (!settings.ticketCategoryId) return i.reply({ content: '⚠️ You must select a Ticket Category above first!', ephemeral: true });
                    const targetChannelId = settings.ticketChannelId || i.channel.id;
                    const channel = i.guild.channels.cache.get(targetChannelId) || i.channel;
                    
                    const panelTitle = settings.ticketPanelTitle || 'Support Center';
                    const panelDesc = settings.ticketPanelDesc || 'Need assistance? Please select the category that best matches your issue below to open a private channel with the Staff team.\n\n**Categories:**\n**Support:** General questions or assistance.\n**Reporting:** Report a user breaking the rules or a bug.\n**Appeals:** Request an appeal for an action taken against you.\n**Other:** Anything else.';

                    const pEmbed = new EmbedBuilder()
                        .setTitle(panelTitle)
                        .setDescription(panelDesc)
                        .setColor(getRoleColor(interaction))
                        .setFooter({ text: 'Support Ticketing System' });

                    const pRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket_Support').setLabel('Support').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('ticket_Reporting').setLabel('Reporting').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('ticket_Appeals').setLabel('Appeals').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('ticket_Other').setLabel('Other').setStyle(ButtonStyle.Secondary)
                    );
                    await channel.send({ embeds: [pEmbed], components: [pRow] });
                    return i.reply({ content: `Ticketing panel spawned in <#${channel.id}>!`, ephemeral: true });
                }
                
                // Verify
                if (i.customId === 'action_verify_channel') { settings.verifyChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_verify_role') { settings.verifyRoleId = i.values.join(','); update = true; }
                if (i.customId === 'action_verify_spawn') {
                    if (!settings.verifyRoleId) return i.reply({ content: '⚠️ You must set the Verified Roles above first!', ephemeral: true });
                    const targetChannelId = settings.verifyChannelId || i.channel.id;
                    const channel = i.guild.channels.cache.get(targetChannelId) || i.channel;
                    
                    const pEmbed = new EmbedBuilder()
                        .setTitle('Server Verification Required')
                        .setDescription('To gain full access to the server, please verify that you are human.\n\nClick the **Verify** button below and complete the CAPTCHA.')
                        .setColor(getRoleColor(interaction))
                        .setFooter({ text: 'Nora Security Systems' });
                    const pRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_system_button').setLabel('Verify').setStyle(ButtonStyle.Success));
                    
                    await channel.send({ embeds: [pEmbed], components: [pRow] });
                    return i.reply({ content: `Verification panel spawned in <#${channel.id}>!`, ephemeral: true });
                }

                // Roblox
                if (i.customId === 'action_roblox_toggle') { settings.robloxVerifyEnabled = !settings.robloxVerifyEnabled; update = true; }
                if (i.customId === 'action_roblox_role') { settings.robloxVerifyRoleId = i.values[0]; update = true; }
                if (i.customId === 'action_roblox_channel') { settings.robloxVerifyChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_roblox_spawn') {
                    if (!settings.robloxVerifyEnabled) return i.reply({ content: '⚠️ Roblox verification must be enabled in settings first!', ephemeral: true });
                    if (!settings.robloxVerifyRoleId) return i.reply({ content: '⚠️ Roblox verified role must be set in settings first!', ephemeral: true });
                    
                    const targetChannelId = settings.robloxVerifyChannelId || i.channel.id;
                    const channel = i.guild.channels.cache.get(targetChannelId) || i.channel;

                    const pEmbed = new EmbedBuilder()
                        .setTitle('Roblox Account Verification')
                        .setDescription('Link your Roblox account to this Discord server for access, roles, and perks!\n\n**How to verify:**\n1️⃣ Use the `/verify link` command with your Roblox username\n2️⃣ Copy the verification code provided\n3️⃣ Paste it into your Roblox profile description\n4️⃣ Run `/verify check` to complete verification\n\n**Manage your accounts:**\n• `/verify list` — View all linked accounts\n• `/verify switch` — Change your active account\n• `/verify unlink` — Remove a linked account')
                        .setColor('#00b4d8')
                        .setFooter({ text: 'Roblox Verification System' });

                    const pRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Verify via Website')
                            .setStyle(ButtonStyle.Link)
                            .setURL(`https://vaztinix.dev/verify?guild=${i.guild.id}`),
                        new ButtonBuilder()
                            .setCustomId('roblox_verify_alt')
                            .setLabel('Alternative Verification')
                            .setStyle(ButtonStyle.Secondary)
                    );

                    await channel.send({ embeds: [pEmbed], components: [pRow] });
                    return i.reply({ content: `Roblox verification panel spawned in <#${channel.id}>!`, ephemeral: true });
                }

                // Self Roles
                if (i.customId === 'action_selfroles_build') {
                    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                    const modal = new ModalBuilder().setCustomId('modal_selfroles_build').setTitle('Self Roles Builder');
                    
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sr_title').setLabel('Panel Title').setStyle(TextInputStyle.Short).setRequired(true).setValue('Self Roles')),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sr_desc').setLabel('Panel Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('Click the buttons below to assign or remove roles from yourself.')),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sr_roles').setLabel('Role IDs (comma-separated, max 5)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('123456789, 987654321'))
                    );
                    await i.showModal(modal);

                    let submitted;
                    try {
                        submitted = await i.awaitModalSubmit({ time: 300000, filter: x => x.user.id === interaction.user.id && x.customId === 'modal_selfroles_build' });
                        await submitted.deferReply({ ephemeral: true }).catch(() => {});
                        
                        const title = submitted.fields.getTextInputValue('sr_title');
                        const desc = submitted.fields.getTextInputValue('sr_desc');
                        const rawRoleInput = submitted.fields.getTextInputValue('sr_roles');
                        const roleStrs = rawRoleInput.split(',').map(r => r.trim()).filter(r => r.length > 0);

                        if (roleStrs.length > 5 || roleStrs.length === 0) {
                            return await submitted.editReply({ content: '⚠️ You must provide between 1 and 5 valid numeric Role IDs (comma-separated).' }).catch(() => {});
                        }

                        const targetChannel = i.channel || interaction.channel || (i.channelId ? await i.guild.channels.fetch(i.channelId).catch(() => null) : null);
                        if (!targetChannel) {
                            return await submitted.editReply({ content: '⚠️ Could not determine the channel to spawn the self-roles panel.' }).catch(() => {});
                        }

                        const panelEmbed = new EmbedBuilder()
                            .setTitle(title)
                            .setDescription(desc)
                            .setColor(getRoleColor(interaction));

                        const row = new ActionRowBuilder();
                        let loaded = 0;
                        for (const rId of roleStrs) {
                            const cleanId = rId.replace(/[^0-9]/g, '');
                            if (!cleanId) continue;
                            const role = i.guild.roles.cache.get(cleanId) || await i.guild.roles.fetch(cleanId).catch(() => null);
                            if (role) {
                                row.addComponents(new ButtonBuilder().setCustomId(`selfrole_assign_${role.id}`).setLabel(role.name).setStyle(ButtonStyle.Secondary));
                                loaded++;
                            }
                        }

                        if (loaded === 0) {
                            return await submitted.editReply({ content: '⚠️ Could not find any of those Role IDs in this server. Make sure you provided valid numeric Role IDs.' }).catch(() => {});
                        }

                        await targetChannel.send({ embeds: [panelEmbed], components: [row] });
                        return await submitted.editReply({ content: '✅ Self-roles panel successfully spawned!' }).catch(() => {});
                    } catch (e) {
                        console.error('Self Roles Builder Modal Error:', e);
                        if (submitted) {
                            const errText = e.code === 50013 || (e.message && e.message.includes('Permissions'))
                                ? '⚠️ Nora lacks Send Messages / Embed Links permissions in this channel.'
                                : `⚠️ Could not spawn panel: ${e.message || 'Unknown error'}`;
                            if (submitted.deferred || submitted.replied) {
                                await submitted.editReply({ content: errText }).catch(() => {});
                            } else {
                                await submitted.reply({ content: errText, ephemeral: true }).catch(() => {});
                            }
                        }
                    }
                }

                // Extras
                if (i.customId === 'action_welcomer_toggle') { settings.welcomerEnabled = !settings.welcomerEnabled; update = true; }
                if (i.customId === 'action_welcome_channel') { settings.welcomeChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_counting_channel') { settings.countingChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_votelog_channel') { settings.voteLogChannelId = i.values[0]; update = true; }

                // Premium Overrides Modal Dispatch
                if (i.customId === 'premium_enable_btn' || i.customId === 'premium_disable_btn' || i.customId === 'premium_remove_btn') {
                    if (!APP_OWNER_IDS.includes(i.user.id)) return i.reply({ content: '❌ This action is strictly restricted to Bot Owners.', ephemeral: true });

                    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                    
                    const action = i.customId.replace('_btn', ''); // premium_enable, premium_disable, premium_remove
                    const actionLabel = i.customId.includes('enable') ? 'ENABLE' : i.customId.includes('disable') ? 'DISABLE' : 'REMOVE';
                    
                    const modal = new ModalBuilder()
                        .setCustomId(`modal_premium_${action}`)
                        .setTitle(`${actionLabel} PREMIUM`);

                    const userInput = new TextInputBuilder()
                        .setCustomId('user_id')
                        .setLabel('Target Discord User ID')
                        .setPlaceholder('Enter User ID (Optional)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false);

                    const guildInput = new TextInputBuilder()
                        .setCustomId('guild_id')
                        .setLabel('Target Discord Guild ID')
                        .setPlaceholder('Enter Guild ID (Optional)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(userInput),
                        new ActionRowBuilder().addComponents(guildInput)
                    );

                    await i.showModal(modal);
                    return;
                }

                // Dev Handlers
                if (i.customId === 'dev_reboot') {
                    if (!APP_OWNER_IDS.includes(i.user.id)) return i.reply({ content: 'Unauthorized.', ephemeral: true });
                    await i.update({ content: 'Rebooting application core...', embeds: [], components: [] });
                    process.exit(1); 
                }
                if (i.customId === 'dev_dbsync') {
                    if (!APP_OWNER_IDS.includes(i.user.id)) return i.reply({ content: 'Unauthorized.', ephemeral: true });
                    const sequelize = require('../../database/db');
                    await sequelize.sync({ alter: true }).catch(()=>{});
                    return i.reply({ content: 'Database correctly synchronized.', ephemeral: true });
                }

                if (update) {
                    await settings.save();
                    settingsCache.invalidate(interaction.guild.id); // STAGE 3: Force settings cache reload

                    if (sync) {
                        if (sync === 'all') {
                            await syncAllAutoModRules(i.guild, settings);
                        } else {
                            let isRuleEnabled = true;
                            if (sync === 'profanity') isRuleEnabled = settings.automodProfanity;
                            if (sync === 'scam') isRuleEnabled = settings.automodScam;
                            if (sync === 'spam') isRuleEnabled = settings.automodSpam;
                            if (sync === 'hardcore') isRuleEnabled = settings.automodHardcore;
                            if (sync === 'mentions') isRuleEnabled = settings.automodMentions > 0;
                            await syncAutoModRule(i.guild, sync, isRuleEnabled, settings.automodMentions, settings);
                        }
                    }
                    return i.update(buildDashboard(state.currentView));
                }

            } catch (err) {
                console.error(err);
                if (!i.replied && !i.deferred) i.reply({ content: 'Save failed.', ephemeral: true }).catch(()=>{});
            }
        });
    },
};
