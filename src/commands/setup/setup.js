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
            sub.setName('adaptiveslowmode')
                .setDescription('Configure automatic chat pacing with Adaptive Slowmode.')),

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
            pendingStarboardRole: null,
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
                const { parseRoleIds } = require('../../utils/roleUtils');
                const autoRoles = parseRoleIds(settings.welcomeRoleId);
                const verifyRoles = parseRoleIds(settings.verifyRoleId);

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
                        { label: 'Community Games Hub', value: 'view_games', description: 'Overview of Counting, Starboard, Story, and AFK' },
                        { label: '⭐ Starboard & Role Rewards', value: 'view_starboard', description: 'Star thresholds, destination channel, and milestone role rewards' },
                        { label: '🔢 Counting & Top Counter Role', value: 'view_counting', description: 'Sequential counting streak and dynamic top counter role award' },
                        { label: '📖 One Word Story Game', value: 'view_onewordstory', description: 'Collaborative story game and continuous auto-start setting' },
                        { label: '💤 AFK System & AFK Role', value: 'view_afk', description: 'AFK module, presets, and temporary AFK role assignment' },
                        { label: 'Member Verification', value: 'view_verify', description: 'Human CAPTCHA gate, 1-click button, reaction, and Roblox sync' },
                        { label: '🛡️ Verification Threat Gatekeeper', value: 'view_verify_security', description: 'Automated background risk screening, online threat intel, ban evasion matching' },
                        { label: 'Support Ticket System', value: 'view_tickets', description: 'Private staff ticket categories, panels, and transcripts' },
                        { label: 'Nora AI & Image Generation', value: 'view_ai', description: 'Configure Gemini models, auto-chat channel, and Google Image Gen' },
                        { label: 'Adaptive Slowmode', value: 'view_adaptiveslowmode', description: 'Automatic chat pacing and anti-flood protection' },
                        { label: 'Self Roles & Feeds', value: 'view_utility', description: 'Interactive button role panels and YouTube feeds' }
                    ]);

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
                        { name: 'Raid Detection Action', value: `\`${settings.antiRaidAction || 'notify'}\``, inline: true },
                        { name: 'Quarantine Role', value: settings.quarantineRoleId ? `<@&${settings.quarantineRoleId}>` : '*Not Set*', inline: true }
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

                const rowD = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('action_quarantine_role')
                        .setPlaceholder('Select Quarantine / Isolation Role...')
                        .setMinValues(0)
                        .setMaxValues(1)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
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
                const { parseRoleIds } = require('../../utils/roleUtils');
                const currentRoles = parseRoleIds(settings.welcomeRoleId);

                const welcomeTypeLabel = settings.welcomeType === 'text' ? '💬 Normal Text' : (settings.welcomeType === 'embed' ? '📑 Rich Embed' : '🖼️ Liquid Glass Card');
                const goodbyeTypeLabel = settings.goodbyeType === 'text' ? '💬 Normal Text' : (settings.goodbyeType === 'embed' ? '📑 Rich Embed' : '🖼️ Liquid Glass Card');

                const welcomeBtnLabel = settings.welcomeType === 'text' ? 'Join: 💬 Text' : (settings.welcomeType === 'embed' ? 'Join: 📑 Embed' : 'Join: 🖼️ Image');
                const goodbyeBtnLabel = settings.goodbyeType === 'text' ? 'Exit: 💬 Text' : (settings.goodbyeType === 'embed' ? 'Exit: 📑 Embed' : 'Exit: 🖼️ Image');

                embed.setTitle('Welcomer & Goodbye Configuration Suite')
                    .setDescription(
                        `Configure dedicated welcome cards, goodbye announcements, delivery formats, and auto-roles.\n` +
                        `Choose between **Liquid Glass Image Cards**, **Rich Embeds**, or **Normal Text Messages**.`
                    )
                    .addFields(
                        { name: 'Welcome System', value: settings.welcomerEnabled ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: 'Welcome Format', value: `**${welcomeTypeLabel}**`, inline: true },
                        { name: 'Welcome Channel', value: settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : '*None*', inline: true },
                        { name: 'Goodbye System', value: settings.goodbyeEnabled ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: 'Goodbye Format', value: `**${goodbyeTypeLabel}**`, inline: true },
                        { name: 'Goodbye Channel', value: settings.goodbyeChannelId ? `<#${settings.goodbyeChannelId}>` : (settings.welcomeChannelId ? `<#${settings.welcomeChannelId}> *(Fallback)*` : '*None*'), inline: true },
                        { name: 'Join DM Alert', value: settings.welcomeDmEnabled ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: 'Leave DM Alert', value: settings.goodbyeDmEnabled ? '**Enabled**' : '**Disabled**', inline: true },
                        { name: `Starter Auto-Roles (${currentRoles.length}/${maxAutoRoles})`, value: currentRoles.length > 0 ? currentRoles.map(id => `<@&${id}>`).join(' ') : '*None*', inline: true },
                        { name: 'Quarantine Role', value: settings.unverifiedRoleId ? `<@&${settings.unverifiedRoleId}>` : '*None*', inline: true },
                        { name: 'Tier Status', value: isPremium ? '**Studio Plus (5 Roles Max)**' : '**Free Tier (3 Roles Max)**', inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_welcomer_toggle').setLabel(settings.welcomerEnabled ? 'Disable Welcome' : 'Enable Welcome').setStyle(settings.welcomerEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_welcome_format').setLabel(welcomeBtnLabel).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('action_goodbye_toggle').setLabel(settings.goodbyeEnabled ? 'Disable Goodbye' : 'Enable Goodbye').setStyle(settings.goodbyeEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_goodbye_format').setLabel(goodbyeBtnLabel).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('action_welcomedm_toggle').setLabel(settings.welcomeDmEnabled ? 'Join DM: ON' : 'Join DM: OFF').setStyle(settings.welcomeDmEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
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
                        { name: 'AI Enhance', value: (settings.noraAiEnabled !== false && settings.levelingAiEnabled !== false) ? '✨ **Active**' : '❌ **Disabled**', inline: true },
                        { name: 'Rank Card Avatars', value: settings.levelingPfpEnabled !== false ? '**Shown**' : '**Hidden**', inline: true },
                        { name: 'Role Stacking', value: settings.roleRewardsStack !== false ? '**Stacking**' : '**Highest Only**', inline: true },
                        { name: 'Tier Status', value: isPremium ? '**Studio Plus** (Up to 10x XP & 25 Roles)' : '**Free Tier** (Up to 2x XP & 5 Roles)', inline: true }
                    );

                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_leveling_toggle').setLabel(settings.levelingEnabled ? 'Disable Leveling' : 'Enable Leveling').setStyle(settings.levelingEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_levelalert_toggle').setLabel(settings.levelUpNotificationsEnabled !== false ? 'Disable Alerts' : 'Enable Alerts').setStyle(settings.levelUpNotificationsEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_leveldm_toggle').setLabel(settings.levelUpDmEnabled ? 'Disable DM Alerts' : 'Enable DM Alerts').setStyle(settings.levelUpDmEnabled ? ButtonStyle.Danger : ButtonStyle.Secondary)
                );

                const rowA2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_leveling_ai_toggle').setLabel(settings.levelingAiEnabled !== false ? 'AI Enhance: ON' : 'AI Enhance: OFF').setStyle(settings.levelingAiEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_rolestack_toggle').setLabel(settings.roleRewardsStack !== false ? 'Stack Roles: ON' : 'Stack Roles: OFF').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_levelpfp_toggle').setLabel(settings.levelingPfpEnabled !== false ? 'Card Avatars: ON' : 'Card Avatars: OFF').setStyle(settings.levelingPfpEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
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

                return { embeds: [embed], components: [rowA, rowA2, rowB, rowC, backRow] };
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
                const starboardRewardsCount = (() => {
                    try {
                        const r = JSON.parse(settings.starboardRoleRewards || '[]');
                        return Array.isArray(r) && r.length > 0 ? `**${r.length} reward(s)**` : '*None*';
                    } catch (_) { return '*None*'; }
                })();

                embed.setTitle('Community Games, Starboard & AFK')
                    .setDescription('Configure interactive server games, dynamic role rewards, and AFK roles. Click any module below for deep configuration.')
                    .addFields(
                        { name: 'AFK System', value: settings.afkEnabled !== false ? `🟢 **Enabled** (${settings.afkRoleId ? `<@&${settings.afkRoleId}>` : '*No Role*'})` : '🔴 **Disabled**', inline: true },
                        { name: 'Counting Game', value: settings.countingChannelId ? `🟢 <#${settings.countingChannelId}> (${settings.countingTopCounterRoleId ? `<@&${settings.countingTopCounterRoleId}>` : '*No Top Role*'})` : '🔴 **Disabled**', inline: true },
                        { name: 'One Word Story', value: settings.oneWordStoryEnabled !== false ? (settings.oneWordStoryAlwaysAutoStart ? '🟢 **Always Auto-Start**' : '🟢 **Manual Commands**') : '🔴 **Disabled**', inline: true },
                        { name: 'Starboard', value: settings.starboardEnabled ? `<#${settings.starboardChannelId || 'Unset'}> (${settings.starboardThreshold || 3}⭐)` : '🔴 **Disabled**', inline: true },
                        { name: 'Starboard Role Rewards', value: starboardRewardsCount, inline: true },
                        { name: 'Self-Star Policy', value: settings.starboardSelfStar ? '**Allowed**' : '**Blocked**', inline: true }
                    );

                const rowNav = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_goto_starboard').setLabel('⭐ Starboard & Rewards').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('action_goto_counting').setLabel('🔢 Counting & Top Role').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('action_goto_onewordstory').setLabel('📖 One Word Story').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('action_goto_afk').setLabel('💤 AFK & Role').setStyle(ButtonStyle.Primary)
                );

                const rowToggles = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_afk_toggle').setLabel(settings.afkEnabled !== false ? 'Disable AFK' : 'Enable AFK').setStyle(settings.afkEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_story_autostart_toggle').setLabel(settings.oneWordStoryAlwaysAutoStart ? 'Story Auto-Start: ON' : 'Story Auto-Start: OFF').setStyle(settings.oneWordStoryAlwaysAutoStart ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_starboard_toggle').setLabel(settings.starboardEnabled ? 'Disable Starboard' : 'Enable Starboard').setStyle(settings.starboardEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_starboard_selfstar').setLabel(settings.starboardSelfStar ? 'Self-Star: On' : 'Self-Star: Off').setStyle(ButtonStyle.Secondary)
                );

                const rowAfkRole = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_afk_role').setPlaceholder('Quick Select AFK Role (Assigned when AFK, removed on return)...').setMinValues(0).setMaxValues(1)
                );

                const rowCountingRole = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_counting_top_role').setPlaceholder('Quick Select Top Counter Role (Awarded to #1 counter)...').setMinValues(0).setMaxValues(1)
                );

                return { embeds: [embed], components: [rowNav, rowToggles, rowAfkRole, rowCountingRole, backRow] };
            }

            // ==========================================
            // ⭐ STARBOARD & ROLE REWARDS
            // ==========================================
            if (viewName === 'view_starboard') {
                const rewards = (() => {
                    try {
                        const r = JSON.parse(settings.starboardRoleRewards || '[]');
                        return Array.isArray(r) ? r : [];
                    } catch (_) { return []; }
                })();

                let rewardsListStr = '*No role rewards configured. Select a role and condition below to add one!*';
                if (rewards.length > 0) {
                    rewardsListStr = rewards.map((rew, idx) => {
                        const condLabel = rew.condition === 'times_starboarded' 
                            ? `🏆 ${rew.threshold} Times Starboarded`
                            : (rew.condition === 'single_message_stars' 
                                ? `🌟 ${rew.threshold} Stars on Single Post` 
                                : `⭐ ${rew.threshold} Total Stars`);
                        return `**${idx + 1}.** <@&${rew.roleId}> — Requires: \`${condLabel}\``;
                    }).join('\n');
                }

                embed.setTitle('⭐ Starboard & Role Rewards Configuration')
                    .setDescription('Configure starboard destination channel, star reaction thresholds, and automatic role rewards earned by top contributors.')
                    .addFields(
                        { name: 'Starboard Status', value: settings.starboardEnabled ? '🟢 **Enabled**' : '🔴 **Disabled**', inline: true },
                        { name: 'Starboard Channel', value: settings.starboardChannelId ? `<#${settings.starboardChannelId}>` : '*None (Disabled)*', inline: true },
                        { name: 'Threshold', value: `⭐ **${settings.starboardThreshold || 3} Stars**`, inline: true },
                        { name: 'AI Spotlight', value: (settings.noraAiEnabled !== false && settings.starboardAiEnabled !== false) ? '✨ **Active**' : '❌ **Disabled**', inline: true },
                        { name: 'Self-Star Policy', value: settings.starboardSelfStar ? '**Allowed**' : '**Blocked (Fair Play)**', inline: true },
                        { name: 'Starboard XP Reward', value: `**+${settings.starboardAuthorRewardXp !== undefined ? settings.starboardAuthorRewardXp : 25} XP**`, inline: true },
                        { name: `Configured Role Rewards (${rewards.length}/20)`, value: rewardsListStr, inline: false }
                    );

                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_starboard_toggle').setLabel(settings.starboardEnabled ? 'Disable Starboard' : 'Enable Starboard').setStyle(settings.starboardEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_starboard_ai_toggle').setLabel(settings.starboardAiEnabled !== false ? 'AI Spotlight: ON' : 'AI Spotlight: OFF').setStyle(settings.starboardAiEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_starboard_selfstar').setLabel(settings.starboardSelfStar ? 'Self-Star: ON' : 'Self-Star: OFF').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_starboard_clear_rewards').setLabel('Clear All Role Rewards').setStyle(ButtonStyle.Danger).setDisabled(rewards.length === 0),
                    new ButtonBuilder().setCustomId('view_games').setLabel('Games Hub').setStyle(ButtonStyle.Secondary)
                );

                const row2 = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_starboard_channel').setPlaceholder('Select Starboard Destination Channel...').setChannelTypes(ChannelType.GuildText)
                );

                const row3 = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_starboard_reward_role').setPlaceholder('Step 1: Select Role to Award for Starboard Milestones...').setMinValues(0).setMaxValues(1)
                );

                const isRoleSelected = Boolean(state.pendingStarboardRole);
                const row4 = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_starboard_add_reward').setPlaceholder(isRoleSelected ? `Step 2: Choose Milestone for selected role...` : 'Step 2: (Select a role in Step 1 first)').addOptions([
                        { label: '⭐ Earn 10 Total Stars', value: 'total_stars:10', description: 'Award role when author accumulates 10 total stars' },
                        { label: '⭐ Earn 25 Total Stars', value: 'total_stars:25', description: 'Award role when author accumulates 25 total stars' },
                        { label: '⭐ Earn 50 Total Stars', value: 'total_stars:50', description: 'Award role when author accumulates 50 total stars' },
                        { label: '⭐ Earn 100 Total Stars', value: 'total_stars:100', description: 'Award role when author accumulates 100 total stars' },
                        { label: '🏆 Starboarded 5 Times', value: 'times_starboarded:5', description: 'Award role when author has 5 messages posted to starboard' },
                        { label: '🏆 Starboarded 10 Times', value: 'times_starboarded:10', description: 'Award role when author has 10 messages posted to starboard' },
                        { label: '🏆 Starboarded 25 Times', value: 'times_starboarded:25', description: 'Award role when author has 25 messages posted to starboard' },
                        { label: '🌟 Single Post Hits 10 Stars', value: 'single_message_stars:10', description: 'Award role for a single viral post reaching 10 stars' },
                        { label: '🌟 Single Post Hits 25 Stars', value: 'single_message_stars:25', description: 'Award role for a single viral post reaching 25 stars' }
                    ]).setDisabled(!isRoleSelected)
                );

                return { embeds: [embed], components: [row1, row2, row3, row4, backRow] };
            }

            // ==========================================
            // 🔢 SEQUENTIAL COUNTING & FAIL / TOP ROLES
            // ==========================================
            if (viewName === 'view_counting') {
                const failThreshold = settings.countingFailThreshold || 1;
                embed.setTitle('🔢 Sequential Counting Game & Fail / Top Roles')
                    .setDescription('Members count upward one number at a time without breaking sequence. Features sandboxed math expressions, formatting edit allowances, dynamic top counter leader roles, and automated fail role penalties.')
                    .addFields(
                        { name: 'Counting Channel', value: settings.countingChannelId ? `<#${settings.countingChannelId}>` : '*Disabled*', inline: true },
                        { name: 'Top Counter Role Reward', value: settings.countingTopCounterRoleId ? `<@&${settings.countingTopCounterRoleId}>` : '*None configured*', inline: true },
                        { name: 'Counting Fail Role', value: settings.countingFailRoleId ? `<@&${settings.countingFailRoleId}>` : '*None (Disabled)*', inline: true },
                        { name: 'Fail Limit / Threshold', value: `**${failThreshold}** fail(s) before role assigned`, inline: true },
                        { name: 'Fail Role Policy', value: 'Automatically assigned when a member exceeds the fail limit (e.g. Counting Blacklist or Mute role). When someone fails, the count resets to 0 and their personal score is wiped.', inline: false }
                    );

                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_counting_clear_top_role').setLabel('Clear Top Role').setStyle(ButtonStyle.Danger).setDisabled(!settings.countingTopCounterRoleId),
                    new ButtonBuilder().setCustomId('action_counting_clear_fail_role').setLabel('Clear Fail Role').setStyle(ButtonStyle.Danger).setDisabled(!settings.countingFailRoleId),
                    new ButtonBuilder().setCustomId('action_counting_cycle_threshold').setLabel(`Fail Limit: ${failThreshold} fail${failThreshold > 1 ? 's' : ''}`).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('view_games').setLabel('Games Hub').setStyle(ButtonStyle.Secondary)
                );

                const row2 = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_counting_channel').setPlaceholder('Select / Change Counting Channel...').setChannelTypes(ChannelType.GuildText)
                );

                const row3 = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_counting_top_role').setPlaceholder('Select Top Counter Role (Awarded to #1 counter)...').setMinValues(0).setMaxValues(1)
                );

                const row4 = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_counting_fail_role').setPlaceholder('Select Fail Role (Assigned to users who fail count, e.g. Blacklist)...').setMinValues(0).setMaxValues(1)
                );

                return { embeds: [embed], components: [row1, row2, row3, row4, backRow] };
            }

            // ==========================================
            // 📖 ONE WORD STORY GAME
            // ==========================================
            if (viewName === 'view_onewordstory') {
                embed.setTitle('📖 One Word Story Game Configuration')
                    .setDescription('Members build collaborative sentences one word at a time. Supports continuous auto-start so games automatically restart without manual commands.')
                    .addFields(
                        { name: 'One Word Story Game', value: settings.oneWordStoryEnabled !== false ? '🟢 **Enabled**' : '🔴 **Disabled**', inline: true },
                        { name: 'Story Channel', value: settings.oneWordStoryChannelId ? `<#${settings.oneWordStoryChannelId}>` : '*None configured*', inline: true },
                        { name: 'Continuous Auto-Start', value: settings.oneWordStoryAlwaysAutoStart ? '🟢 **ON (Always Auto-Starts New Stories)**' : '⚪ **OFF (Manual Commands Required)**', inline: true },
                        { name: 'Consecutive Words', value: settings.oneWordStoryAllowConsecutive ? '**Allowed**' : '**Blocked (Alternating members only)**', inline: true }
                    );

                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_onewordstory_toggle').setLabel(settings.oneWordStoryEnabled !== false ? 'Disable Story' : 'Enable Story').setStyle(settings.oneWordStoryEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_story_autostart_toggle').setLabel(settings.oneWordStoryAlwaysAutoStart ? 'Story Auto-Start: ON' : 'Story Auto-Start: OFF').setStyle(settings.oneWordStoryAlwaysAutoStart ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_story_consecutive_toggle').setLabel(settings.oneWordStoryAllowConsecutive ? 'Consecutive: ON' : 'Consecutive: OFF').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('view_games').setLabel('Games Hub').setStyle(ButtonStyle.Secondary)
                );

                const row2 = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('action_onewordstory_channel').setPlaceholder('Select One Word Story Channel...').setChannelTypes(ChannelType.GuildText)
                );

                return { embeds: [embed], components: [row1, row2, backRow] };
            }

            // ==========================================
            // 💤 AFK SYSTEM & AFK ROLE
            // ==========================================
            if (viewName === 'view_afk') {
                embed.setTitle('💤 AFK System & Role Assignment Configuration')
                    .setDescription('Allow members to go AFK with rich presets and durations. Assign an AFK role while away and automatically clear when they interact.')
                    .addFields(
                        { name: 'AFK System', value: settings.afkEnabled !== false ? '🟢 **Enabled**' : '🔴 **Disabled**', inline: true },
                        { name: 'AFK Role Reward', value: settings.afkRoleId ? `<@&${settings.afkRoleId}>` : '*None configured*', inline: true },
                        { name: 'Auto-Nickname', value: settings.afkAutoNickname !== false ? '🟢 **Enabled ([AFK] Prefix)**' : '⚪ **Disabled**', inline: true },
                        { name: 'Auto-Wake on Commands', value: '🟢 **Active** (Clears if user runs any command on Nora or ANY other bot/application in this server)', inline: false }
                    );

                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_afk_toggle').setLabel(settings.afkEnabled !== false ? 'Disable AFK' : 'Enable AFK').setStyle(settings.afkEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_afk_nick_toggle').setLabel(settings.afkAutoNickname !== false ? 'Auto-Nick: ON' : 'Auto-Nick: OFF').setStyle(settings.afkAutoNickname !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_afk_clear_role').setLabel('Clear AFK Role').setStyle(ButtonStyle.Danger).setDisabled(!settings.afkRoleId),
                    new ButtonBuilder().setCustomId('view_games').setLabel('Games Hub').setStyle(ButtonStyle.Secondary)
                );

                const row2 = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('action_afk_role').setPlaceholder('Select AFK Role (Assigned when AFK, stripped on return)...').setMinValues(0).setMaxValues(1)
                );

                return { embeds: [embed], components: [row1, row2, backRow] };
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
                const { parseRoleIds } = require('../../utils/roleUtils');
                const verifiedRoles = parseRoleIds(settings.verifyRoleId);

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
                const isAiEnabled = settings.noraAiEnabled !== false;
                const autoChannelText = settings.aiAutoRespondChannelId ? `<#${settings.aiAutoRespondChannelId}>` : '*None (Mentions/Replies Only)*';
                const autoRespondActive = settings.aiAutoRespondEnabled !== false && settings.aiAutoRespondChannelId;
                const currentModel = (settings.aiModel && settings.aiModel !== 'gemini-2.5-flash' && settings.aiModel !== 'gemini-2.0-flash' && settings.aiModel !== 'gemini-1.5-flash' && settings.aiModel !== 'gemini-1.5-pro') ? settings.aiModel : 'gemini-3.8-flash';
                const currentTemplate = settings.aiPromptTemplate || 'classic';

                let excludedList = '*None*';
                try {
                    const excluded = typeof settings.aiExcludedChannels === 'string' ? JSON.parse(settings.aiExcludedChannels || '[]') : (settings.aiExcludedChannels || []);
                    if (Array.isArray(excluded) && excluded.length > 0) {
                        excludedList = excluded.map(id => `<#${id}>`).join(', ');
                    }
                } catch (_) {}

                let allowedList = '*All Channels (Default)*';
                try {
                    const allowed = typeof settings.aiAllowedChannels === 'string' ? JSON.parse(settings.aiAllowedChannels || '[]') : (settings.aiAllowedChannels || []);
                    if (Array.isArray(allowed) && allowed.length > 0) {
                        allowedList = allowed.map(id => `<#${id}>`).join(', ');
                    }
                } catch (_) {}

                const isImageGenActive = settings.aiImageGenerationEnabled !== false;
                const privacyFlags = [
                    `Memory: ${settings.aiMemoryEnabled !== false ? '🟢 **ON**' : '⚪ **OFF**'}`,
                    `Roles: ${settings.aiRoleViewingEnabled !== false ? '🟢 **ON**' : '⚪ **OFF**'}`,
                    `Names: ${settings.aiNameViewingEnabled !== false ? '🟢 **ON**' : '⚪ **OFF**'}`,
                    `Google Image Gen: ${isImageGenActive ? '🟢 **ON**' : '🔴 **OFF**'}`
                ].join(' • ');

                embed.setTitle('🧠 Nora AI Management & Intelligence Studio')
                    .setDescription(
                        'Full control over Nora AI behavior, Google Gemini model selection, personality templates, channel routing, and safe Google image generation.\n\n' +
                        '• **Google Gemini & Image Gen:** Powered strictly by official Google models with strict cloud safety filtering.\n' +
                        '• **Channel Control:** Dedicated auto-respond channel requires zero pings; excluded channels stop all AI replies entirely.\n' +
                        '• **Privacy & Memory:** Toggle conversational memory, role viewing, and display name visibility anytime.'
                    )
                    .addFields(
                        { name: 'Nora AI Master Switch', value: isAiEnabled ? '🟢 **Active & Enabled**' : '🔴 **Completely Disabled**', inline: true },
                        { name: 'Google Gemini Model', value: `🧠 \`${currentModel}\``, inline: true },
                        { name: 'Google Image Gen', value: isImageGenActive ? '🟢 **Enabled (Google)**' : '🔴 **Disabled**', inline: true },
                        { name: 'Personality Template', value: `🎭 \`${currentTemplate.toUpperCase()}\``, inline: true },
                        { name: 'Dedicated Auto-Respond Channel', value: autoChannelText, inline: true },
                        { name: 'Auto-Respond Status', value: autoRespondActive ? '🟢 **Active (No Ping Required)**' : '⚪ **Inactive / Mentions Only**', inline: true },
                        { name: 'Allowed Channels', value: allowedList, inline: true },
                        { name: 'Excluded Channels (Blacklist)', value: excludedList, inline: false },
                        { name: 'Privacy & Capability Permissions', value: privacyFlags, inline: false }
                    );

                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('go_back').setLabel('Main Menu').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('action_ai_master_toggle')
                        .setLabel(isAiEnabled ? 'Disable Nora AI' : 'Enable Nora AI')
                        .setStyle(isAiEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('action_ai_autotoggle')
                        .setLabel(settings.aiAutoRespondEnabled !== false ? 'Auto-Chat: ON' : 'Auto-Chat: OFF')
                        .setStyle(settings.aiAutoRespondEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('action_ai_memory_toggle')
                        .setLabel(settings.aiMemoryEnabled !== false ? 'Memory: ON' : 'Memory: OFF')
                        .setStyle(settings.aiMemoryEnabled !== false ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('action_ai_image_toggle')
                        .setLabel(isImageGenActive ? 'Image Gen: ON' : 'Image Gen: OFF')
                        .setStyle(isImageGenActive ? ButtonStyle.Success : ButtonStyle.Danger)
                );

                const row2 = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_ai_model').setPlaceholder('Select Google Gemini Model (Google ONLY)...').addOptions([
                        { label: 'Gemini 3.8 Flash (Default & Ultra-Fast)', value: 'gemini-3.8-flash', description: 'Recommended: lowest latency, next-gen reasoning', default: currentModel === 'gemini-3.8-flash' },
                        { label: 'Gemini 3.5 Flash (Balanced Multimodal)', value: 'gemini-3.5-flash', description: 'High-speed reasoning and vision', default: currentModel === 'gemini-3.5-flash' },
                        { label: 'Gemini Flash Latest (Continuously Updated)', value: 'gemini-flash-latest', description: 'Always points to latest production flash model', default: currentModel === 'gemini-flash-latest' },
                        { label: 'Gemini Flash Lite (Ultra-Low Latency)', value: 'gemini-flash-lite-latest', description: 'Minimal quota consumption', default: currentModel === 'gemini-flash-lite-latest' }
                    ])
                );

                const row3 = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_ai_template').setPlaceholder('Select Personality Template...').addOptions([
                        { label: '✨ Classic Nora (Friendly & Witty)', value: 'classic', description: 'Supportive, friendly, warm Discord companion', default: currentTemplate === 'classic' },
                        { label: '⚖️ Balanced (Medium Blend)', value: 'balanced', description: 'Harmonious blend of friendly, helpful, witty, and calm', default: currentTemplate === 'balanced' },
                        { label: '🌊 Dynamic (Server Tone Match)', value: 'dynamic', description: 'Dynamically mirrors server tone, slang, mood, and context', default: currentTemplate === 'dynamic' },
                        { label: '💼 Helpful & Professional', value: 'professional', description: 'Concise, clear, guide and documentation assistant', default: currentTemplate === 'professional' },
                        { label: '🎭 Sarcastic & Playful Banter', value: 'sarcastic', description: 'Teasing, playful humor, witty comebacks', default: currentTemplate === 'sarcastic' },
                        { label: '🎮 Gamer & Casual', value: 'gamer', description: 'Gaming slang, hype energy, casual vibe', default: currentTemplate === 'gamer' },
                        { label: '🛡️ Server Moderator & Enforcer', value: 'moderator', description: 'Firm, rule-focused, calm de-escalation', default: currentTemplate === 'moderator' }
                    ])
                );

                const row4 = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('action_ai_autochannel')
                        .setPlaceholder('Set Dedicated Channel (No ping required)...')
                        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                );

                const row5 = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('action_ai_exclude_channel')
                        .setPlaceholder('Toggle Excluded/Blacklisted Channel (Stops Nora entirely)...')
                        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                );

                return { embeds: [embed], components: [row1, row2, row3, row4, row5] };
            }

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
                        { name: 'Quarantine Role', value: settings.quarantineRoleId ? `<@&${settings.quarantineRoleId}>` : '*Not Set*', inline: true },
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

                const rowC = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('action_quarantine_role')
                        .setPlaceholder('Select Quarantine / Isolation Role...')
                        .setMinValues(0)
                        .setMaxValues(1)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // ==========================================
            // 📺 ROKU SMART TV HARDWARE CONTROLS
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

                let ignoredRolesText = 'None (All Roles Affected)';
                if (settings.adaptiveSlowmodeIgnoredRoles) {
                    try {
                        const parsed = JSON.parse(settings.adaptiveSlowmodeIgnoredRoles);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            ignoredRolesText = parsed.map(id => `<@&${id}>`).join(' ');
                        }
                    } catch (_) {}
                }

                embed.setTitle('⏱️ Adaptive Slowmode')
                    .setDescription(
                        'Automatically slows down chat during rapid message bursts or spam raids, then gracefully restores normal chat speed when conversation calms down.\n\n' +
                        '• **0-Second Floor (0 = Off):** Slowmode automatically decays back to 0s once chat calms down.\n' +
                        '• **Automatic Chat Pacing:** Dynamically adjusts channel slowmode in real-time.\n' +
                        '• **AI Boost:** Analyzes message velocity and sudden chatter spikes even when staff are active.'
                    )
                    .addFields(
                        { name: 'Status', value: isEnabled ? '🟢 **Enabled**' : '🔴 **Disabled**', inline: true },
                        { name: 'AI Boost', value: isAiEnabled ? '🧠 **AI Enhanced**' : '⚪ **Standard Heuristic**', inline: true },
                        { name: 'Applied Slowmode', value: `\`${settings.adaptiveSlowmodeLargeSec ?? 6}s\``, inline: true },
                        { name: 'Spam Trigger Speed', value: `\`${settings.adaptiveSlowmodeSmallThreshold ?? 5} msgs/sec\``, inline: true },
                        { name: 'Cooldown Reset Time', value: `\`${settings.adaptiveSlowmodeDecaySec ?? 20}s\` quiet chat`, inline: true },
                        { name: 'Emergency Raid Cap', value: `\`${settings.adaptiveSlowmodeSurgeSec ?? 10}s\``, inline: true },
                        { name: 'Monitored Channels', value: channelListText, inline: false },
                        { name: 'Ignored Roles', value: ignoredRolesText, inline: false }
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
                            { label: '🟢 Casual (10 msgs/s)', value: 'casual', description: 'Relaxed threshold for community chats' },
                            { label: '🔵 Balanced (5 msgs/s - Recommended)', value: 'balanced', description: 'Standard protection for active servers' },
                            { label: '🟠 Strict (2 msgs/s)', value: 'strict', description: 'Fast rate-limit response for sensitive channels' },
                            { label: '🔴 Maximum (1 msg/s)', value: 'maximum', description: 'Heavy lock against aggressive token raids' }
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

                const rowD = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('action_adaptiveslowmode_roles')
                        .setPlaceholder('Set Ignored / Bypass Roles for Adaptive Slowmode...')
                        .setMinValues(0)
                        .setMaxValues(10)
                );

                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
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
                if (i.customId === 'action_quarantine_role') { settings.quarantineRoleId = i.values.length > 0 ? i.values[0] : null; update = true; }

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
                if (i.customId === 'action_welcome_format') {
                    const formats = ['image', 'embed', 'text'];
                    const cur = settings.welcomeType || 'image';
                    const nextIdx = (formats.indexOf(cur) + 1) % formats.length;
                    settings.welcomeType = formats[nextIdx];
                    update = true;
                }
                if (i.customId === 'action_welcomedm_toggle') { settings.welcomeDmEnabled = !settings.welcomeDmEnabled; update = true; }
                if (i.customId === 'action_welcome_channel') { settings.welcomeChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_goodbye_toggle') { settings.goodbyeEnabled = !settings.goodbyeEnabled; update = true; }
                if (i.customId === 'action_goodbye_format') {
                    const formats = ['image', 'embed', 'text'];
                    const cur = settings.goodbyeType || 'image';
                    const nextIdx = (formats.indexOf(cur) + 1) % formats.length;
                    settings.goodbyeType = formats[nextIdx];
                    update = true;
                }
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
                if (i.customId === 'action_leveling_ai_toggle') { settings.levelingAiEnabled = settings.levelingAiEnabled === false ? true : false; update = true; }
                if (i.customId === 'action_levelalert_toggle') { settings.levelUpNotificationsEnabled = !settings.levelUpNotificationsEnabled; update = true; }
                if (i.customId === 'action_leveldm_toggle') { settings.levelUpDmEnabled = !settings.levelUpDmEnabled; update = true; }
                if (i.customId === 'action_rolestack_toggle') { settings.roleRewardsStack = settings.roleRewardsStack !== false ? false : true; update = true; }
                if (i.customId === 'action_levelpfp_toggle') { settings.levelingPfpEnabled = settings.levelingPfpEnabled === false ? true : false; update = true; }
                if (i.customId === 'action_leveling_cooldown') { settings.levelingCooldownSec = parseInt(i.values[0], 10); update = true; }
                if (i.customId === 'action_levelalert_channel') { settings.levelUpChannelId = i.values[0]; update = true; }

                // Games, Starboard & AFK Navigation
                if (i.customId === 'action_goto_starboard') { state.currentView = 'view_starboard'; return i.update(buildDashboard('view_starboard')); }
                if (i.customId === 'action_goto_counting') { state.currentView = 'view_counting'; return i.update(buildDashboard('view_counting')); }
                if (i.customId === 'action_goto_onewordstory') { state.currentView = 'view_onewordstory'; return i.update(buildDashboard('view_onewordstory')); }
                if (i.customId === 'action_goto_afk') { state.currentView = 'view_afk'; return i.update(buildDashboard('view_afk')); }

                // AFK Module
                if (i.customId === 'action_afk_toggle') { settings.afkEnabled = settings.afkEnabled !== false ? false : true; update = true; }
                if (i.customId === 'action_afk_role') { settings.afkRoleId = i.values.length > 0 ? i.values[0] : null; update = true; }
                if (i.customId === 'action_afk_clear_role') { settings.afkRoleId = null; update = true; }
                if (i.customId === 'action_afk_nick_toggle') { settings.afkAutoNickname = settings.afkAutoNickname !== false ? false : true; update = true; }

                // One Word Story
                if (i.customId === 'action_onewordstory_toggle') { settings.oneWordStoryEnabled = !settings.oneWordStoryEnabled; update = true; }
                if (i.customId === 'action_story_autostart_toggle') { settings.oneWordStoryAlwaysAutoStart = !settings.oneWordStoryAlwaysAutoStart; update = true; }
                if (i.customId === 'action_story_consecutive_toggle') { settings.oneWordStoryAllowConsecutive = !settings.oneWordStoryAllowConsecutive; update = true; }
                if (i.customId === 'action_onewordstory_channel') { settings.oneWordStoryChannelId = i.values[0]; update = true; }

                // Counting Game & Top / Fail Roles
                if (i.customId === 'action_counting_channel') { settings.countingChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_counting_top_role') { settings.countingTopCounterRoleId = i.values.length > 0 ? i.values[0] : null; update = true; }
                if (i.customId === 'action_counting_clear_top_role') { settings.countingTopCounterRoleId = null; update = true; }
                if (i.customId === 'action_counting_fail_role') { settings.countingFailRoleId = i.values.length > 0 ? i.values[0] : null; update = true; }
                if (i.customId === 'action_counting_clear_fail_role') { settings.countingFailRoleId = null; update = true; }
                if (i.customId === 'action_counting_cycle_threshold') {
                    const current = settings.countingFailThreshold || 1;
                    const cycle = [1, 2, 3, 5, 10];
                    const idx = cycle.indexOf(current);
                    settings.countingFailThreshold = (idx >= 0 && idx < cycle.length - 1) ? cycle[idx + 1] : 1;
                    update = true;
                }

                // Starboard & Role Rewards
                if (i.customId === 'action_starboard_toggle') { settings.starboardEnabled = !settings.starboardEnabled; update = true; }
                if (i.customId === 'action_starboard_ai_toggle') { settings.starboardAiEnabled = settings.starboardAiEnabled === false ? true : false; update = true; }
                if (i.customId === 'action_starboard_selfstar') { settings.starboardSelfStar = !settings.starboardSelfStar; update = true; }
                if (i.customId === 'action_starboard_channel') { settings.starboardChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_starboard_reward_role') {
                    state.pendingStarboardRole = i.values.length > 0 ? i.values[0] : null;
                    return i.update(buildDashboard('view_starboard'));
                }
                if (i.customId === 'action_starboard_add_reward') {
                    if (state.pendingStarboardRole) {
                        const parts = i.values[0].split(':');
                        const cond = parts[0];
                        const thresh = parseInt(parts[1], 10) || 10;
                        let existing = [];
                        try { existing = JSON.parse(settings.starboardRoleRewards || '[]'); } catch (_) { existing = []; }
                        if (!Array.isArray(existing)) existing = [];
                        existing.push({
                            id: `rew_${Date.now()}`,
                            roleId: state.pendingStarboardRole,
                            condition: cond,
                            threshold: thresh
                        });
                        settings.starboardRoleRewards = JSON.stringify(existing);
                        state.pendingStarboardRole = null;
                        update = true;
                    }
                }
                if (i.customId === 'action_starboard_clear_rewards') {
                    settings.starboardRoleRewards = '[]';
                    state.pendingStarboardRole = null;
                    update = true;
                }

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
                    const { parseRoleIds } = require('../../utils/roleUtils');
                    const hasValidRoles = parseRoleIds(settings.verifyRoleId).length > 0 || parseRoleIds(settings.robloxVerifyRoleId).length > 0;
                    if (!hasValidRoles) return i.reply({ content: '⚠️ You must configure at least one **Verified Role** in the dropdown first!', ephemeral: true });
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
                if (i.customId === 'action_ai_master_toggle') {
                    settings.noraAiEnabled = settings.noraAiEnabled === false ? true : false;
                    update = true;
                }
                if (i.customId === 'action_ai_memory_toggle') {
                    settings.aiMemoryEnabled = settings.aiMemoryEnabled === false ? true : false;
                    update = true;
                }
                if (i.customId === 'action_ai_image_toggle') {
                    settings.aiImageGenerationEnabled = settings.aiImageGenerationEnabled === false ? true : false;
                    update = true;
                }
                if (i.customId === 'action_ai_model') { settings.aiModel = i.values[0]; update = true; }
                if (i.customId === 'action_ai_pref') { settings.aiPreference = i.values[0]; update = true; }
                if (i.customId === 'action_ai_template') {
                    const templateVal = i.values[0];
                    settings.aiPromptTemplate = templateVal;
                    const templates = {
                        classic: "You are Nora, a friendly, intelligent, and delightfully witty Discord AI assistant. You are engaging, supportive, and keep chat positive and fun while providing helpful answers.",
                        balanced: "You are Nora, a versatile, well-balanced Discord AI companion. Maintain a natural, adaptable balance between friendly warmth, helpful clarity, light casual banter, and respectful moderation. Never swing too extremely into harsh sarcasm or robotic formality—stay approachable, reliable, intelligent, and socially grounded in every interaction.",
                        dynamic: "You are Nora, a highly intuitive and socially adaptive Discord AI. Dynamically observe and mirror the active channel's energy, conversational tone, vocabulary, formality, and community vibe. If members are casual and joking with gaming memes or slang, match their casual banter. If someone asks a serious or technical question, shift seamlessly into clear, knowledgeable, and concise assistance. Always stay authentic, contextual, and in sync with the room's atmosphere.",
                        professional: "You are Nora, a professional, concise, and courteous AI assistant. Provide direct, informative, and precise responses. Assist users with server guides, tech questions, and community guidelines efficiently.",
                        sarcastic: "You are Nora, a sassy, playfully sarcastic AI companion. You love banter, teasing members affectionately, clever humor, and funny comebacks while remaining friendly at heart.",
                        gamer: "You are Nora, an energetic, hype Discord companion who loves video games, memes, and casual chat. Keep messages punchy, relatable, and fun.",
                        moderator: "You are Nora, a firm, vigilant, and rule-focused AI moderator. You value order, server rules, calm discourse, and quick de-escalation of conflicts."
                    };
                    if (templates[templateVal]) {
                        settings.aiSystemPrompt = templates[templateVal];
                    }
                    update = true;
                }
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
                if (i.customId === 'action_ai_exclude_channel') {
                    const chId = i.values[0];
                    let currentExcluded = [];
                    try {
                        currentExcluded = typeof settings.aiExcludedChannels === 'string' ? JSON.parse(settings.aiExcludedChannels || '[]') : (settings.aiExcludedChannels || []);
                    } catch (_) { currentExcluded = []; }
                    if (currentExcluded.includes(chId)) {
                        currentExcluded = currentExcluded.filter(id => id !== chId);
                    } else {
                        currentExcluded.push(chId);
                    }
                    settings.aiExcludedChannels = JSON.stringify(currentExcluded);
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
                        settings.adaptiveSlowmodeLargeSec = 15;
                        settings.adaptiveSlowmodeDecaySec = 30;
                    } else if (preset === 'casual') {
                        settings.adaptiveSlowmodeSmallThreshold = 10;
                        settings.adaptiveSlowmodeLargeSec = 3;
                        settings.adaptiveSlowmodeDecaySec = 15;
                    } else if (preset === 'maximum') {
                        settings.adaptiveSlowmodeSmallThreshold = 1;
                        settings.adaptiveSlowmodeLargeSec = 30;
                        settings.adaptiveSlowmodeDecaySec = 60;
                    } else { // balanced
                        settings.adaptiveSlowmodeSmallThreshold = 5;
                        settings.adaptiveSlowmodeLargeSec = 6;
                        settings.adaptiveSlowmodeDecaySec = 20;
                    }
                    update = true;
                }
                if (i.customId === 'action_adaptiveslowmode_channels') {
                    settings.adaptiveSlowmodeChannels = JSON.stringify(i.values || []);
                    update = true;
                }
                if (i.customId === 'action_adaptiveslowmode_roles') {
                    settings.adaptiveSlowmodeIgnoredRoles = JSON.stringify(i.values || []);
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
