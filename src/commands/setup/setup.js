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
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
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
            sub.setName('autorole')
                .setDescription('Configure multi-role assignment on join (Up to 3 free, 5 premium).'))
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
            sub.setName('security')
                .setDescription('Configure Verification Threat Gatekeeper, security screening, and threat scan.'))
        .addSubcommand(sub =>
            sub.setName('starboard')
                .setDescription('Configure Starboard reaction threshold and channel.'))
        .addSubcommand(sub =>
            sub.setName('onewordstory')
                .setDescription('Configure One Word Story collaborative game.'))
        .addSubcommand(sub =>
            sub.setName('counting')
                .setDescription('Configure sequential Counting game.'))
        .addSubcommand(sub =>
            sub.setName('ai')
                .setDescription('Configure Nora AI behavior, engine models, and auto-response channel.'))
        .addSubcommand(sub =>
            sub.setName('moderation')
                .setDescription('Configure moderation actions, autonomous Nora enforcement, and mod logs.'))
        .addSubcommand(sub =>
            sub.setName('roku')
                .setDescription('Configure Roku Smart TV controls and authorization (Authorized servers only).'))
        .addSubcommand(sub =>
            sub.setName('adaptiveslowmode')
                .setDescription('Configure AI-powered Adaptive Slowmode chat velocity defense.')),

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
            autorole: 'view_welcomer',
            leveling: 'view_leveling',
            logging: 'view_logging',
            games: 'view_games',
            afk: 'view_afk',
            ticket: 'view_tickets',
            verify: 'view_verify',
            roblox: 'view_verify',
            security: 'view_verify_security',
            starboard: 'view_starboard',
            onewordstory: 'view_onewordstory',
            counting: 'view_counting',
            ai: 'view_ai',
            moderation: 'view_moderation',
            roku: 'view_roku',
            adaptiveslowmode: 'view_adaptiveslowmode'
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
                new ButtonBuilder().setCustomId('go_back').setLabel('Main Menu').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setLabel('Web Dashboard').setStyle(ButtonStyle.Link).setURL(`https://vaztinix.dev/dashboard?guild=${interaction.guild.id}`)
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

                const isPremium = settings.isPremium === true || settings.isManualPremium === true;
                const autoRoles = (settings.welcomeRoleId || '').split(',').map(r => r.trim()).filter(Boolean);
                const verifyRoles = (settings.verifyRoleId || '').split(',').map(r => r.trim()).filter(Boolean);

                const autoRoleText = autoRoles.length > 0 
                    ? (autoRoles.length <= 2 ? autoRoles.map(id => `<@&${id}>`).join(' ') : `**${autoRoles.length} roles**`) 
                    : '*None*';
                const verifyRoleText = verifyRoles.length > 0 
                    ? (verifyRoles.length <= 2 ? verifyRoles.map(id => `<@&${id}>`).join(' ') : `**${verifyRoles.length} roles**`) 
                    : '*Unset*';

                embed.setTitle('Nora Server Management')
                    .setDescription(
                        `Welcome to the **${interaction.guild.name}** configuration center.\n` +
                        `Select a category from the dropdown below to configure settings in real-time.`
                    )
                    .addFields(
                        { 
                            name: 'Safety & AutoMod', 
                            value: `Anti-Raid: **${settings.antiRaidEnabled ? 'On' : 'Off'}**\nAutoMod: **${autoModCount}/7 Active**\nLockdown: **${settings.lockdownMode ? 'Active' : 'Normal'}**`, 
                            inline: true 
                        },
                        { 
                            name: 'Welcomer & Verify', 
                            value: `Welcomer: **${settings.welcomerEnabled ? 'On' : 'Off'}**\nAuto-Roles: ${autoRoleText}\nVerification: **${settings.verifyRoleId ? 'On' : 'Off'}** (${verifyRoleText})\nTier: **${isPremium ? 'Nora Plus' : 'Free Tier'}**`, 
                            inline: true 
                        },
                        { 
                            name: 'Leveling & XP', 
                            value: `Chat XP: **${settings.levelingEnabled ? 'On' : 'Off'}**\nLevel Alerts: **${settings.levelUpNotificationsEnabled !== false ? 'On' : 'Off'}**\nAlert Channel: ${settings.levelUpChannelId ? `<#${settings.levelUpChannelId}>` : '*Current*'}`, 
                            inline: true 
                        },
                        { 
                            name: 'Audit Logging', 
                            value: `Default Log: ${settings.loggingChannelId ? `<#${settings.loggingChannelId}>` : '*None*'}\nRouted Channels: **${typeof settings.loggingChannels === 'object' ? Object.keys(settings.loggingChannels || {}).length : 0} active**`, 
                            inline: true 
                        },
                        { 
                            name: 'Games & AFK', 
                            value: `AFK System: **${settings.afkEnabled !== false ? 'On' : 'Off'}**\nCounting: ${settings.countingChannelId ? `<#${settings.countingChannelId}>` : '*Disabled*'}\nStarboard: **${settings.starboardEnabled ? 'On' : 'Off'}**`, 
                            inline: true 
                        },
                        { 
                            name: 'Support & Utility', 
                            value: `Tickets: **${settings.ticketCategoryId ? 'Configured' : 'Unset'}**\nAutoresponders: **${state.autoresponderCount} rules**\nYouTube Feeds: **${state.youtubeFeedCount} active**`, 
                            inline: true 
                        }
                    );

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('config_main')
                    .setPlaceholder('Select a category to configure...')
                    .addOptions([
                        { label: 'Safety & Anti-Raid', value: 'view_safety', description: 'Anti-raid, account age gate, photo check, lockdowns' },
                        { label: 'Discord AutoMod Rules', value: 'view_automod', description: 'Zero-latency native filters for profanity, spam, and scam links' },
                        { label: 'Moderation Actions & Enforcement', value: 'view_moderation', description: 'Autonomous Nora moderation actions, mod logs, and penalties' },
                        { label: 'Welcomer & Auto-Roles', value: 'view_welcomer', description: 'Custom welcome cards, join messages, and starter roles' },
                        { label: 'Leveling & Experience', value: 'view_leveling', description: 'Chat & Voice XP, level-up notifications, and multipliers' },
                        { label: 'Server Logs & Routing', value: 'view_logging', description: 'Multi-channel audit logs for members, messages, and voice' },
                        { label: 'Community Games & AFK', value: 'view_games', description: 'AFK module, Counting, One Word Story, and Starboard' },
                        { label: 'Member Verification', value: 'view_verify', description: 'Human CAPTCHA gate, 1-click button, reaction, and Roblox sync' },
                        { label: '🛡️ Verification Threat Gatekeeper', value: 'view_verify_security', description: 'Automated background risk screening, online threat intel, ban evasion matching' },
                        { label: 'Support Ticket System', value: 'view_tickets', description: 'Private staff ticket categories, panels, and transcripts' },
                        { label: 'Nora AI & Auto-Response', value: 'view_ai', description: 'Configure AI engine and unprompted auto-respond channel' },
                        { label: 'Adaptive Slowmode & Velocity', value: 'view_adaptiveslowmode', description: 'AI-assisted chat defense with 0s lowest floor' },
                        { label: 'Self Roles & Feeds', value: 'view_utility', description: 'Interactive button role panels and YouTube feeds' }
                    ]);

                const WHITELISTED_ROKU_GUILDS = ['1487342521133830174', '1515800329889779954'];
                if (WHITELISTED_ROKU_GUILDS.includes(interaction.guild.id)) {
                    menu.addOptions([
                        { label: '📺 Roku Smart TV Controls', value: 'view_roku', description: 'Hardware control, TV state, guest passes, and quick actions' }
                    ]);
                }

                if (APP_OWNER_IDS.includes(interaction.user.id)) {
                    menu.addOptions([
                        { label: 'Dev & Premium Overrides', value: 'view_dev', description: 'Bot owner tools, database sync, and premium grants' }
                    ]);
                }

                const quickActions = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_quick_refresh').setLabel('Refresh Status').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setLabel('Web Dashboard').setStyle(ButtonStyle.Link).setURL(`https://vaztinix.dev/dashboard?guild=${interaction.guild.id}`)
                );

                return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), quickActions] };
            }

            // ==========================================
            // SAFETY & ANTI-RAID
            // ==========================================
            if (viewName === 'view_safety') {
                embed.setTitle('Safety & Anti-Raid Settings')
                    .setDescription('Configure protection against raids, malicious alt accounts, and mass bot joins.')
                    .addFields(
                        { name: 'Anti-Raid Engine', value: settings.antiRaidEnabled ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: 'Server Lockdown', value: settings.lockdownMode ? '**Active (Locked)**' : '**Normal**', inline: true },
                        { name: 'Require Profile Picture', value: settings.requirePFP ? '**Required**' : '**Optional**', inline: true },
                        { name: 'Min Account Age', value: settings.minAccountAge > 0 ? `**${settings.minAccountAge} Day(s)**` : '**Disabled**', inline: true },
                        { name: 'Nickname Raid Filter', value: settings.nicknameRaidFilter ? '**Active**' : '**Disabled**', inline: true },
                        { name: 'Raid Detection Action', value: `\`${settings.antiRaidAction || 'notify'}\``, inline: true }
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
            // DISCORD AUTOMOD RULES
            // ==========================================
            if (viewName === 'view_automod') {
                const on = (v) => v ? '**Blocked**' : '**Allowed**';
                embed.setTitle('Discord Native AutoMod Rules')
                    .setDescription('Enforced directly by **Discord\'s native AutoMod engine** for instant, zero-latency protection.')
                    .addFields(
                        { name: 'Profanity Filter', value: on(settings.automodProfanity), inline: true },
                        { name: 'Sexual Content', value: on(settings.automodSexual), inline: true },
                        { name: 'Slurs & Hate Speech', value: on(settings.automodSlurs), inline: true },
                        { name: 'Scam & Phishing Links', value: on(settings.automodScam), inline: true },
                        { name: 'Text Message Spam', value: on(settings.automodSpam), inline: true },
                        { name: 'Hardcore Media Filter', value: on(settings.automodHardcore), inline: true },
                        { name: 'Mention Spam Limit', value: settings.automodMentions > 0 ? `**Max ${settings.automodMentions}**` : '**Off**', inline: true },
                        { name: 'Immune Roles', value: (() => { try { const r = JSON.parse(settings.automodImmuneRoles || '[]'); return r.length ? r.map(id => `<@&${id}>`).join(', ') : '*None*'; } catch { return '*None*'; } })(), inline: true }
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
            // WELCOMER & GOODBYE SUITE
            // ==========================================
            if (viewName === 'view_welcomer') {
                const isPremium = settings.isPremium === true || settings.isManualPremium === true;
                const maxAutoRoles = isPremium ? 5 : 3;
                const currentRoles = (settings.welcomeRoleId || '').split(',').map(r => r.trim()).filter(Boolean);

                embed.setTitle('Welcomer & Goodbye Configuration Suite')
                    .setDescription(
                        `Configure dedicated welcome cards, goodbye announcements, and join auto-roles.\n` +
                        `Welcomer (Joins) and Goodbye (Leaves) can be broadcast to distinct channels.`
                    )
                    .addFields(
                        { name: 'Welcome System', value: settings.welcomerEnabled ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: 'Welcome Channel', value: settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : '*None*', inline: true },
                        { name: 'Join DM Alert', value: settings.welcomeDmEnabled ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: 'Goodbye System', value: settings.goodbyeEnabled ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: 'Goodbye Channel', value: settings.goodbyeChannelId ? `<#${settings.goodbyeChannelId}>` : (settings.welcomeChannelId ? `<#${settings.welcomeChannelId}> *(Fallback)*` : '*None*'), inline: true },
                        { name: 'Goodbye DM Alert', value: settings.goodbyeDmEnabled ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: `Starter Auto-Roles (${currentRoles.length}/${maxAutoRoles})`, value: currentRoles.length > 0 ? currentRoles.map(id => `<@&${id}>`).join(' ') : '*None*', inline: true },
                        { name: 'Quarantine Role', value: settings.unverifiedRoleId ? `<@&${settings.unverifiedRoleId}>` : '*None*', inline: true },
                        { name: 'Tier Status', value: isPremium ? '**Studio Plus (5 Roles Max)**' : '**Free Tier (3 Roles Max)**', inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_welcomer_toggle').setLabel(settings.welcomerEnabled ? 'Disable Welcome' : 'Enable Welcome').setStyle(settings.welcomerEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_welcomedm_toggle').setLabel(settings.welcomeDmEnabled ? 'Disable Join DM' : 'Enable Join DM').setStyle(settings.welcomeDmEnabled ? ButtonStyle.Danger : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_goodbye_toggle').setLabel(settings.goodbyeEnabled ? 'Disable Goodbye' : 'Enable Goodbye').setStyle(settings.goodbyeEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_goodbyedm_toggle').setLabel(settings.goodbyeDmEnabled ? 'Disable Leave DM' : 'Enable Leave DM').setStyle(settings.goodbyeDmEnabled ? ButtonStyle.Danger : ButtonStyle.Secondary)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_welcome_channel').setPlaceholder('Select Welcome Channel (Joins)...').setChannelTypes(ChannelType.GuildText)
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_goodbye_channel').setPlaceholder('Select Dedicated Goodbye Channel (Leaves)...').setChannelTypes(ChannelType.GuildText)
                );

                const rowD = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('action_welcome_role')
                        .setPlaceholder(`Select Auto-Roles on Join (Up to ${maxAutoRoles} roles)...`)
                        .setMinValues(0)
                        .setMaxValues(maxAutoRoles)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            // ==========================================
            // LEVELING & EXPERIENCE
            // ==========================================
            if (viewName === 'view_leveling') {
                const isPremium = settings.isPremium === true || settings.isManualPremium === true;
                const cdSec = settings.levelingCooldownSec || 60;
                const xpRate = settings.levelingXpRate || 1.0;

                embed.setTitle('Leveling & Progression Suite')
                    .setDescription('Configure community leveling, XP cooldowns, multipliers, level-up alerts, and custom rank card styling.')
                    .addFields(
                        { name: 'Leveling System', value: settings.levelingEnabled ? '**Active**' : '**Disabled**', inline: true },
                        { name: 'XP Cooldown', value: `**${cdSec} seconds**`, inline: true },
                        { name: 'XP Rate Multiplier', value: `**${xpRate}x**`, inline: true },
                        { name: 'Level-Up Alerts', value: settings.levelUpNotificationsEnabled !== false ? '**Active**' : '**Disabled**', inline: true },
                        { name: 'Alert Channel', value: settings.levelUpChannelId ? `<#${settings.levelUpChannelId}>` : '*Current Channel*', inline: true },
                        { name: 'DM Notification', value: settings.levelUpDmEnabled ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: 'Rank Card Avatars', value: settings.levelingPfpEnabled !== false ? '**Shown**' : '**Hidden**', inline: true },
                        { name: 'Role Stacking', value: settings.roleRewardsStack !== false ? '**Stacking**' : '**Highest Only**', inline: true },
                        { name: 'Tier Status', value: isPremium ? '**Studio Plus** (Up to 10x XP & 25 Roles)' : '**Free Tier** (Up to 2x XP & 5 Roles)', inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_leveling_toggle').setLabel(settings.levelingEnabled ? 'Disable Leveling' : 'Enable Leveling').setStyle(settings.levelingEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_levelalert_toggle').setLabel(settings.levelUpNotificationsEnabled !== false ? 'Disable Alerts' : 'Enable Alerts').setStyle(settings.levelUpNotificationsEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_leveldm_toggle').setLabel(settings.levelUpDmEnabled ? 'Disable DM Alerts' : 'Enable DM Alerts').setStyle(settings.levelUpDmEnabled ? ButtonStyle.Danger : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_rolestack_toggle').setLabel(settings.roleRewardsStack !== false ? 'Stack Roles: ON' : 'Stack Roles: OFF').setStyle(ButtonStyle.Secondary)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('action_leveling_cooldown')
                        .setPlaceholder('Configure XP Message Cooldown...')
                        .addOptions([
                            { label: 'Fast (15 seconds)', value: '15', description: 'Fast-paced chatting servers', default: cdSec === 15 },
                            { label: 'Standard (60 seconds - Recommended)', value: '60', description: 'Balanced anti-farming cooldown', default: cdSec === 60 },
                            { label: 'Relaxed (120 seconds)', value: '120', description: 'Slow-burn community progression', default: cdSec === 120 },
                            { label: 'Anti-Farm (300 seconds / 5 mins)', value: '300', description: 'Strict rate limit for large servers', default: cdSec === 300 }
                        ])
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_levelalert_channel').setPlaceholder('Select Dedicated Level-Up Channel...').setChannelTypes(ChannelType.GuildText)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // ==========================================
            // SERVER LOGGING & ROUTING
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
                    default: 'Default Fallback Log Channel',
                    memberJoins: 'Member Joins Log Channel',
                    memberLeaves: 'Member Leaves Log Channel',
                    messages: 'Message Logs (Edits & Deletes)',
                    channels: 'Channel Logs (Creates, Edits & Deletes)',
                    voice: 'Voice Logs (Joins, Leaves & Moves)',
                    automod: 'AutoMod & Security Logs',
                    moderation: 'Moderation Actions & Cases',
                    commands: 'Slash Command Execution Logs',
                    roles: 'Role & Permission Change Logs',
                    boosts: 'Server Boost Logs',
                    verify: 'Verification & Gatekeeper Logs',
                    tickets: 'Support Tickets Log Channel'
                };

                const getCatVal = (catKey) => {
                    if (catKey === 'default') return settings.loggingChannelId ? `<#${settings.loggingChannelId}>` : '*None*';
                    if (catKey === 'moderation') return settings.modLogChannelId ? `<#${settings.modLogChannelId}>` : (logChannels.moderation ? `<#${logChannels.moderation}>` : `*(Fallback)*`);
                    if (catKey === 'verify') return settings.verificationLogChannelId ? `<#${settings.verificationLogChannelId}>` : (logChannels.verify ? `<#${logChannels.verify}>` : `*(Fallback)*`);
                    if (catKey === 'tickets') return settings.ticketLogChannelId ? `<#${settings.ticketLogChannelId}>` : (logChannels.tickets ? `<#${logChannels.tickets}>` : `*(Fallback)*`);
                    if (catKey === 'boosts') return logChannels.boosts ? `<#${logChannels.boosts}>` : (settings.boostChannelId ? `<#${settings.boostChannelId}>` : `*(Fallback)*`);
                    return logChannels[catKey] ? `<#${logChannels[catKey]}>` : `*(Fallback)*`;
                };

                embed.setTitle('Audit Logging & Channel Routing Suite')
                    .setDescription(
                        `**Configuring Category:** ${categoryLabels[activeSection] || 'Default Fallback'}\n` +
                        `Select a specific log category from the dropdown below, then choose the destination channel.`
                    )
                    .addFields(
                        { name: 'Master Fallback', value: getCatVal('default'), inline: true },
                        { name: 'Member Joins', value: getCatVal('memberJoins'), inline: true },
                        { name: 'Member Leaves', value: getCatVal('memberLeaves'), inline: true },
                        { name: 'Message Logs', value: getCatVal('messages'), inline: true },
                        { name: 'Channel Changes', value: getCatVal('channels'), inline: true },
                        { name: 'Voice Activity', value: getCatVal('voice'), inline: true },
                        { name: 'AutoMod Alerts', value: getCatVal('automod'), inline: true },
                        { name: 'Moderation Logs', value: getCatVal('moderation'), inline: true },
                        { name: 'Command Usage', value: getCatVal('commands'), inline: true },
                        { name: 'Role Changes', value: getCatVal('roles'), inline: true },
                        { name: 'Server Boosts', value: getCatVal('boosts'), inline: true },
                        { name: 'Verification Logs', value: getCatVal('verify'), inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_log_part_select').setPlaceholder('Choose Log Category to Assign Channel...').addOptions([
                        { label: 'Default Master Fallback', value: 'default', description: 'Catch-all channel for unassigned log categories', default: activeSection === 'default' },
                        { label: 'Member Joins', value: 'memberJoins', description: 'Audit logs for new members joining', default: activeSection === 'memberJoins' },
                        { label: 'Member Leaves', value: 'memberLeaves', description: 'Audit logs for members departing', default: activeSection === 'memberLeaves' },
                        { label: 'Message Edits & Deletes', value: 'messages', description: 'Message modifications and purges', default: activeSection === 'messages' },
                        { label: 'Channel Events', value: 'channels', description: 'Channel creations, renames, and deletions', default: activeSection === 'channels' },
                        { label: 'Voice Activity', value: 'voice', description: 'Voice channel joins, leaves, and moves', default: activeSection === 'voice' },
                        { label: 'AutoMod Violations', value: 'automod', description: 'Blocked words, spam limits, and raid triggers', default: activeSection === 'automod' },
                        { label: 'Moderation Actions', value: 'moderation', description: 'Bans, mutes, kicks, and warnings', default: activeSection === 'moderation' },
                        { label: 'Command Executions', value: 'commands', description: 'Slash command usage records', default: activeSection === 'commands' },
                        { label: 'Role & Permission Events', value: 'roles', description: 'Role creations, edits, and deletions', default: activeSection === 'roles' },
                        { label: 'Server Boosts', value: 'boosts', description: 'Server boost notifications and logs', default: activeSection === 'boosts' },
                        { label: 'Verification Logs', value: 'verify', description: 'Captcha passes, button clicks, and Roblox links', default: activeSection === 'verify' },
                        { label: 'Support Ticket Logs', value: 'tickets', description: 'Ticket creations, closures, and transcripts', default: activeSection === 'tickets' }
                    ])
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_log_channel').setPlaceholder(`Assign channel for ${categoryLabels[activeSection] || 'Category'}...`).setChannelTypes(ChannelType.GuildText)
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('action_log_toggle')
                        .setPlaceholder('Toggle Monitored Event Types (Multi-Select)...')
                        .setMinValues(0)
                        .setMaxValues(10)
                        .addOptions([
                            { label: 'Member Joins', value: 'logMemberJoins', description: 'Log user join events', default: !!settings.logMemberJoins },
                            { label: 'Member Leaves', value: 'logMemberLeaves', description: 'Log user departure events', default: !!settings.logMemberLeaves },
                            { label: 'Message Edits', value: 'logMessageEdits', description: 'Log edited message content', default: !!settings.logMessageEdits },
                            { label: 'Message Deletes', value: 'logMessageDeletes', description: 'Log deleted message content', default: !!settings.logMessageDeletes },
                            { label: 'AutoMod Violations', value: 'logAutomod', description: 'Log caught AutoMod rule infractions', default: !!settings.logAutomod },
                            { label: 'Channel Updates', value: 'logChannelEdits', description: 'Log channel create/edit/delete events', default: !!settings.logChannelEdits },
                            { label: 'Voice Activity', value: 'logVoiceJoins', description: 'Log VC joins, leaves, and moves', default: !!settings.logVoiceJoins },
                            { label: 'Server Boosts', value: 'logMemberBoosts', description: 'Log server boost events', default: !!settings.logMemberBoosts },
                            { label: 'Command Usage', value: 'logCommands', description: 'Log slash command executions', default: !!settings.logCommands },
                            { label: 'Role Changes', value: 'logRoleEvents', description: 'Log role creations and modifications', default: !!settings.logRoleEvents }
                        ])
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // ==========================================
            // COMMUNITY GAMES, STARBOARD & AFK
            // ==========================================
            if (viewName === 'view_games') {
                embed.setTitle('Community Games, Starboard & AFK')
                    .setDescription('Configure interactive server games and community features.')
                    .addFields(
                        { name: 'AFK System', value: settings.afkEnabled !== false ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: 'Counting Game', value: settings.countingChannelId ? `<#${settings.countingChannelId}>` : '**Disabled**', inline: true },
                        { name: 'One Word Story', value: settings.oneWordStoryEnabled !== false ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: 'Starboard', value: settings.starboardEnabled ? `<#${settings.starboardChannelId || 'Unset'}> (${settings.starboardThreshold || 3}⭐)` : '**Disabled**', inline: true },
                        { name: 'Self-Star Policy', value: settings.starboardSelfStar ? '**Allowed**' : '**Blocked**', inline: true },
                        { name: 'Starboard XP', value: `**+${settings.starboardAuthorRewardXp !== undefined ? settings.starboardAuthorRewardXp : 25} XP**`, inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_afk_toggle').setLabel(settings.afkEnabled !== false ? 'Disable AFK' : 'Enable AFK').setStyle(settings.afkEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_onewordstory_toggle').setLabel(settings.oneWordStoryEnabled !== false ? 'Disable Story' : 'Enable Story').setStyle(settings.oneWordStoryEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_starboard_toggle').setLabel(settings.starboardEnabled ? 'Disable Starboard' : 'Enable Starboard').setStyle(settings.starboardEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_starboard_selfstar').setLabel(settings.starboardSelfStar ? 'Self-Star: On' : 'Self-Star: Off').setStyle(ButtonStyle.Secondary)
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
            // MULTI-MODE MEMBER VERIFICATION & GATEKEEPER
            // ==========================================
            if (viewName === 'view_verify') {
                const currentType = settings.verificationType || 'captcha';
                const typeLabels = {
                    button: '1-Click Button',
                    captcha: 'Anti-Bot CAPTCHA',
                    reaction: 'Reaction Emoji',
                    roblox: 'Roblox Account Verification'
                };

                const isPremium = settings.isPremium === true || settings.isManualPremium === true;
                const maxVerifyRoles = isPremium ? 5 : 3;
                const verifiedRoles = (settings.verifyRoleId || '').split(',').map(r => r.trim()).filter(Boolean);

                embed.setTitle('Server Verification & Gatekeeper')
                    .setDescription(
                        `Configure server entry verification. Nora supports 4 challenge types:\n` +
                        `• **1-Click Button:** Instant frictionless verification.\n` +
                        `• **Anti-Bot CAPTCHA:** Distorted image security code to block raids.\n` +
                        `• **Reaction:** Reaction emoji on a verification message.\n` +
                        `• **Roblox:** Verifies and links Roblox accounts for group sync.`
                    )
                    .addFields(
                        { name: 'Active Challenge Mode', value: `**${typeLabels[currentType] || 'Anti-Bot CAPTCHA'}**`, inline: true },
                        { name: 'Spawn Channel', value: settings.verifyChannelId ? `<#${settings.verifyChannelId}>` : '*Current Channel*', inline: true },
                        { name: `Verified Role(s) (${verifiedRoles.length}/${maxVerifyRoles})`, value: verifiedRoles.length > 0 ? verifiedRoles.map(id => `<@&${id}>`).join(' ') : '*None (Required)*', inline: true },
                        { name: 'Quarantine Role', value: settings.unverifiedRoleId ? `<@&${settings.unverifiedRoleId}>` : '*None*', inline: true },
                        { name: 'Strip Quarantine on Verify', value: settings.removeUnverifiedRoleOnVerify !== false ? '**Yes**' : '**No**', inline: true },
                        { name: 'Audit Log Channel', value: settings.verificationLogChannelId ? `<#${settings.verificationLogChannelId}>` : '*Default Log Channel*', inline: true },
                        { name: '🛡️ Threat Screening', value: settings.verificationSecurityCheck !== false ? '**Active (Scanning)**' : '**Disabled**', inline: true },
                        { name: '🌐 Online Threat Intel', value: settings.verifyCheckOnlineThreats !== false ? '**Active (Discord Flags)**' : '**Disabled**', inline: true },
                        { name: '🚨 Flagged Policy', value: `**${(settings.verifyActionOnFlagged || 'deny').toUpperCase()}**`, inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('action_verify_type')
                        .setPlaceholder('Choose Active Verification Type...')
                        .addOptions([
                            { label: 'Anti-Bot CAPTCHA (Image Challenge)', value: 'captcha', description: 'Visual distorted image security code test', default: currentType === 'captcha' },
                            { label: 'Click to Verify (1-Click Button)', value: 'button', description: 'Immediate 1-click instant verification button', default: currentType === 'button' },
                            { label: 'React Verification (Emoji)', value: 'reaction', description: 'React with an emoji to gain access', default: currentType === 'reaction' },
                            { label: 'Roblox Account Verification', value: 'roblox', description: 'Link Roblox profile to Discord server', default: currentType === 'roblox' }
                        ])
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('action_verify_role')
                        .setPlaceholder(`Select Verified Role(s) (Up to ${maxVerifyRoles})...`)
                        .setMinValues(1)
                        .setMaxValues(maxVerifyRoles)
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('action_unverified_role')
                        .setPlaceholder('Select Quarantine Role (Removed on verify)...')
                        .setMinValues(0)
                        .setMaxValues(1)
                );

                const rowD = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_verify_channel').setPlaceholder('Select Destination Verification Channel...').setChannelTypes(ChannelType.GuildText)
                );

                const rowE = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_verify_spawn_active').setLabel(`Deploy ${(currentType).toUpperCase()} Panel`).setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('view_verify_security').setLabel('Security Controls').setStyle(settings.verificationSecurityCheck !== false ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🛡️'),
                    new ButtonBuilder().setCustomId('action_remove_unverified_toggle').setLabel(settings.removeUnverifiedRoleOnVerify !== false ? 'Strip Role: ON' : 'Strip Role: OFF').setStyle(settings.removeUnverifiedRoleOnVerify !== false ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('go_back').setLabel('Main Menu').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(`https://vaztinix.dev/dashboard?guild=${interaction.guild.id}`)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, rowE] };
            }

            // ==========================================
            // VERIFICATION SECURITY & SAFEGUARDS VIEW
            // ==========================================
            if (viewName === 'view_verify_security') {
                const actionLabels = {
                    deny: 'Deny & Alert Staff (Quarantined)',
                    kick: 'Automatically Kick User',
                    ban: 'Automatically Ban User'
                };
                const currentAction = settings.verifyActionOnFlagged || 'deny';

                embed.setTitle('🛡️ Verification Security & Threat Gatekeeper')
                    .setDescription(
                        'Nora automatically screens every account attempting verification for raid syndicates, Discord spam flags, and ban evasion.\n\n' +
                        'Configure your automated background security rules below:'
                    )
                    .addFields(
                        { name: '🛡️ Automated Screening (Master)', value: settings.verificationSecurityCheck !== false ? '**ENABLED (Active)**' : '**DISABLED**', inline: true },
                        { name: '🌐 Online Threat & Spammer Intel', value: settings.verifyCheckOnlineThreats !== false ? '**ENABLED (Live API Checks)**' : '**DISABLED**', inline: true },
                        { name: '🔍 Ban Evasion & Alt Matching', value: settings.verifyCheckBanEvasion !== false ? '**ENABLED (Handle & Avatar Hash)**' : '**DISABLED**', inline: true },
                        { name: '🚨 Action When Flagged', value: `**${actionLabels[currentAction] || currentAction.toUpperCase()}**`, inline: false }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('action_verify_security_toggle')
                        .setLabel(settings.verificationSecurityCheck !== false ? 'Screening: ENABLED' : 'Screening: DISABLED')
                        .setEmoji('🛡️')
                        .setStyle(settings.verificationSecurityCheck !== false ? ButtonStyle.Success : ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('action_verify_online_toggle')
                        .setLabel(settings.verifyCheckOnlineThreats !== false ? 'Online Intel: ENABLED' : 'Online Intel: DISABLED')
                        .setEmoji('🌐')
                        .setStyle(settings.verifyCheckOnlineThreats !== false ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('action_verify_banevasion_toggle')
                        .setLabel(settings.verifyCheckBanEvasion !== false ? 'Ban Evasion: ENABLED' : 'Ban Evasion: DISABLED')
                        .setEmoji('🔍')
                        .setStyle(settings.verifyCheckBanEvasion !== false ? ButtonStyle.Primary : ButtonStyle.Secondary)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('action_verify_action_select')
                        .setPlaceholder('Select Enforcement Action for Flagged Members...')
                        .addOptions([
                            { label: 'Deny & Alert Staff (Recommended)', value: 'deny', description: 'Blocks access, quarantines user, dispatches incident alert to staff', default: currentAction === 'deny' },
                            { label: 'Automatically Kick User', value: 'kick', description: 'Kicks flagged user from the server immediately', default: currentAction === 'kick' },
                            { label: 'Automatically Ban User', value: 'ban', description: 'Permanently bans flagged user from the server', default: currentAction === 'ban' }
                        ])
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('view_verify_back').setLabel('Back to Verification').setStyle(ButtonStyle.Primary).setEmoji('⬅️'),
                    new ButtonBuilder().setCustomId('go_back').setLabel('Main Menu').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(`https://vaztinix.dev/dashboard?guild=${interaction.guild.id}`)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC] };
            }

            // ==========================================
            // SUPPORT TICKETS
            // ==========================================
            if (viewName === 'view_tickets') {
                embed.setTitle('Support Ticket Management Suite')
                    .setDescription(
                        'Configure private support tickets, multi-topic dispatch panels, staff claim routing, and auto-transcripts.\n\n' +
                        'Click **Deploy Multi-Topic Panel** to post a support station into any channel.'
                    )
                    .addFields(
                        { name: 'Parent Category', value: settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : '*None (Top of channel list)*', inline: true },
                        { name: 'Support Staff Role', value: settings.ticketSupportRoleId ? `<@&${settings.ticketSupportRoleId}>` : '*None (Admins only)*', inline: true },
                        { name: 'Auto-Archive Inactive', value: settings.ticketAutoArchive ? '**Enabled (24h)**' : '**Disabled**', inline: true },
                        { name: 'Total Created', value: `#${settings.ticketLastNumber || 0}`, inline: true },
                        { name: 'Panel Title', value: `\`${settings.ticketPanelTitle || 'Support & Assistance Hub'}\``, inline: true },
                        { name: 'Intake Fields', value: settings.ticketFormInputs ? '**Custom Modal Configured**' : '**Standard Topic Intakes**', inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_ticket_deploy_panel').setLabel('Deploy Multi-Topic Panel').setStyle(ButtonStyle.Success),
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
            // SELF ROLES, AUTORESPONDERS & AI
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
            // 🧠 NORA AI & AUTO-RESPONSE
            // ==========================================
            if (viewName === 'view_ai') {
                const autoChannelText = settings.aiAutoRespondChannelId ? `<#${settings.aiAutoRespondChannelId}>` : '*None (Mentions/Replies Only)*';
                const autoRespondActive = settings.aiAutoRespondEnabled !== false && settings.aiAutoRespondChannelId;

                embed.setTitle('🧠 Nora AI Management & Channel Intelligence')
                    .setDescription(
                        'Configure Nora\'s AI engine and set a dedicated channel where Nora automatically responds to **all messages without needing to be pinged**!\n\n' +
                        '• **Selected Auto-Respond Channel:** When configured, Nora chats naturally in this channel with zero pings required.\n' +
                        '• **Omniscience & Surrounds:** Nora perceives server rosters, profile pictures, banners, and remembers recent conversation history naturally.\n' +
                        '• **Staff Privacy Firewall:** Messages from staff-only channels are strictly isolated and never shared in public.'
                    )
                    .addFields(
                        { name: 'AI Engine', value: `🧠 \`${settings.aiPreference || 'gemini'}\``, inline: true },
                        { name: 'Auto-Respond Channel', value: autoChannelText, inline: true },
                        { name: 'Auto-Respond Status', value: autoRespondActive ? '🟢 **Active (No Ping Required)**' : '⚪ **Inactive / Mentions Only**', inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('action_ai_autochannel')
                        .setPlaceholder('Select Auto-Respond Channel (No ping required)...')
                        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('action_ai_autotoggle')
                        .setLabel(settings.aiAutoRespondEnabled !== false ? 'Disable Auto-Response' : 'Enable Auto-Response')
                        .setStyle(settings.aiAutoRespondEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('action_ai_autoclear')
                        .setLabel('Clear Auto-Respond Channel')
                        .setStyle(ButtonStyle.Secondary)
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_ai_pref').setPlaceholder('Change Nora AI Engine Preference...').addOptions([
                        { label: 'Google Gemini 2.5 Flash (Default, Ultra-Fast)', value: 'gemini', default: settings.aiPreference === 'gemini' },
                        { label: 'OpenAI GPT-4o Mini', value: 'openai', default: settings.aiPreference === 'openai' },
                        { label: 'Anthropic Claude 3.5 Haiku', value: 'claude', default: settings.aiPreference === 'claude' }
                    ])
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // ==========================================
            // 🛡️ MODERATION ACTIONS & ENFORCEMENT
            // ==========================================
            if (viewName === 'view_moderation') {
                const modLogText = settings.modLogChannelId ? `<#${settings.modLogChannelId}>` : '*None (Console Only)*';
                const sendModDms = settings.sendModDms !== false;

                embed.setTitle('🛡️ Moderation Actions & Autonomous Enforcement')
                    .setDescription(
                        'Configure Nora\'s moderation action pipelines, audit logging channels, and member disciplinary enforcement.\n\n' +
                        '• **Autonomous Nora AI Moderation:** Authorized staff can chat directly with Nora to take punitive action (e.g. `@Nora timeout @user 10m for spam`, `@Nora warn @user`, `@Nora purge 20`).\n' +
                        '• **Direct Message Notices:** When enabled, disciplined members receive an official DM stating reason, moderator, and appeal instructions.\n' +
                        '• **Anti-Raid Enforcement Action:** When mass-joins or raids are detected, Nora executes the chosen action automatically.'
                    )
                    .addFields(
                        { name: 'Mod Log Channel', value: modLogText, inline: true },
                        { name: 'Direct Message Notices', value: sendModDms ? '🟢 **Enabled (DMs Sent)**' : '⚪ **Disabled**', inline: true },
                        { name: 'Anti-Raid Enforcement', value: `\`${settings.antiRaidAction || 'notify'}\``, inline: true },
                        { name: 'Autonomous Actions', value: '⚡ **Mute, Warn, Kick, Ban, Purge, Lock**', inline: false }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('action_modlog_channel')
                        .setPlaceholder('Set Mod Log Channel...')
                        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('action_moddms_toggle')
                        .setLabel(sendModDms ? 'Disable Mod DMs' : 'Enable Mod DMs')
                        .setStyle(sendModDms ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('view_safety')
                        .setLabel('Anti-Raid & Quarantine')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🛡️'),
                    new ButtonBuilder()
                        .setCustomId('view_automod')
                        .setLabel('Discord AutoMod Rules')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⚡')
                );

                return { embeds: [embed], components: [rowA, rowB, backRow] };
            }

            // ==========================================
            // 📺 ROKU SMART TV HARDWARE CONTROLS
            // ==========================================
            if (viewName === 'view_roku') {
                const WHITELISTED_ROKU_GUILDS = ['1487342521133830174', '1515800329889779954'];
                if (!WHITELISTED_ROKU_GUILDS.includes(interaction.guild.id)) {
                    embed.setTitle('🔒 Roku Smart TV Integration — Restricted')
                        .setDescription(
                            '⚠️ **Unauthorized Server**: Roku Smart TV hardware integration is strictly restricted to authorized headquarters servers:\n' +
                            '• **Milo\'s World** (`1487342521133830174`)\n' +
                            '• **Headquarters 2** (`1515800329889779954`)\n\n' +
                            'This hardware feature is not accessible in this server.'
                        )
                        .setColor(0xEF4444);

                    return { embeds: [embed], components: [backRow] };
                }

                let rokuController = null;
                try { rokuController = require('../../utils/rokuController'); } catch (e) {}
                if (!rokuController) {
                    embed.setTitle('📺 Roku Smart TV Module Offline')
                        .setDescription('Roku hardware integration module is currently disabled or offline.')
                        .setColor(0xEF4444);
                    return { embeds: [embed], components: [backRow] };
                }
                const isAuth = rokuController.isAuthorized(interaction.user.id);
                const tries = rokuController.getRemainingTries(interaction.user.id);

                embed.setTitle('📺 Roku Smart TV Command Center')
                    .setDescription(
                        `Welcome to the dedicated Roku Smart TV hardware console for **${interaction.guild.name}**!\n\n` +
                        '• **Hardware Protocol:** External Control Protocol (ECP over HTTP)\n' +
                        '• **Strict Developer Gate:** Primary control is reserved for <@1214048435632603137>.\n' +
                        '• **Guest Delegation:** Temporary guest passes can be granted with command quotas and permission scopes.\n' +
                        '• **Conversational Control:** You can also ask Nora naturally in chat (e.g. `"open YouTube on Roku"`, `"turn on the TV"`, `"restart Roku TV"`).'
                    )
                    .addFields(
                        { name: 'Server Status', value: '🟢 **Authorized HQ Server**', inline: true },
                        { name: 'Your Access', value: isAuth ? (interaction.user.id === '1214048435632603137' ? '👑 **Head Developer (Full)**' : `🎟️ **Guest Pass (${tries} tries)**`) : '🔒 **Unauthorized**', inline: true },
                        { name: 'Hardware Control', value: '⚡ **Active (Local Network ECP)**', inline: true }
                    )
                    .setColor(0x06B6D4);

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_roku_power').setLabel('Power Toggle').setStyle(ButtonStyle.Primary).setEmoji('⚡'),
                    new ButtonBuilder().setCustomId('action_roku_home').setLabel('Home Screen').setStyle(ButtonStyle.Secondary).setEmoji('🏠'),
                    new ButtonBuilder().setCustomId('action_roku_play').setLabel('Play / Pause').setStyle(ButtonStyle.Secondary).setEmoji('⏯️'),
                    new ButtonBuilder().setCustomId('action_roku_help').setLabel('TV Guide').setStyle(ButtonStyle.Success).setEmoji('📋')
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_roku_volup').setLabel('Vol +3').setStyle(ButtonStyle.Secondary).setEmoji('🔊'),
                    new ButtonBuilder().setCustomId('action_roku_voldown').setLabel('Vol -3').setStyle(ButtonStyle.Secondary).setEmoji('🔉'),
                    new ButtonBuilder().setCustomId('action_roku_mute').setLabel('Mute').setStyle(ButtonStyle.Secondary).setEmoji('🔇'),
                    new ButtonBuilder().setCustomId('action_roku_restart').setLabel('Restart TV').setStyle(ButtonStyle.Danger).setEmoji('🔄')
                );

                return { embeds: [embed], components: [rowA, rowB, backRow] };
            }

            // ==========================================
            // ⏱️ ADAPTIVE SLOWMODE & CHAT VELOCITY
            // ==========================================
            if (viewName === 'view_adaptiveslowmode') {
                const isEnabled = settings.adaptiveSlowmodeEnabled === true;
                const isAiEnabled = settings.adaptiveSlowmodeAiEnabled !== false;
                const floorSec = Math.max(0, settings.adaptiveSlowmodeInactiveSec ?? 0);

                let channelListText = 'Server-Wide (All Channels)';
                if (settings.adaptiveSlowmodeChannels) {
                    try {
                        const parsed = JSON.parse(settings.adaptiveSlowmodeChannels);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            channelListText = parsed.map(id => `<#${id}>`).join(' ');
                        }
                    } catch (_) {}
                }

                embed.setTitle('⏱️ Adaptive Slowmode & AI Velocity Defense')
                    .setDescription(
                        'Dynamically regulate channel slowmode based on real-time message velocity and AI pattern detection.\n\n' +
                        '• **AI Intelligence:** Analyzes message floods, copy-paste repetition, and sudden chatter surges even when staff are active.\n' +
                        '• **0-Second Floor (0 = Off):** Slowmode decays smoothly down to 0s when chat cools down.\n' +
                        '• **Active Rate Limits:** The bot actively modifies channel rate limits in real-time.'
                    )
                    .addFields(
                        { name: 'Status', value: isEnabled ? '🟢 **Enabled**' : '🔴 **Disabled**', inline: true },
                        { name: 'AI Defense', value: isAiEnabled ? '🧠 **AI Enhanced**' : '⚪ **Standard Heuristic**', inline: true },
                        { name: 'Lowest Rate Limit', value: `\`${floorSec}s\` (${floorSec === 0 ? '0 = Off' : 'Active floor'})`, inline: true },
                        { name: 'Tiers (Small / Large / Surge)', value: `\`${settings.adaptiveSlowmodeSmallSec ?? 3}s\` / \`${settings.adaptiveSlowmodeLargeSec ?? 6}s\` / \`${settings.adaptiveSlowmodeSurgeSec ?? 10}s\``, inline: true },
                        { name: 'Thresholds', value: `\`${settings.adaptiveSlowmodeSmallThreshold ?? 3}\` / \`${settings.adaptiveSlowmodeLargeThreshold ?? 7}\` / \`${settings.adaptiveSlowmodeSurgeThreshold ?? 13}\` msgs/10s`, inline: true },
                        { name: 'Decay Timer', value: `\`${settings.adaptiveSlowmodeDecaySec ?? 20}s\` quiet chat`, inline: true },
                        { name: 'Monitored Channels', value: channelListText, inline: false }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('action_adaptiveslowmode_toggle')
                        .setLabel(isEnabled ? 'Disable Adaptive Slowmode' : 'Enable Adaptive Slowmode')
                        .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('action_adaptiveslowmode_ai_toggle')
                        .setLabel(isAiEnabled ? 'AI Velocity: Active' : 'AI Velocity: Off')
                        .setStyle(isAiEnabled ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('action_adaptiveslowmode_notify_toggle')
                        .setLabel(settings.adaptiveSlowmodeNotify ? 'Chat Notices: ON' : 'Chat Notices: OFF')
                        .setStyle(ButtonStyle.Secondary)
                );

                const rowB = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('action_adaptiveslowmode_sensitivity')
                        .setPlaceholder('Choose Sensitivity Preset...')
                        .addOptions([
                            { label: 'Strict (Triggers quickly at 2 msgs/10s)', value: 'strict' },
                            { label: 'Balanced (Recommended: 3 msgs/10s)', value: 'balanced', default: true },
                            { label: 'Casual (Tolerant: 5 msgs/10s)', value: 'casual' }
                        ])
                );

                const rowC = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('action_adaptiveslowmode_channels')
                        .setPlaceholder('Set Monitored Channels (Leave empty for server-wide)...')
                        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setMinValues(0)
                        .setMaxValues(10)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
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

                // Welcomer, Goodbye & Auto-Roles
                if (i.customId === 'action_welcomer_toggle') { settings.welcomerEnabled = !settings.welcomerEnabled; update = true; }
                if (i.customId === 'action_welcomedm_toggle') { settings.welcomeDmEnabled = !settings.welcomeDmEnabled; update = true; }
                if (i.customId === 'action_welcome_channel') { settings.welcomeChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_goodbye_toggle') { settings.goodbyeEnabled = !settings.goodbyeEnabled; update = true; }
                if (i.customId === 'action_goodbyedm_toggle') { settings.goodbyeDmEnabled = !settings.goodbyeDmEnabled; update = true; }
                if (i.customId === 'action_goodbye_channel') { settings.goodbyeChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_welcome_role') {
                    const isPremium = settings.isPremium === true || settings.isManualPremium === true;
                    const maxRoles = isPremium ? 5 : 3;
                    const chosen = i.values.slice(0, maxRoles);
                    settings.welcomeRoleId = chosen.length > 0 ? chosen.join(',') : null;
                    update = true;
                }

                // Leveling
                if (i.customId === 'action_leveling_toggle') { settings.levelingEnabled = !settings.levelingEnabled; update = true; }
                if (i.customId === 'action_levelalert_toggle') { settings.levelUpNotificationsEnabled = !settings.levelUpNotificationsEnabled; update = true; }
                if (i.customId === 'action_leveldm_toggle') { settings.levelUpDmEnabled = !settings.levelUpDmEnabled; update = true; }
                if (i.customId === 'action_rolestack_toggle') { settings.roleRewardsStack = settings.roleRewardsStack !== false ? false : true; update = true; }
                if (i.customId === 'action_leveling_cooldown') { settings.levelingCooldownSec = parseInt(i.values[0], 10); update = true; }
                if (i.customId === 'action_levelalert_channel') { settings.levelUpChannelId = i.values[0]; update = true; }

                // Games & AFK
                if (i.customId === 'action_afk_toggle') { settings.afkEnabled = settings.afkEnabled !== false ? false : true; update = true; }
                if (i.customId === 'action_onewordstory_toggle') { settings.oneWordStoryEnabled = !settings.oneWordStoryEnabled; update = true; }
                if (i.customId === 'action_starboard_toggle') { settings.starboardEnabled = !settings.starboardEnabled; update = true; }
                if (i.customId === 'action_starboard_selfstar') { settings.starboardSelfStar = !settings.starboardSelfStar; update = true; }
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
                    } else if (selectedCategory === 'moderation') {
                        settings.modLogChannelId = targetChannelId;
                    } else if (selectedCategory === 'verify') {
                        settings.verificationLogChannelId = targetChannelId;
                    } else if (selectedCategory === 'tickets') {
                        settings.ticketLogChannelId = targetChannelId;
                    } else if (selectedCategory === 'boosts') {
                        settings.boostChannelId = targetChannelId;
                    }

                    let currentMap = {};
                    if (typeof settings.loggingChannels === 'object' && settings.loggingChannels !== null) {
                        currentMap = { ...settings.loggingChannels };
                    } else if (typeof settings.loggingChannels === 'string') {
                        try { currentMap = JSON.parse(settings.loggingChannels); } catch(e) { currentMap = {}; }
                    }
                    currentMap[selectedCategory] = targetChannelId;
                    settings.loggingChannels = currentMap;
                    if (typeof settings.changed === 'function') settings.changed('loggingChannels', true);

                    update = true;
                }
                if (i.customId === 'action_log_toggle') {
                    const values = i.values;
                    const logFields = [
                        'logMemberJoins', 'logMemberLeaves', 'logMessageEdits', 'logMessageDeletes',
                        'logAutomod', 'logChannelEdits', 'logVoiceJoins', 'logMemberBoosts',
                        'logCommands', 'logRoleEvents'
                    ];
                    for (const field of logFields) {
                        settings[field] = values.includes(field);
                    }
                    update = true;
                }

                // Verification & Gatekeeper
                if (i.customId === 'action_verify_type') { settings.verificationType = i.values[0]; update = true; }
                if (i.customId === 'action_verify_channel') { settings.verifyChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_verify_role') {
                    const isPremium = settings.isPremium === true || settings.isManualPremium === true;
                    const maxRoles = isPremium ? 5 : 3;
                    const chosen = i.values.slice(0, maxRoles);
                    settings.verifyRoleId = chosen.length > 0 ? chosen.join(',') : null;
                    update = true;
                }
                if (i.customId === 'action_unverified_role') {
                    settings.unverifiedRoleId = i.values.length > 0 ? i.values[0] : null;
                    update = true;
                }
                if (i.customId === 'action_remove_unverified_toggle') {
                    settings.removeUnverifiedRoleOnVerify = settings.removeUnverifiedRoleOnVerify === false ? true : false;
                    update = true;
                }
                if (i.customId === 'action_roblox_toggle') { settings.robloxVerifyEnabled = !settings.robloxVerifyEnabled; update = true; }
                if (i.customId === 'view_verify_security') { state.currentView = 'view_verify_security'; update = true; }
                if (i.customId === 'view_verify_back') { state.currentView = 'view_verify'; update = true; }
                if (i.customId === 'action_verify_security_toggle') {
                    settings.verificationSecurityCheck = settings.verificationSecurityCheck === false ? true : false;
                    update = true;
                }
                if (i.customId === 'action_verify_online_toggle') {
                    settings.verifyCheckOnlineThreats = settings.verifyCheckOnlineThreats === false ? true : false;
                    update = true;
                }
                if (i.customId === 'action_verify_banevasion_toggle') {
                    settings.verifyCheckBanEvasion = settings.verifyCheckBanEvasion === false ? true : false;
                    update = true;
                }
                if (i.customId === 'action_verify_action_select') {
                    settings.verifyActionOnFlagged = i.values[0];
                    update = true;
                }

                if (i.customId === 'action_verify_spawn_active' || i.customId.startsWith('action_verify_spawn')) {
                    if (!settings.verifyRoleId) return i.reply({ content: '⚠️ You must configure at least one **Verified Role** in the dropdown first!', ephemeral: true });
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
                        return i.reply({ content: `✅ **${typeNames[spawnType] || spawnType.toUpperCase()}** verification panel deployed in <#${channel.id}>!`, ephemeral: true });
                    } catch (spawnErr) {
                        console.error('Verification panel spawn error:', spawnErr);
                        return i.reply({ content: `⚠️ Failed to spawn panel: ${spawnErr.message}`, ephemeral: true });
                    }
                }

                if (i.customId === 'action_verify_customize_modal') {
                    const modal = new ModalBuilder()
                        .setCustomId('modal_verify_customize')
                        .setTitle('Verification Embed Customizer');

                    const titleInput = new TextInputBuilder()
                        .setCustomId('verify_embed_title')
                        .setLabel('Embed Title')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                        .setMaxLength(256)
                        .setValue(settings.verifyEmbedTitle || 'Server Verification Required');

                    const descInput = new TextInputBuilder()
                        .setCustomId('verify_embed_desc')
                        .setLabel('Embed Description')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(false)
                        .setMaxLength(1000)
                        .setValue(settings.verifyEmbedDesc || 'To gain full access to the server, please verify that you are human.\n\nClick the button below to complete verification.');

                    const colorInput = new TextInputBuilder()
                        .setCustomId('verify_embed_color')
                        .setLabel('Accent Hex Color (e.g. #5865F2)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                        .setMaxLength(7)
                        .setValue(settings.verifyEmbedColor || '#5865F2');

                    const labelInput = new TextInputBuilder()
                        .setCustomId('verify_btn_label')
                        .setLabel('Button Label')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                        .setMaxLength(80)
                        .setValue(settings.verifyBtnLabel || 'Verify Account');

                    const emojiInput = new TextInputBuilder()
                        .setCustomId('verify_btn_emoji')
                        .setLabel('Button Emoji')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                        .setMaxLength(16)
                        .setValue(settings.verifyBtnEmoji || '🔒');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(titleInput),
                        new ActionRowBuilder().addComponents(descInput),
                        new ActionRowBuilder().addComponents(colorInput),
                        new ActionRowBuilder().addComponents(labelInput),
                        new ActionRowBuilder().addComponents(emojiInput)
                    );

                    await i.showModal(modal);

                    let submitted;
                    try {
                        submitted = await i.awaitModalSubmit({
                            time: 300000,
                            filter: x => x.user.id === interaction.user.id && x.customId === 'modal_verify_customize'
                        });
                    } catch (e) {
                        return;
                    }

                    const newTitle = submitted.fields.getTextInputValue('verify_embed_title')?.trim();
                    const newDesc = submitted.fields.getTextInputValue('verify_embed_desc')?.trim();
                    const newColor = submitted.fields.getTextInputValue('verify_embed_color')?.trim();
                    const newLabel = submitted.fields.getTextInputValue('verify_btn_label')?.trim();
                    const newEmoji = submitted.fields.getTextInputValue('verify_btn_emoji')?.trim();

                    if (newTitle) settings.verifyEmbedTitle = newTitle;
                    if (newDesc) settings.verifyEmbedDesc = newDesc;
                    if (newColor && /^#[0-9A-Fa-f]{6}$/.test(newColor)) settings.verifyEmbedColor = newColor;
                    if (newLabel) settings.verifyBtnLabel = newLabel;
                    if (newEmoji) settings.verifyBtnEmoji = newEmoji;

                    await settings.save();
                    settingsCache.invalidate(interaction.guild.id);

                    await submitted.deferUpdate().catch(() => {});
                    return targetMessage.edit(buildDashboard('view_verify')).catch(() => {});
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
                if (i.customId === 'action_ticket_deploy_panel' || i.customId === 'action_ticket_spawn') {
                    const ticketsEngine = require('../../bot/engines/tickets');
                    const targetChannelId = settings.ticketChannelId || i.channel.id;
                    const channel = i.guild.channels.cache.get(targetChannelId) || i.channel;
                    try {
                        await ticketsEngine.sendTicketPanel(channel, {
                            title: settings.ticketPanelTitle || 'Support & Assistance Hub',
                            description: settings.ticketPanelDesc || 'Need help or want to contact server staff? Select a topic below to open a private, dedicated support ticket.'
                        });
                        return i.reply({ content: `Ticket panel deployed in <#${channel.id}>!`, ephemeral: true });
                    } catch (spawnErr) {
                        return i.reply({ content: `Failed to deploy ticket panel: ${spawnErr.message}`, ephemeral: true });
                    }
                }

                // Self Roles & AI Management
                if (i.customId === 'action_ai_pref') { settings.aiPreference = i.values[0]; update = true; }
                if (i.customId === 'action_ai_autochannel') {
                    settings.aiAutoRespondChannelId = i.values[0];
                    settings.aiAutoRespondEnabled = true;
                    update = true;
                }
                if (i.customId === 'action_ai_autotoggle') {
                    settings.aiAutoRespondEnabled = settings.aiAutoRespondEnabled !== false ? false : true;
                    update = true;
                }
                if (i.customId === 'action_ai_autoclear') {
                    settings.aiAutoRespondChannelId = null;
                    settings.aiAutoRespondEnabled = false;
                    update = true;
                }

                // Moderation Actions & Enforcement
                if (i.customId === 'action_modlog_channel') {
                    settings.modLogChannelId = i.values.length > 0 ? i.values[0] : null;
                    update = true;
                }
                if (i.customId === 'action_moddms_toggle') {
                    settings.sendModDms = settings.sendModDms === false ? true : false;
                    update = true;
                }

                // Roku Smart TV Controls (Whitelisted headquarters servers only)
                if (i.customId.startsWith('action_roku_')) {
                    const WHITELISTED_ROKU_GUILDS = ['1487342521133830174', '1515800329889779954'];
                    if (!WHITELISTED_ROKU_GUILDS.includes(i.guildId)) {
                        return i.reply({ content: '🔒 Roku Smart TV integration is only available in authorized headquarters servers (`1487342521133830174`, `1515800329889779954`).', ephemeral: true });
                    }
                    let rokuController = null;
                    try { rokuController = require('../../utils/rokuController'); } catch (e) {}
                    if (!rokuController) {
                        return i.reply({ content: '❌ Roku hardware integration module is currently disabled or offline.', ephemeral: true });
                    }
                    if (i.customId === 'action_roku_help') {
                        const guide = rokuController.getTvHelpGuide();
                        return i.reply({ content: rokuController.sanitizeMessage(guide), ephemeral: true });
                    }
                    if (!rokuController.isAuthorized(i.user.id)) {
                        return i.reply({ content: '🔒 Access Denied: You must be granted guest access to control the Roku TV.', ephemeral: true });
                    }

                    const rokuActionMap = {
                        'action_roku_power': 'POWER_TOGGLE',
                        'action_roku_home': 'HOME',
                        'action_roku_play': 'PLAY',
                        'action_roku_volup': 'VOLUME_UP',
                        'action_roku_voldown': 'VOLUME_DOWN',
                        'action_roku_mute': 'MUTE',
                        'action_roku_restart': 'RESTART'
                    };
                    const act = rokuActionMap[i.customId];
                    if (act) {
                        await i.deferReply({ ephemeral: true });
                        const res = await rokuController._executeRokuAction(i.user, act, {});
                        const sanitized = rokuController.sanitizeMessage(res?.message || 'Command sent to TV.');
                        return i.editReply({ content: sanitized });
                    }
                }

                // Adaptive Slowmode & AI Velocity Defense
                if (i.customId === 'action_adaptiveslowmode_toggle') {
                    settings.adaptiveSlowmodeEnabled = !settings.adaptiveSlowmodeEnabled;
                    update = true;
                }
                if (i.customId === 'action_adaptiveslowmode_ai_toggle') {
                    settings.adaptiveSlowmodeAiEnabled = settings.adaptiveSlowmodeAiEnabled === false ? true : false;
                    update = true;
                }
                if (i.customId === 'action_adaptiveslowmode_notify_toggle') {
                    settings.adaptiveSlowmodeNotify = !settings.adaptiveSlowmodeNotify;
                    update = true;
                }
                if (i.customId === 'action_adaptiveslowmode_sensitivity') {
                    const preset = i.values[0];
                    if (preset === 'strict') {
                        settings.adaptiveSlowmodeSmallThreshold = 2;
                        settings.adaptiveSlowmodeLargeThreshold = 5;
                        settings.adaptiveSlowmodeSurgeThreshold = 9;
                    } else if (preset === 'casual') {
                        settings.adaptiveSlowmodeSmallThreshold = 5;
                        settings.adaptiveSlowmodeLargeThreshold = 10;
                        settings.adaptiveSlowmodeSurgeThreshold = 18;
                    } else {
                        settings.adaptiveSlowmodeSmallThreshold = 3;
                        settings.adaptiveSlowmodeLargeThreshold = 7;
                        settings.adaptiveSlowmodeSurgeThreshold = 13;
                    }
                    update = true;
                }
                if (i.customId === 'action_adaptiveslowmode_channels') {
                    settings.adaptiveSlowmodeChannels = JSON.stringify(i.values || []);
                    update = true;
                }
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
