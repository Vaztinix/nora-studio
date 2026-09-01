const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ChannelSelectMenuBuilder, 
    RoleSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType 
} = require('discord.js');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleError, handleSuccess } = require('../../utils/embeds');
const { syncAutoModRule, syncAllAutoModRules } = require('../../utils/automodSync');
const settingsCache = require('../../utils/settingsCache');

module.exports = {
    category: 'setup',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Interactive server management and settings dashboard.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('dashboard')
                .setDescription('Open the full interactive settings dashboard.'))
        .addSubcommand(sub =>
            sub.setName('automod')
                .setDescription('Configure Discord native AutoMod rules and chat safety.'))
        .addSubcommand(sub =>
            sub.setName('welcomer')
                .setDescription('Configure welcome cards, join messages, and auto-roles.'))
        .addSubcommand(sub =>
            sub.setName('leveling')
                .setDescription('Configure chat/voice leveling, XP multipliers, and rank rewards.'))
        .addSubcommand(sub =>
            sub.setName('logging')
                .setDescription('Configure server audit logs and multi-channel routing.'))
        .addSubcommand(sub =>
            sub.setName('games')
                .setDescription('Configure community games (Counting, One Word Story, RPS, Guess).'))
        .addSubcommand(sub =>
            sub.setName('afk')
                .setDescription('Configure server AFK settings and auto-nicknames.'))
        .addSubcommand(sub =>
            sub.setName('ticket')
                .setDescription('Configure support ticket settings and spawn panels.'))
        .addSubcommand(sub =>
            sub.setName('verify')
                .setDescription('Configure server verification types (Click, CAPTCHA, React, Roblox).'))
        .addSubcommand(sub =>
            sub.setName('roblox')
                .setDescription('Configure Roblox verification and panel.'))
        .addSubcommand(sub =>
            sub.setName('starboard')
                .setDescription('Configure Starboard reaction threshold and channel.'))
        .addSubcommand(sub =>
            sub.setName('onewordstory')
                .setDescription('Configure One Word Story collaborative game.'))
        .addSubcommand(sub =>
            sub.setName('counting')
                .setDescription('Configure sequential Counting game.')),

    async execute(interaction) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});
        }
        const subcommand = interaction.options.getSubcommand();
        const settings = await settingsCache.get(interaction.guild.id);

        const routeMap = {
            dashboard: 'main',
            automod: 'view_automod',
            welcomer: 'view_welcomer',
            leveling: 'view_leveling',
            logging: 'view_logging',
            games: 'view_games',
            afk: 'view_afk',
            ticket: 'view_tickets',
            verify: 'view_verify',
            roblox: 'view_verify',
            starboard: 'view_starboard',
            onewordstory: 'view_onewordstory',
            counting: 'view_counting'
        };

        const targetView = routeMap[subcommand] || 'main';
        try {
            return await this.runDashboard(interaction, settings, targetView);
        } catch (err) {
            console.error(`Error executing /setup ${subcommand}:`, err);
            return await handleError(interaction, 'Execution Error', 'An error occurred while launching the settings dashboard.');
        }
    },

    async runDashboard(interaction, settings, initialViewName = 'main') {
        const APP_OWNER_IDS = [process.env.APP_OWNER_ID || '1214048435632603137', '1366229304257544213'];

        const Autoresponder = require('../../database/models/Autoresponder');
        const ContentFeed = require('../../database/models/ContentFeed');
        const autoresponderCount = await Autoresponder.count({ where: { guildId: interaction.guild.id } }).catch(() => 0);
        const youtubeFeedCount = await ContentFeed.count({ where: { guildId: interaction.guild.id, platform: 'YOUTUBE' } }).catch(() => 0);

        let state = {
            currentView: initialViewName || 'main',
            selectedLogCategory: settings.selectedLogCategory || 'default',
            autoresponderCount,
            youtubeFeedCount
        };

        const getRoleColor = (interaction) => {
            if (!interaction.guild) return 0x7c3aed;
            const color = interaction.guild.members.me?.roles?.highest?.color;
            return (!color || color === 0) ? 0x7c3aed : color;
        };

        const buildDashboard = (viewName) => {
            const embed = new EmbedBuilder()
                .setColor(getRoleColor(interaction))
                .setTimestamp()
                .setFooter({ text: `Nora Dashboard • ${interaction.guild.name}` });

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('go_back').setLabel('◀️ Main Menu').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setLabel('🌐 Web Dashboard').setStyle(ButtonStyle.Link).setURL(`https://vaztinix.dev/dashboard?guild=${interaction.guild.id}`)
            );

            // ==========================================
            // 🏠 MAIN HUB
            // ==========================================
            if (viewName === 'main') {
                const autoModCount = [
                    settings.automodProfanity, settings.automodSexual, settings.automodSlurs,
                    settings.automodScam, settings.automodSpam, settings.automodHardcore,
                    settings.automodMentions > 0
                ].filter(Boolean).length;

                embed.setTitle('⚙️ Nora Server Management Dashboard')
                    .setDescription(
                        `Welcome to the **${interaction.guild.name}** settings center!\n` +
                        `Select a category from the menu below to configure features in real-time.`
                    )
                    .addFields(
                        { 
                            name: '🛡️ Safety & AutoMod', 
                            value: `Anti-Raid: **${settings.antiRaidEnabled ? '🟢 On' : '🔴 Off'}**\nAutoMod: **${autoModCount}/7 Rules Active**\nLockdown: **${settings.lockdownMode ? '🔒 Active' : '🔓 Normal'}**`, 
                            inline: true 
                        },
                        { 
                            name: '👋 Welcomer & Verify', 
                            value: `Welcomer: **${settings.welcomerEnabled ? '🟢 On' : '🔴 Off'}**\nAuto-Role: ${settings.welcomeRoleId ? `<@&${settings.welcomeRoleId}>` : '*None*'}\nVerification: **${settings.verifyRoleId ? '🟢 On' : '🔴 Off'}**`, 
                            inline: true 
                        },
                        { 
                            name: '🏆 Leveling & XP', 
                            value: `Chat XP: **${settings.levelingEnabled ? '🟢 On' : '🔴 Off'}**\nLevel Alerts: **${settings.levelUpNotificationsEnabled !== false ? '🟢 On' : '🔴 Off'}**\nAlert Ch: ${settings.levelUpChannelId ? `<#${settings.levelUpChannelId}>` : '*Current*'}`, 
                            inline: true 
                        },
                        { 
                            name: '📋 Audit Logging', 
                            value: `Default Log: ${settings.loggingChannelId ? `<#${settings.loggingChannelId}>` : '*None*'}\nRouted Chans: **${typeof settings.loggingChannels === 'object' ? Object.keys(settings.loggingChannels || {}).length : 0} active**`, 
                            inline: true 
                        },
                        { 
                            name: '🎮 Games & AFK', 
                            value: `AFK System: **${settings.afkEnabled !== false ? '🟢 On' : '🔴 Off'}**\nCounting: ${settings.countingChannelId ? `<#${settings.countingChannelId}>` : '*Disabled*'}\nStarboard: **${settings.starboardEnabled ? '🟢 On' : '🔴 Off'}**`, 
                            inline: true 
                        },
                        { 
                            name: '🎫 Support & Utility', 
                            value: `Tickets: ${settings.ticketCategoryId ? '🟢 Configured' : '🔴 Unset'}\nAutoresponders: **${state.autoresponderCount} rules**\nYouTube Feeds: **${state.youtubeFeedCount} active**`, 
                            inline: true 
                        }
                    );

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('config_main')
                    .setPlaceholder('🚀 Select a category to configure...')
                    .addOptions([
                        { label: 'Safety & Anti-Raid', value: 'view_safety', description: 'Anti-raid, account age gate, photo check, lockdowns', emoji: '🛡️' },
                        { label: 'Discord AutoMod Rules', value: 'view_automod', description: 'Zero-latency native filters for profanity, spam, and scam links', emoji: '🤖' },
                        { label: 'Welcomer & Auto-Roles', value: 'view_welcomer', description: 'Custom welcome cards, join messages, and starter roles', emoji: '👋' },
                        { label: 'Leveling & Experience', value: 'view_leveling', description: 'Chat & Voice XP, level-up notifications, and multipliers', emoji: '🏆' },
                        { label: 'Server Logs & Routing', value: 'view_logging', description: 'Multi-channel audit logs for members, messages, and voice', emoji: '📋' },
                        { label: 'Community Games & AFK', value: 'view_games', description: 'AFK module, Counting, One Word Story, and Starboard', emoji: '🎮' },
                        { label: 'Join & Roblox Verification', value: 'view_verify', description: 'Human CAPTCHA gate and Roblox account linking', emoji: '✅' },
                        { label: 'Support Ticket System', value: 'view_tickets', description: 'Private staff ticket categories, panels, and transcripts', emoji: '🎫' },
                        { label: 'Self Roles & AI Engine', value: 'view_utility', description: 'Interactive button role panels and AI personality', emoji: '🎭' }
                    ]);

                if (APP_OWNER_IDS.includes(interaction.user.id)) {
                    menu.addOptions([
                        { label: 'Dev & Premium Overrides', value: 'view_dev', description: 'Bot owner tools, database sync, and premium grants', emoji: '👑' }
                    ]);
                }

                const quickActions = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_quick_refresh').setLabel('🔄 Refresh Status').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setLabel('🌐 Open Web Dashboard').setStyle(ButtonStyle.Link).setURL(`https://vaztinix.dev/dashboard?guild=${interaction.guild.id}`)
                );

                return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), quickActions] };
            }

            // ==========================================
            // 🛡️ SAFETY & ANTI-RAID
            // ==========================================
            if (viewName === 'view_safety') {
                embed.setTitle('🛡️ Safety & Anti-Raid Settings')
                    .setDescription('Configure protection against raids, malicious alt accounts, and mass bot joins.')
                    .addFields(
                        { name: 'Anti-Raid Engine', value: settings.antiRaidEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: 'Server Lockdown', value: settings.lockdownMode ? '🔒 Active (Channels Locked)' : '🔓 Normal', inline: true },
                        { name: 'Require Profile Picture', value: settings.requirePFP ? '🟢 Required (No Defaults)' : '🔴 Optional', inline: true },
                        { name: 'Min Account Age', value: settings.minAccountAge > 0 ? `🟢 ${settings.minAccountAge} Day(s)` : '🔴 Disabled', inline: true },
                        { name: 'Nickname Raid Filter', value: settings.nicknameRaidFilter ? '🟢 Active' : '🔴 Disabled', inline: true },
                        { name: 'Raid Detection Action', value: `⚡ \`${settings.antiRaidAction || 'notify'}\``, inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_antiraid_toggle').setLabel(settings.antiRaidEnabled ? 'Disable Anti-Raid' : 'Enable Anti-Raid').setStyle(settings.antiRaidEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_lockdown_toggle').setLabel(settings.lockdownMode ? 'Unlock Server' : 'Lockdown Server').setStyle(settings.lockdownMode ? ButtonStyle.Success : ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('action_pfp_toggle').setLabel('Toggle PFP Check').setStyle(settings.requirePFP ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_nickfilter_toggle').setLabel('Toggle Nick Filter').setStyle(settings.nicknameRaidFilter ? ButtonStyle.Success : ButtonStyle.Secondary)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_accountage_minage').setPlaceholder('Set Minimum Account Age...').addOptions([
                        { label: 'Disabled (Allow all)', value: '0', default: settings.minAccountAge === 0 },
                        { label: '1 Day Old', value: '1', default: settings.minAccountAge === 1 },
                        { label: '3 Days Old', value: '3', default: settings.minAccountAge === 3 },
                        { label: '7 Days Old', value: '7', default: settings.minAccountAge === 7 },
                        { label: '14 Days Old', value: '14', default: settings.minAccountAge === 14 },
                        { label: '30 Days Old', value: '30', default: settings.minAccountAge === 30 }
                    ])
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_antiraid_action').setPlaceholder('Action on Raid Detection...').addOptions([
                        { label: 'Notify Staff Only', value: 'notify', default: settings.antiRaidAction === 'notify' },
                        { label: 'Trigger Auto-Lockdown', value: 'lockdown', default: settings.antiRaidAction === 'lockdown' },
                        { label: 'Kick Suspicious New Joiners', value: 'kick_new', default: settings.antiRaidAction === 'kick_new' }
                    ])
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // ==========================================
            // 🤖 DISCORD AUTOMOD RULES
            // ==========================================
            if (viewName === 'view_automod') {
                const on = (v) => v ? '🟢 Blocked' : '🔴 Allowed';
                embed.setTitle('🤖 Discord Native AutoMod Rules')
                    .setDescription('Enforced directly by **Discord\'s native AutoMod engine** for instant, zero-latency protection.')
                    .addFields(
                        { name: '🔤 Profanity Filter', value: on(settings.automodProfanity), inline: true },
                        { name: '🔞 Sexual Content', value: on(settings.automodSexual), inline: true },
                        { name: '🚫 Slurs & Hate Speech', value: on(settings.automodSlurs), inline: true },
                        { name: '🔗 Scam / Phishing Links', value: on(settings.automodScam), inline: true },
                        { name: '💬 Text Message Spam', value: on(settings.automodSpam), inline: true },
                        { name: '🔞 Hardcore Media Filter', value: on(settings.automodHardcore), inline: true },
                        { name: '📢 Mention Spam Limit', value: settings.automodMentions > 0 ? `🟢 Max ${settings.automodMentions}` : '🔴 Off', inline: true },
                        { name: '🛡️ Immune Roles', value: (() => { try { const r = JSON.parse(settings.automodImmuneRoles || '[]'); return r.length ? r.map(id => `<@&${id}>`).join(', ') : '*None*'; } catch { return '*None*'; } })(), inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_automod_profanity').setLabel('Profanity').setStyle(settings.automodProfanity ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_sexual').setLabel('Sexual Content').setStyle(settings.automodSexual ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_slurs').setLabel('Slurs').setStyle(settings.automodSlurs ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_scam').setLabel('Scam Links').setStyle(settings.automodScam ? ButtonStyle.Success : ButtonStyle.Secondary)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_automod_spam').setLabel('Text Spam').setStyle(settings.automodSpam ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_hardcore').setLabel('Hardcore Media').setStyle(settings.automodHardcore ? ButtonStyle.Success : ButtonStyle.Secondary)
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_automod_mentions').setPlaceholder('Mention Spam Limit...').addOptions([
                        { label: 'Off (No limit)', value: '0', default: settings.automodMentions === 0 },
                        { label: '3 Mentions max', value: '3', default: settings.automodMentions === 3 },
                        { label: '5 Mentions max', value: '5', default: settings.automodMentions === 5 },
                        { label: '10 Mentions max', value: '10', default: settings.automodMentions === 10 },
                        { label: '15 Mentions max', value: '15', default: settings.automodMentions === 15 }
                    ])
                );

                const rowD = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_automod_immune').setPlaceholder('Select AutoMod Immune / Bypass Roles...').setMinValues(0).setMaxValues(10)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            // ==========================================
            // 👋 WELCOMER & AUTO-ROLES
            // ==========================================
            if (viewName === 'view_welcomer') {
                embed.setTitle('👋 Welcomer & Starter Roles')
                    .setDescription('Configure automated welcome cards, join channels, and starter roles for new members.')
                    .addFields(
                        { name: 'Welcomer System', value: settings.welcomerEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: 'Welcome Channel', value: settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : '*None*', inline: true },
                        { name: 'Starter Auto-Role', value: settings.welcomeRoleId ? `<@&${settings.welcomeRoleId}>` : '*None*', inline: true },
                        { name: 'Join DM Alerts', value: settings.welcomeDmEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: 'Welcome Card Images', value: settings.levelingUseImages !== false ? '🟢 Image Card' : '📄 Text Only', inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_welcomer_toggle').setLabel(settings.welcomerEnabled ? 'Disable Welcomer' : 'Enable Welcomer').setStyle(settings.welcomerEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_welcomedm_toggle').setLabel(settings.welcomeDmEnabled ? 'Disable Join DM' : 'Enable Join DM').setStyle(settings.welcomeDmEnabled ? ButtonStyle.Danger : ButtonStyle.Secondary)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_welcome_channel').setPlaceholder('Select Welcome Channel...').setChannelTypes(ChannelType.GuildText)
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_welcome_role').setPlaceholder('Select Starter Auto-Role...')
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // ==========================================
            // 🏆 LEVELING & EXPERIENCE
            // ==========================================
            if (viewName === 'view_leveling') {
                embed.setTitle('🏆 Leveling & XP Rewards')
                    .setDescription('Reward active community members with Chat XP, Voice XP, custom rank cards, and level roles.')
                    .addFields(
                        { name: 'Chat Leveling', value: settings.levelingEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: 'Level-Up Alerts', value: settings.levelUpNotificationsEnabled !== false ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: 'Level-Up Channel', value: settings.levelUpChannelId ? `<#${settings.levelUpChannelId}>` : '*Current Channel*', inline: true },
                        { name: 'Direct Message Alerts', value: settings.levelUpDmEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: 'Rank Card Avatars', value: settings.levelingPfpEnabled !== false ? '🟢 Shown' : '🔴 Hidden', inline: true },
                        { name: 'Voice XP Rate', value: `🎙️ ${settings.voiceXpRate || 10} XP / ${settings.voiceXpInterval || 300}s`, inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_leveling_toggle').setLabel(settings.levelingEnabled ? 'Disable Leveling' : 'Enable Leveling').setStyle(settings.levelingEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_levelalert_toggle').setLabel(settings.levelUpNotificationsEnabled !== false ? 'Disable Alerts' : 'Enable Alerts').setStyle(settings.levelUpNotificationsEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_leveldm_toggle').setLabel(settings.levelUpDmEnabled ? 'Disable DM Alerts' : 'Enable DM Alerts').setStyle(settings.levelUpDmEnabled ? ButtonStyle.Danger : ButtonStyle.Secondary)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_levelalert_channel').setPlaceholder('Select Dedicated Level-Up Channel...').setChannelTypes(ChannelType.GuildText)
                );

                return { embeds: [embed], components: [rowA, rowB, backRow] };
            }

            // ==========================================
            // 📋 SERVER LOGGING & ROUTING
            // ==========================================
            if (viewName === 'view_logging') {
                let logChannels = {};
                if (typeof settings.loggingChannels === 'object' && settings.loggingChannels !== null) {
                    logChannels = settings.loggingChannels;
                } else if (typeof settings.loggingChannels === 'string') {
                    try { logChannels = JSON.parse(settings.loggingChannels); } catch(e) { logChannels = {}; }
                }

                const activeSection = state.selectedLogCategory || 'default';
                const categoryLabels = {
                    default: '⚙️ Default Fallback Log Channel',
                    messages: '💬 Message Logs (Edits & Deletes)',
                    members: '👥 Member Logs (Joins, Leaves & Boosts)',
                    channels: '📁 Channel Logs (Creates, Edits & Deletes)',
                    voice: '🎙️ Voice Logs (Joins, Leaves & Moves)',
                    automod: '🛡️ AutoMod & Security Logs'
                };

                embed.setTitle('📋 Audit Logging & Channel Routing')
                    .setDescription(
                        `**Configuring Category:** ${categoryLabels[activeSection] || 'Default Fallback'}\n` +
                        `Select a category from the dropdown below, then choose the destination channel.`
                    )
                    .addFields(
                        { name: '⚙️ Default Fallback', value: settings.loggingChannelId ? `<#${settings.loggingChannelId}>` : '*None*', inline: true },
                        { name: '💬 Messages Log', value: logChannels.messages ? `<#${logChannels.messages}>` : `*(Fallback)*`, inline: true },
                        { name: '👥 Members Log', value: logChannels.members ? `<#${logChannels.members}>` : `*(Fallback)*`, inline: true },
                        { name: '📁 Channels Log', value: logChannels.channels ? `<#${logChannels.channels}>` : `*(Fallback)*`, inline: true },
                        { name: '🎙️ Voice Log', value: logChannels.voice ? `<#${logChannels.voice}>` : `*(Fallback)*`, inline: true },
                        { name: '🛡️ AutoMod Log', value: logChannels.automod ? `<#${logChannels.automod}>` : `*(Fallback)*`, inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_log_part_select').setPlaceholder('Choose Log Category to Assign...').addOptions([
                        { label: 'Default Fallback Channel', value: 'default', description: 'Catch-all channel for all unassigned log types', default: activeSection === 'default' },
                        { label: 'Message Logs', value: 'messages', description: 'Edits, deletes, and bulk deletions', default: activeSection === 'messages' },
                        { label: 'Member Logs', value: 'members', description: 'Joins, leaves, kicks, and boosts', default: activeSection === 'members' },
                        { label: 'Channel Logs', value: 'channels', description: 'Channel creates, updates, and deletes', default: activeSection === 'channels' },
                        { label: 'Voice Logs', value: 'voice', description: 'Voice joins, leaves, and moves', default: activeSection === 'voice' },
                        { label: 'AutoMod Logs', value: 'automod', description: 'Blocked content, spam filters, and raids', default: activeSection === 'automod' }
                    ])
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_log_channel').setPlaceholder(`Set channel for ${categoryLabels[activeSection]}...`).setChannelTypes(ChannelType.GuildText)
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('action_log_toggle')
                        .setPlaceholder('Toggle Monitored Events (Select Multiple)...')
                        .setMinValues(0)
                        .setMaxValues(8)
                        .addOptions([
                            { label: 'Member Joins', value: 'logMemberJoins', description: 'Log when users join the server', default: !!settings.logMemberJoins },
                            { label: 'Member Leaves', value: 'logMemberLeaves', description: 'Log when users leave the server', default: !!settings.logMemberLeaves },
                            { label: 'Message Edits', value: 'logMessageEdits', description: 'Log edited message content', default: !!settings.logMessageEdits },
                            { label: 'Message Deletes', value: 'logMessageDeletes', description: 'Log deleted messages', default: !!settings.logMessageDeletes },
                            { label: 'AutoMod Violations', value: 'logAutomod', description: 'Log caught AutoMod actions', default: !!settings.logAutomod },
                            { label: 'Channel Updates', value: 'logChannelEdits', description: 'Log channel creation & changes', default: !!settings.logChannelEdits },
                            { label: 'Voice Activity', value: 'logVoiceJoins', description: 'Log VC joins, leaves, and moves', default: !!settings.logVoiceJoins },
                            { label: 'Server Boosts', value: 'logMemberBoosts', description: 'Log when members boost the server', default: !!settings.logMemberBoosts }
                        ])
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // ==========================================
            // 🎮 COMMUNITY GAMES, STARBOARD & AFK
            // ==========================================
            if (viewName === 'view_games') {
                embed.setTitle('🎮 Community Games, Starboard & AFK')
                    .setDescription('Configure interactive server games and community features.')
                    .addFields(
                        { name: '💤 AFK System', value: settings.afkEnabled !== false ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: '🔢 Counting Game', value: settings.countingChannelId ? `<#${settings.countingChannelId}>` : '🔴 Disabled', inline: true },
                        { name: '📖 One Word Story', value: settings.oneWordStoryEnabled !== false ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: '⭐ Starboard', value: settings.starboardEnabled ? `<#${settings.starboardChannelId || 'Unset'}>` : '🔴 Disabled', inline: true },
                        { name: '🎲 Number Guessing', value: settings.guessGameEnabled !== false ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: '✂️ Rock Paper Scissors', value: settings.rpsGameEnabled !== false ? '🟢 Enabled' : '🔴 Disabled', inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_afk_toggle').setLabel(settings.afkEnabled !== false ? 'Disable AFK' : 'Enable AFK').setStyle(settings.afkEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_onewordstory_toggle').setLabel(settings.oneWordStoryEnabled !== false ? 'Disable Story' : 'Enable Story').setStyle(settings.oneWordStoryEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_starboard_toggle').setLabel(settings.starboardEnabled ? 'Disable Starboard' : 'Enable Starboard').setStyle(settings.starboardEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_counting_channel').setPlaceholder('Select / Change Counting Channel...').setChannelTypes(ChannelType.GuildText)
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_starboard_channel').setPlaceholder('Select Starboard Channel...').setChannelTypes(ChannelType.GuildText)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // ==========================================
            // ✅ MULTI-MODE MEMBER VERIFICATION
            // ==========================================
            if (viewName === 'view_verify') {
                const currentType = settings.verificationType || 'captcha';
                const typeLabels = {
                    button: '🔘 Click to Verify (1-Click Button)',
                    captcha: '🔒 CAPTCHA Verification (Anti-Bot Code)',
                    reaction: `⭐ React Verification (${settings.verifyEmoji || '✅'})`,
                    roblox: '🎮 Roblox Account Verification'
                };

                embed.setTitle('✅ Multi-Mode Member Verification')
                    .setDescription(
                        `Configure server entry verification. Nora supports **4 different verification types**:\n` +
                        `• **🔘 Click to Verify:** Simple 1-click button for instant access.\n` +
                        `• **🔒 CAPTCHA:** Distorted image security code to block raids and userbots.\n` +
                        `• **⭐ React:** Reaction emoji on a welcome/rules message.\n` +
                        `• **🎮 Roblox:** Verifies and links Roblox accounts for role sync.`
                    )
                    .addFields(
                        { name: 'Active Verification Type', value: `**${typeLabels[currentType] || '🔒 CAPTCHA'}**`, inline: true },
                        { name: 'Verification Channel', value: settings.verifyChannelId ? `<#${settings.verifyChannelId}>` : '*None (Will use current)*', inline: true },
                        { name: 'Verified Role(s)', value: settings.verifyRoleId ? settings.verifyRoleId.split(',').map(id => `<@&${id}>`).join(' ') : '*None (Required)*', inline: true },
                        { name: 'Reaction Emoji', value: `${settings.verifyEmoji || '✅'} *(React mode)*`, inline: true },
                        { name: 'Roblox Module', value: settings.robloxVerifyEnabled ? '🟢 Active' : '🔴 Off', inline: true },
                        { name: 'Active Panel Message', value: settings.verifyMessageId ? `\`${settings.verifyMessageId}\`` : '*Not spawned yet*', inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('action_verify_type')
                        .setPlaceholder('Choose Active Verification Type...')
                        .addOptions([
                            { label: 'Click to Verify (1-Click Button)', value: 'button', description: 'Immediate 1-click instant verification button', emoji: '🔘', default: currentType === 'button' },
                            { label: 'CAPTCHA Verification (Anti-Bot)', value: 'captcha', description: 'Visual distorted image security code test', emoji: '🔒', default: currentType === 'captcha' },
                            { label: 'React Verification (Emoji)', value: 'reaction', description: 'React with an emoji to gain access', emoji: '⭐', default: currentType === 'reaction' },
                            { label: 'Roblox Account Verification', value: 'roblox', description: 'Link Roblox profile to Discord server', emoji: '🎮', default: currentType === 'roblox' }
                        ])
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_verify_spawn_button').setLabel('Spawn 1-Click Panel').setStyle(ButtonStyle.Success).setEmoji('🔘'),
                    new ButtonBuilder().setCustomId('action_verify_spawn_captcha').setLabel('Spawn CAPTCHA Panel').setStyle(ButtonStyle.Primary).setEmoji('🔒'),
                    new ButtonBuilder().setCustomId('action_verify_spawn_reaction').setLabel('Spawn React Panel').setStyle(ButtonStyle.Secondary).setEmoji('⭐'),
                    new ButtonBuilder().setCustomId('action_verify_spawn_roblox').setLabel('Spawn Roblox Panel').setStyle(ButtonStyle.Secondary).setEmoji('🎮')
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_verify_channel').setPlaceholder('Select Destination Verification Channel...').setChannelTypes(ChannelType.GuildText)
                );

                const rowD = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_verify_role').setPlaceholder('Select Role(s) Granted Upon Verification...').setMinValues(1).setMaxValues(5)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            // ==========================================
            // 🎫 SUPPORT TICKETS
            // ==========================================
            if (viewName === 'view_tickets') {
                embed.setTitle('🎫 Support Ticket System')
                    .setDescription('Configure private support tickets with customizable panel titles, descriptions, and staff roles.')
                    .addFields(
                        { name: 'Parent Category', value: settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : '🔴 Unset', inline: true },
                        { name: 'Panel Channel', value: settings.ticketChannelId ? `<#${settings.ticketChannelId}>` : '🔴 Unset', inline: true },
                        { name: 'Support Staff Role', value: settings.ticketSupportRoleId ? `<@&${settings.ticketSupportRoleId}>` : '🔴 Unset', inline: true },
                        { name: 'Auto-Archive', value: settings.ticketAutoArchive ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                        { name: 'Tickets Created', value: `#${settings.ticketLastNumber || 0}`, inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_ticket_spawn').setLabel('Spawn Ticket Panel').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_ticket_customize_panel').setLabel('Edit Panel Text').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('action_ticket_autoarchive_toggle').setLabel(settings.ticketAutoArchive ? 'Disable Auto-Archive' : 'Enable Auto-Archive').setStyle(settings.ticketAutoArchive ? ButtonStyle.Danger : ButtonStyle.Secondary)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_ticket_category').setPlaceholder('Select Parent Ticket Category...').setChannelTypes(ChannelType.GuildCategory)
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_ticket_support_role').setPlaceholder('Select Support Staff Role...')
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // ==========================================
            // 🎭 SELF ROLES, AUTORESPONDERS & AI
            // ==========================================
            if (viewName === 'view_utility') {
                embed.setTitle('🎭 Self Roles, Autoresponders & AI')
                    .setDescription('Configure interactive role panels, keyword auto-replies, and AI persona.')
                    .addFields(
                        { name: 'Autoresponder Triggers', value: `🤖 **${state.autoresponderCount} rule(s) configured**`, inline: true },
                        { name: 'YouTube Alerts', value: `📺 **${state.youtubeFeedCount} channel(s) tracked**`, inline: true },
                        { name: 'AI Engine Preference', value: `🧠 \`${settings.aiPreference || 'gemini'}\``, inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_selfroles_build').setLabel('Build Self-Roles Panel').setStyle(ButtonStyle.Success)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_ai_pref').setPlaceholder('Change Nora AI Engine Preference...').addOptions([
                        { label: 'Google Gemini 2.5 Flash (Default, Ultra-Fast)', value: 'gemini', default: settings.aiPreference === 'gemini' },
                        { label: 'OpenAI GPT-4o Mini', value: 'openai', default: settings.aiPreference === 'openai' },
                        { label: 'Anthropic Claude 3.5 Haiku', value: 'claude', default: settings.aiPreference === 'claude' }
                    ])
                );

                return { embeds: [embed], components: [rowA, rowB, backRow] };
            }

            // ==========================================
            // 👑 DEV & PREMIUM OVERRIDES (Bot Owner)
            // ==========================================
            if (viewName === 'view_dev' && APP_OWNER_IDS.includes(interaction.user.id)) {
                embed.setTitle('👑 Nora Developer & Host Controls')
                    .setDescription('Direct system controls for bot maintainers.')
                    .addFields(
                        { name: 'Bot Process', value: `PID: \`${process.pid}\``, inline: true },
                        { name: 'Guilds Cached', value: `\`${interaction.client.guilds.cache.size}\``, inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('dev_reboot').setLabel('Reboot Nora Core').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('dev_dbsync').setLabel('Force DB Sync (Alter)').setStyle(ButtonStyle.Primary)
                );

                return { embeds: [embed], components: [rowA, backRow] };
            }

            // Fallback
            return buildDashboard('main');
        };

        const initialView = buildDashboard(initialViewName);
        let response;
        if (interaction.deferred || interaction.replied) {
            response = await interaction.editReply({ ...initialView, ephemeral: true });
        } else {
            response = await interaction.reply({ ...initialView, ephemeral: true });
        }

        const targetMessage = response || await interaction.fetchReply?.().catch(() => null);
        if (!targetMessage || typeof targetMessage.createMessageComponentCollector !== 'function') {
            return;
        }

        const collector = targetMessage.createMessageComponentCollector({ time: 600000 });

        collector.on('collect', async i => {
            try {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ content: '⚠️ This settings dashboard is controlled by another user.', ephemeral: true });
                }

                // Refresh counts dynamically
                state.autoresponderCount = await Autoresponder.count({ where: { guildId: interaction.guild.id } }).catch(() => 0);
                state.youtubeFeedCount = await ContentFeed.count({ where: { guildId: interaction.guild.id, platform: 'YOUTUBE' } }).catch(() => 0);

                if (i.customId === 'action_quick_refresh') {
                    return i.update(buildDashboard('main'));
                }

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

                // Safety / Anti-Raid
                if (i.customId === 'action_antiraid_toggle') { settings.antiRaidEnabled = !settings.antiRaidEnabled; update = true; }
                if (i.customId === 'action_lockdown_toggle') { settings.lockdownMode = !settings.lockdownMode; update = true; }
                if (i.customId === 'action_pfp_toggle') { settings.requirePFP = !settings.requirePFP; update = true; }
                if (i.customId === 'action_nickfilter_toggle') { settings.nicknameRaidFilter = !settings.nicknameRaidFilter; update = true; }
                if (i.customId === 'action_accountage_minage') { settings.minAccountAge = parseInt(i.values[0]); update = true; }
                if (i.customId === 'action_antiraid_action') { settings.antiRaidAction = i.values[0]; update = true; }

                // AutoMod
                if (i.customId === 'action_automod_profanity') { settings.automodProfanity = !settings.automodProfanity; update = true; sync = 'profanity'; }
                if (i.customId === 'action_automod_sexual') { settings.automodSexual = !settings.automodSexual; update = true; sync = 'profanity'; }
                if (i.customId === 'action_automod_slurs') { settings.automodSlurs = !settings.automodSlurs; update = true; sync = 'profanity'; }
                if (i.customId === 'action_automod_scam') { settings.automodScam = !settings.automodScam; update = true; sync = 'scam'; }
                if (i.customId === 'action_automod_spam') { settings.automodSpam = !settings.automodSpam; update = true; sync = 'spam'; }
                if (i.customId === 'action_automod_hardcore') { settings.automodHardcore = !settings.automodHardcore; update = true; sync = 'hardcore'; }
                if (i.customId === 'action_automod_mentions') { settings.automodMentions = parseInt(i.values[0]); update = true; sync = 'mentions'; }
                if (i.customId === 'action_automod_immune') { settings.automodImmuneRoles = JSON.stringify(i.values); update = true; sync = 'all'; }

                // Welcomer
                if (i.customId === 'action_welcomer_toggle') { settings.welcomerEnabled = !settings.welcomerEnabled; update = true; }
                if (i.customId === 'action_welcomedm_toggle') { settings.welcomeDmEnabled = !settings.welcomeDmEnabled; update = true; }
                if (i.customId === 'action_welcome_channel') { settings.welcomeChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_welcome_role') { settings.welcomeRoleId = i.values[0]; update = true; }

                // Leveling
                if (i.customId === 'action_leveling_toggle') { settings.levelingEnabled = !settings.levelingEnabled; update = true; }
                if (i.customId === 'action_levelalert_toggle') { settings.levelUpNotificationsEnabled = !settings.levelUpNotificationsEnabled; update = true; }
                if (i.customId === 'action_leveldm_toggle') { settings.levelUpDmEnabled = !settings.levelUpDmEnabled; update = true; }
                if (i.customId === 'action_levelalert_channel') { settings.levelUpChannelId = i.values[0]; update = true; }

                // Games & AFK
                if (i.customId === 'action_afk_toggle') { settings.afkEnabled = settings.afkEnabled !== false ? false : true; update = true; }
                if (i.customId === 'action_onewordstory_toggle') { settings.oneWordStoryEnabled = !settings.oneWordStoryEnabled; update = true; }
                if (i.customId === 'action_starboard_toggle') { settings.starboardEnabled = !settings.starboardEnabled; update = true; }
                if (i.customId === 'action_counting_channel') { settings.countingChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_starboard_channel') { settings.starboardChannelId = i.values[0]; update = true; }

                // Logging & Section Routing
                if (i.customId === 'action_log_part_select') {
                    state.selectedLogCategory = i.values[0];
                    settings.selectedLogCategory = i.values[0];
                    return i.update(buildDashboard('view_logging'));
                }
                if (i.customId === 'action_log_channel') {
                    const selectedCategory = state.selectedLogCategory || 'default';
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
                        'logAutomod', 'logChannelEdits', 'logVoiceJoins', 'logMemberBoosts'
                    ];
                    for (const field of logFields) {
                        settings[field] = values.includes(field);
                    }
                    update = true;
                }

                // Verification
                if (i.customId === 'action_verify_type') { settings.verificationType = i.values[0]; update = true; }
                if (i.customId === 'action_verify_channel') { settings.verifyChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_verify_role') { settings.verifyRoleId = i.values.join(','); update = true; }
                if (i.customId === 'action_roblox_toggle') { settings.robloxVerifyEnabled = !settings.robloxVerifyEnabled; update = true; }

                if (i.customId.startsWith('action_verify_spawn')) {
                    if (!settings.verifyRoleId) return i.reply({ content: '⚠️ You must configure at least one **Verified Role** in the dropdown above first!', ephemeral: true });
                    const targetChannelId = settings.verifyChannelId || i.channel.id;
                    const channel = i.guild.channels.cache.get(targetChannelId) || i.channel;

                    let spawnType = settings.verificationType || 'captcha';
                    if (i.customId === 'action_verify_spawn_button') spawnType = 'button';
                    if (i.customId === 'action_verify_spawn_captcha') spawnType = 'captcha';
                    if (i.customId === 'action_verify_spawn_reaction') spawnType = 'reaction';
                    if (i.customId === 'action_verify_spawn_roblox') spawnType = 'roblox';

                    const verifyEngine = require('../../bot/engines/verify');
                    try {
                        await verifyEngine.spawnVerificationPanel(channel, settings, spawnType, i);
                        const typeNames = {
                            button: '1-Click Button',
                            captcha: 'Anti-Bot CAPTCHA',
                            reaction: `Reaction (${settings.verifyEmoji || '✅'})`,
                            roblox: 'Roblox Linking'
                        };
                        return i.reply({ content: `✅ **${typeNames[spawnType]}** verification panel spawned in <#${channel.id}>!`, ephemeral: true });
                    } catch (spawnErr) {
                        console.error('Verification panel spawn error:', spawnErr);
                        return i.reply({ content: `⚠️ Failed to spawn panel: ${spawnErr.message}`, ephemeral: true });
                    }
                }

                // Tickets
                if (i.customId === 'action_ticket_category') { settings.ticketCategoryId = i.values[0]; update = true; }
                if (i.customId === 'action_ticket_support_role') { settings.ticketSupportRoleId = i.values[0]; update = true; }
                if (i.customId === 'action_ticket_autoarchive_toggle') { settings.ticketAutoArchive = !settings.ticketAutoArchive; update = true; }
                if (i.customId === 'action_ticket_customize_panel') {
                    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                    const modal = new ModalBuilder().setCustomId('modal_ticket_customize_panel').setTitle('Customize Ticket Panel');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('panel_title').setLabel('Panel Title').setStyle(TextInputStyle.Short).setRequired(true).setValue(settings.ticketPanelTitle || 'Support Center')
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('panel_desc').setLabel('Panel Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(settings.ticketPanelDesc || 'Need assistance? Please select a category below to open a private ticket with staff.')
                        )
                    );
                    await i.showModal(modal);
                    try {
                        const submitted = await i.awaitModalSubmit({ time: 300000, filter: x => x.user.id === interaction.user.id && x.customId === 'modal_ticket_customize_panel' });
                        settings.ticketPanelTitle = submitted.fields.getTextInputValue('panel_title');
                        settings.ticketPanelDesc = submitted.fields.getTextInputValue('panel_desc');
                        await settings.save();
                        settingsCache.invalidate(interaction.guild.id);
                        return submitted.update(buildDashboard('view_tickets'));
                    } catch (e) {
                        return;
                    }
                }
                if (i.customId === 'action_ticket_spawn') {
                    if (!settings.ticketCategoryId) return i.reply({ content: '⚠️ You must select a Ticket Category above first!', ephemeral: true });
                    const targetChannelId = settings.ticketChannelId || i.channel.id;
                    const channel = i.guild.channels.cache.get(targetChannelId) || i.channel;
                    const panelTitle = settings.ticketPanelTitle || 'Support Center';
                    const panelDesc = settings.ticketPanelDesc || 'Need assistance? Select a category below to open a private ticket with our staff team.';
                    const pEmbed = new EmbedBuilder().setTitle(panelTitle).setDescription(panelDesc).setColor(getRoleColor(interaction)).setFooter({ text: 'Support Ticketing System' });
                    const pRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket_Support').setLabel('Support').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('ticket_Reporting').setLabel('Reporting').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('ticket_Appeals').setLabel('Appeals').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('ticket_Other').setLabel('Other').setStyle(ButtonStyle.Secondary)
                    );
                    await channel.send({ embeds: [pEmbed], components: [pRow] });
                    return i.reply({ content: `✅ Ticket panel spawned in <#${channel.id}>!`, ephemeral: true });
                }

                // Self Roles & AI
                if (i.customId === 'action_ai_pref') { settings.aiPreference = i.values[0]; update = true; }
                if (i.customId === 'action_selfroles_build') {
                    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                    const modal = new ModalBuilder().setCustomId('modal_selfroles_build').setTitle('Self Roles Builder');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sr_title').setLabel('Panel Title').setStyle(TextInputStyle.Short).setRequired(true).setValue('Self Roles')),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sr_desc').setLabel('Panel Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('Click the buttons below to assign or remove roles.')),
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
                            return await submitted.editReply({ content: '⚠️ Provide between 1 and 5 valid numeric Role IDs.' }).catch(() => {});
                        }

                        const targetChannel = i.channel || interaction.channel;
                        const panelEmbed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(getRoleColor(interaction));
                        const row = new ActionRowBuilder();
                        let loaded = 0;
                        const addedRoles = new Set();
                        for (const rId of roleStrs) {
                            const cleanId = rId.replace(/[^0-9]/g, '');
                            if (!cleanId || addedRoles.has(cleanId)) continue;
                            const role = i.guild.roles.cache.get(cleanId) || await i.guild.roles.fetch(cleanId).catch(() => null);
                            if (role) {
                                row.addComponents(new ButtonBuilder().setCustomId(`selfrole_assign_${role.id}`).setLabel(role.name).setStyle(ButtonStyle.Secondary));
                                addedRoles.add(cleanId);
                                loaded++;
                            }
                        }

                        if (loaded === 0) {
                            return await submitted.editReply({ content: '⚠️ Could not find those Role IDs in this server.' }).catch(() => {});
                        }

                        await targetChannel.send({ embeds: [panelEmbed], components: [row] });
                        return await submitted.editReply({ content: '✅ Self-roles panel successfully created!' }).catch(() => {});
                    } catch (e) {
                        return;
                    }
                }

                // Dev Controls
                if (i.customId === 'dev_reboot') {
                    if (!APP_OWNER_IDS.includes(i.user.id)) return i.reply({ content: 'Unauthorized.', ephemeral: true });
                    await i.update({ content: '🔄 Rebooting application core...', embeds: [], components: [] });
                    process.exit(1);
                }
                if (i.customId === 'dev_dbsync') {
                    if (!APP_OWNER_IDS.includes(i.user.id)) return i.reply({ content: 'Unauthorized.', ephemeral: true });
                    const sequelize = require('../../database/db');
                    await sequelize.sync({ alter: true }).catch(() => {});
                    return i.reply({ content: '✅ Database correctly synchronized.', ephemeral: true });
                }

                if (update) {
                    await settings.save();
                    settingsCache.invalidate(interaction.guild.id);

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
                console.error('Setup collector error:', err);
                if (!i.replied && !i.deferred) i.reply({ content: '⚠️ Save failed.', ephemeral: true }).catch(() => {});
            }
        });
    }
};
