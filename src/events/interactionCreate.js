const { Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const settingsCache = require('../utils/settingsCache');
const { handleError } = require('../utils/embeds');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        // Track Easter Egg #10
        if (interaction.isButton()) {
            const { checkAndAwardEgg } = require('../utils/easterEggSystem');
            checkAndAwardEgg(interaction, 10);
        }

        // 💎 Premium Entitlement Sync (Global Badge Recognition)
        if (interaction.user) {
            const { isPremium } = require('../utils/premiumManager');
            const currentUserIsPremium = isPremium(interaction);
            
            // We update their global status in our records for badge display on cards,
            // but only if they do not have manual premium granted by the bot owner.
            const UserLevel = require('../database/models/UserLevel');
            const userLevels = await UserLevel.findAll({ where: { userId: interaction.user.id } }).catch(() => []);
            const hasManualPremium = userLevels.some(ul => ul.isManualPremium);
            
            if (!hasManualPremium) {
                await UserLevel.update(
                    { isPremium: currentUserIsPremium },
                    { where: { userId: interaction.user.id } }
                ).catch(() => {}); // Silent fail if database is busy
            }
        }        // Handle Ticket Close Button Action
        if (interaction.isButton() && (interaction.customId.startsWith('ticket_close_') || interaction.customId.startsWith('ticket_close_btn_'))) {
            const ticketsEngine = require('../bot/engines/tickets');
            const settings = await settingsCache.get(interaction.guildId);
            await ticketsEngine.handleTicketClose(interaction, settings);
            return;
        }

        // Handle Ticket Spawn Panel Button Click (Pop Modals)
        if (interaction.isButton() && interaction.customId.startsWith('ticket_') && !interaction.customId.startsWith('ticket_close')) {
            const ticketsEngine = require('../bot/engines/tickets');
            const settings = await settingsCache.get(interaction.guildId);
            await ticketsEngine.handleTicketButton(interaction, settings);
            return;
        }        // Handle Verification Buttons (Anti-Bot Modal Upgrade)
        if (interaction.isButton() && interaction.customId === 'verify_system_button') {
            const verifyEngine = require('../bot/engines/verify');
            await verifyEngine.handleVerifyButtonClick(interaction);
            return;
        }

        // Handle Ticket Modal Submission
        if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
            const ticketsEngine = require('../bot/engines/tickets');
            const settings = await settingsCache.get(interaction.guildId);
            await ticketsEngine.handleTicketSubmit(interaction, settings);
            return;
        }

        // Handle Premium Modal Submission
        if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_premium_')) {
            const action = interaction.customId.replace('modal_premium_', ''); // premium_enable, premium_disable, premium_remove
            const isAdd = action === 'premium_enable';
            const isRemove = action === 'premium_remove';

            const APP_OWNER_IDS = ['1214048435632603137', '1366229304257544213'];
            if (!APP_OWNER_IDS.includes(interaction.user.id)) {
                return handleError(interaction, 'Unauthorized Access', 'This action is strictly restricted to the Bot Owner.');
            }

            const targetUserId = interaction.fields.getTextInputValue('user_id');
            const targetGuildId = interaction.fields.getTextInputValue('guild_id');

            if (!targetUserId && !targetGuildId) {
                return interaction.reply({ content: '❌ You must specify either a User ID or a Guild ID.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            let userResult = '';
            let guildResult = '';

            if (targetUserId) {
                const UserLevel = require('../database/models/UserLevel');
                const updatedCount = await UserLevel.update(
                    { isPremium: isAdd, isManualPremium: !isRemove },
                    { where: { userId: targetUserId } }
                );

                if (interaction.guildId) {
                    await UserLevel.findOrCreate({
                        where: { userId: targetUserId, guildId: interaction.guildId },
                        defaults: { isPremium: isAdd, isManualPremium: !isRemove }
                    });
                }
                userResult = `User <@${targetUserId}> (ID: ${targetUserId}) premium status updated to **${isAdd ? 'Enabled' : isRemove ? 'Removed/Reset' : 'Disabled'}** (updated ${updatedCount} records).`;
            }

            if (targetGuildId) {
                const GuildSettings = require('../database/models/GuildSettings');
                const [guildSettings] = await GuildSettings.findOrCreate({
                    where: { guildId: targetGuildId }
                });
                await guildSettings.update({ isPremium: isAdd, isManualPremium: !isRemove });
                settingsCache.invalidate(targetGuildId);
                guildResult = `Guild \`${targetGuildId}\` premium status updated to **${isAdd ? 'Enabled' : isRemove ? 'Removed/Reset' : 'Disabled'}**.`;
            }

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle(`Premium ${isAdd ? 'Enabled' : isRemove ? 'Removed' : 'Disabled'}`)
                .setColor(isAdd ? 0xFFD700 : 0xFF5555)
                .setDescription([userResult, guildResult].filter(Boolean).join('\n'))
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // Handle Verification Modal Submission
        if (interaction.isModalSubmit() && interaction.customId.startsWith('verify_modal_submit_')) {
            const verifyEngine = require('../bot/engines/verify');
            const settings = await settingsCache.get(interaction.guildId);
            await verifyEngine.handleVerifyModalSubmit(interaction, settings);
            return;
        }

        // Handle Dynamic Self Roles List
        if (interaction.isButton() && interaction.customId.startsWith('selfrole_assign_')) {
            const targetRoleId = interaction.customId.replace('selfrole_assign_', '');
            
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member) {
                return interaction.reply({ content: 'Failed to access your member profile.', ephemeral: true });
            }

            try {
                if (member.roles.cache.has(targetRoleId)) {
                    await member.roles.remove(targetRoleId);
                    return interaction.reply({ content: `Removed the <@&${targetRoleId}> role.`, ephemeral: true });
                } else {
                    await member.roles.add(targetRoleId);
                    return interaction.reply({ content: `Assigned the <@&${targetRoleId}> role to you!`, ephemeral: true });
                }
            } catch (error) {
                console.error('Dynamic Self Role Error:', error);
                return interaction.reply({ content: 'I am lacking physical permissions to assign that role, or the role is higher than mine. Please notify an admin.', ephemeral: true });
            }
        }

        // Handle Hardcoded Legacy Self Roles (Nora Official Server)
        if (interaction.isButton() && interaction.customId.startsWith('selfrole_') && !interaction.customId.startsWith('selfrole_assign_')) {
            const ROLES = {
                'selfrole_taken': '1482228441054056592',
                'selfrole_single': '1482228323840032878',
                'selfrole_looking': '1488270133414727760',
                'selfrole_notlooking': '1488270025688350870',
                'selfrole_lgbt': '1490957762920710204',
                'selfrole_red': '1485943485553971231',
                'selfrole_grey': '1488269707147481133',
                'selfrole_pink': '1438188894804905984',
                'selfrole_green': '1488269824692977904',
                'selfrole_purple': '1484238158970359828'
            };

            const GROUPS = [
                ['1482228441054056592', '1482228323840032878'],
                ['1488270133414727760', '1488270025688350870'],
                ['1490957762920710204'],
                ['1485943485553971231', '1488269707147481133', '1438188894804905984', '1488269824692977904', '1484238158970359828']
            ];

            const targetRoleId = ROLES[interaction.customId];
            if (!targetRoleId) return;

            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member) {
                return interaction.reply({ content: 'Failed to access your member profile.', ephemeral: true });
            }

            // Find which group this role belongs to
            const group = GROUPS.find(g => g.includes(targetRoleId));
            if (!group) return interaction.reply({ content: 'I cannot find the configuration group for this role. Physical setup error.', ephemeral: true });
            
            try {
                if (member.roles.cache.has(targetRoleId)) {
                    // Already has it, so remove it securely
                    await member.roles.remove(targetRoleId);
                    return interaction.reply({ content: 'Role successfully removed.', ephemeral: true });
                } else {
                    // Doesn't have it. Remove other roles in this group first to strictly enforce single-selection logic!
                    let rolesToRemove = [];
                    for (const gRoleId of group) {
                        if (gRoleId !== targetRoleId && member.roles.cache.has(gRoleId)) {
                            rolesToRemove.push(gRoleId);
                        }
                    }

                    if (rolesToRemove.length > 0) {
                        await member.roles.remove(rolesToRemove);
                    }
                    
                    await member.roles.add(targetRoleId);
                    return interaction.reply({ content: 'Role successfully added!', ephemeral: true });
                }
            } catch (error) {
                console.error('Self Role Error:', error);
                return interaction.reply({ content: 'I am lacking permissions to assign that role. Please notify an admin to fix my Role Hierarchy.', ephemeral: true });
            }
        }

        // Handle AI Switch Buttons
        if (interaction.isButton() && (interaction.customId === 'switch_ai_builtin' || interaction.customId === 'use_ai_local')) {
            let settings;
            try {
                const [result] = await GuildSettings.findOrCreate({ where: { guildId: interaction.guildId } });
                settings = result;
            } catch (e) {
                settings = await settingsCache.get(interaction.guildId);
            }
            if (!settings) return interaction.reply({ content: 'Could not access server configuration.', ephemeral: true });
            
            if (interaction.customId === 'switch_ai_builtin') {
                settings.aiPreference = 'BUILT_IN';
                await settings.save();
                settingsCache.invalidate(interaction.guildId);
                return interaction.reply({ content: "Preference updated! I've switched to the **Nora Built-In (Gemini)** engine for future messages in this guild. You can always change this back in `/setup dashboard`.", ephemeral: true });
            }

            if (interaction.customId === 'use_ai_local') {
                settings.aiPreference = 'LOCAL';
                await settings.save();
                settingsCache.invalidate(interaction.guildId);
                return interaction.reply({ content: "Preference updated! I've switched to the **Privacy-First Local** engine for future messages in this guild. This is my most secure mode! You can always change this back in `/setup dashboard`.", ephemeral: true });
            }
            return; // Exit safely
        }

        // 🗑️ Handle Self-Wipe Leveling Data Confirmation
        if (interaction.isButton() && interaction.customId === 'confirm_delete_levels') {
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
            
            // SECURITY PASS: Verify the person clicking the confirmation is the same person who owns the data!
            // The original 'mycard' was ephemeral and only showed a button for yourself, but we double-check here.
            const ownerId = interaction.message.embeds[0]?.footer?.text?.split('ID: ')[1];
            if (ownerId && interaction.user.id !== ownerId) {
                return interaction.reply({ content: '⛔ Security Violation: You cannot confirm a data wipe for another user.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('Critical Data Purge Request')
                .setDescription('Warning: You are about to permanently delete all your leveling status, XP, and rank on this server. This cannot be undone.\n\nAre you absolutely sure you want to proceed?')
                .setColor(0xff0000);
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`execute_delete_levels_${interaction.user.id}`)
                    .setLabel('Yes, Wipe My Data')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('cancel_delete_levels')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

            return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        if (interaction.isButton() && interaction.customId.startsWith('execute_delete_levels_')) {
            const targetId = interaction.customId.split('_').pop();
            
            // SECONDARY FIREWALL: Direct ID verification
            if (interaction.user.id !== targetId) {
                return interaction.reply({ content: '⛔ Security Violation: Identity mismatch detected.', ephemeral: true });
            }

            const UserLevel = require('../database/models/UserLevel');
            await UserLevel.destroy({ where: { userId: interaction.user.id, guildId: interaction.guild.id } });
            
            const { handleSuccess } = require('../utils/embeds');
            return handleSuccess(interaction, 'Data Purged', 'Your personal leveling records have been physically removed from our database. You will start at Level 0 next time you speak.');
        }

        if (interaction.isButton() && interaction.customId === 'cancel_delete_levels') {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            return interaction.reply({ content: 'Operation cancelled. Your data remains intact.', ephemeral: true });
        }

        // 🎟️ Handle Giveaway Entry Button (User Request)
        if (interaction.isButton() && interaction.customId === 'giveaway_enter') {
            const Giveaway = require('../database/models/Giveaway');
            const g = await Giveaway.findOne({ where: { messageId: interaction.message.id, ended: false } });
            if (!g) return interaction.reply({ content: 'This giveaway is already ended or invalid!', ephemeral: true });

            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (g.requiredRoleId && (!member || !member.roles.cache.has(g.requiredRoleId))) {
                return interaction.reply({ content: `You need the <@&${g.requiredRoleId}> role to enter this giveaway!`, ephemeral: true });
            }

            // Standard: We use REACTIONS as our persistent entry list so D.js can pick winners easily later
            // We just add a reaction to the message using the bot (silent entry)
            await interaction.message.react('🎉').catch(() => {});
            return interaction.reply({ content: 'You have entered the giveaway. Good luck.', ephemeral: true });
        }

        // Handle standard Commands
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        // 💎 Early Access Command Check
        if (command.earlyAccess || interaction.commandName === 'ask') {
            const { isPremium } = require('../utils/premiumManager');
            const userIsPremium = isPremium(interaction);
            
            let userHasPremium = userIsPremium;
            const UserPrefs = require('../database/models/UserPrefs');
            const userPrefs = await UserPrefs.findOne({ where: { userId: interaction.user.id } }).catch(() => null);
            if (userPrefs) {
                userHasPremium = userHasPremium || !!userPrefs.isPremium || !!userPrefs.isManualPremium;
                const paidTime = userPrefs.paidExpiresAt ? new Date(userPrefs.paidExpiresAt).getTime() : 0;
                const expandedMs = userPrefs.expandedTimeMs ? Number(userPrefs.expandedTimeMs) : 0;
                if (paidTime + expandedMs > Date.now()) {
                    userHasPremium = true;
                }
            }

            let guildIsPremium = false;
            if (interaction.guildId) {
                const guildSettings = await settingsCache.get(interaction.guildId).catch(() => null);
                if (guildSettings) {
                    guildIsPremium = !!guildSettings.isPremium || !!guildSettings.isManualPremium;
                    const paidTime = guildSettings.paidExpiresAt ? new Date(guildSettings.paidExpiresAt).getTime() : 0;
                    const expandedMs = guildSettings.expandedTimeMs ? Number(guildSettings.expandedTimeMs) : 0;
                    if (paidTime + expandedMs > Date.now()) {
                        guildIsPremium = true;
                    }
                }
            }

            if (!userHasPremium && !guildIsPremium) {
                if (interaction.commandName === 'ask') {
                    try {
                        await interaction.deferReply({ ephemeral: true });
                        await interaction.deleteReply();
                    } catch (e) {
                        console.error('Failed to silently fail /ask command:', e);
                    }
                    return;
                }
                return handleError(interaction, 'Early Access Feature', 'This command is currently in **Early Access** and requires a **Nora Premium** subscription.\n\nSupport Nora\'s development and gain access to premium perks by upgrading today!');
            }
        }


        // 🐰 Easter Egg Unstoppable Interceptor (Awards eggs even if blocked globally/locally)
        const { checkAndAwardEgg } = require('../utils/easterEggSystem');
        const eggMap = {
            'leaderboard': 1,
            'ask': 2,
            'help': 3,
            'guess': 4,
            'invite': 5,
            'info': 6,
            'rank': 9
        };
        
        if (eggMap[interaction.commandName]) {
            checkAndAwardEgg(interaction, eggMap[interaction.commandName]);
        }

        try {
            const GlobalSettings = require('../database/models/GlobalSettings');
            const globalSettings = await GlobalSettings.findByPk(1);
            const disabledCmds = globalSettings ? JSON.parse(globalSettings.disabledCommands || '[]') : [];
            const disabledCats = globalSettings ? JSON.parse(globalSettings.disabledFeatures || '[]') : [];

            if (disabledCmds.includes(interaction.commandName.toLowerCase())) {
                return handleError(interaction, 'Global Override Active', `The command \`/${interaction.commandName}\` has been globally disabled by the Nora Development Team.`);
            }

            let settings = null;
            if (interaction.guildId) {
                settings = await settingsCache.get(interaction.guildId);
                if (settings && settings.disabledCommands) {
                    let localDisabled = [];
                    try {
                        localDisabled = JSON.parse(settings.disabledCommands || '[]');
                    } catch (e) {}
                    if (localDisabled.includes(interaction.commandName.toLowerCase())) {
                        return handleError(interaction, 'Command Disabled', `The command \`/${interaction.commandName}\` has been disabled on this server by an administrator.`);
                    }
                }
            }

            // 🛡️ Global Permission Pre-Flight Checks: Identifies exactly *what* is missing
            if (interaction.guildId) {
                // 1. Check if the User lacks permissions defined natively on the command
                const requiredUserPerms = command.data.default_member_permissions;
                if (requiredUserPerms) {
                    const hasUserPerms = interaction.memberPermissions?.has(BigInt(requiredUserPerms));
                    if (!hasUserPerms) {
                        const { PermissionsBitField } = require('discord.js');
                        const missing = new PermissionsBitField(BigInt(requiredUserPerms)).missing(interaction.memberPermissions || new PermissionsBitField());
                        return handleError(interaction, 'Unauthorized Access', `You lack the physical permissions to run this command.\n\n**Missing:** \`${missing.join(', ')}\``);
                    }
                }

                // 2. Dynamic Bot Permissions Engine based on Command Name/Category
                let requiredBotPerms = [];
                const cmdName = interaction.commandName.toLowerCase();
                
                // Hardcoded intelligent permission tracking
                if (['ban', 'kick', 'mute', 'purge', 'role'].includes(cmdName)) {
                    if (cmdName === 'ban') requiredBotPerms.push(PermissionFlagsBits.BanMembers);
                    if (cmdName === 'kick') requiredBotPerms.push(PermissionFlagsBits.KickMembers);
                    if (cmdName === 'mute') requiredBotPerms.push(PermissionFlagsBits.ModerateMembers);
                    if (cmdName === 'purge') requiredBotPerms.push(PermissionFlagsBits.ManageMessages);
                    if (cmdName === 'role') requiredBotPerms.push(PermissionFlagsBits.ManageRoles);
                }
                if (cmdName === 'setup') {
                    requiredBotPerms.push(PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels);
                }
                
                if (command.botPermissions) requiredBotPerms.push(...command.botPermissions);

                if (requiredBotPerms.length > 0) {
                    const botPerms = interaction.guild.members.me.permissions;
                    const missing = [];
                    for (const perm of requiredBotPerms) {
                        if (!botPerms.has(perm)) {
                            // Reverse map BitField to String name safely
                            const { PermissionsBitField } = require('discord.js');
                            const missingStr = new PermissionsBitField(perm).toArray()[0] || `${perm}`;
                            missing.push(missingStr);
                        }
                    }
                    
                    if (missing.length > 0) {
                        return handleError(interaction, 'Nora Access Error', `I cannot physically execute this command. Please update my roles to fix my permissions!\n\n**I am missing:** \`${missing.join(', ')}\``);
                    }
                }
            }

            // 🔓 Social Command Unlock: Whitelist specific commands from ALL feature-toggle and category blocks
            const socialWhitelist = ['rank', 'leaderboard', 'mycard'];
            const isSocialCmd = socialWhitelist.includes(interaction.commandName.toLowerCase());

            if (isSocialCmd) {
                // Total Bypass: Skip all further permission/category/toggle checks for these social tools
                return await command.execute(interaction, settings);
            }

            const category = command.category;
            const restrictedCats = ['setup', 'moderation'];
            const restrictedCmds = ['giveaway-start'];
            
            // 🛡️ Nora System Security (V10.5 Security Matrix) - Layer 1
            const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || 
                            interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers) || 
                            interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers) ||
                            interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) ||
                            interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);

            // 🔐 HARDENING: Layer 2 Redundant Permission Check (Double-Verify)
            // Even if Discord allowed the command, Nora re-probes the member locally.
            if ((category === 'setup' || category === 'moderation') && !isSocialCmd) {
                const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                if (!member) return handleError(interaction, 'Security Violation', 'Could not verify your identity on this server.');
                
                const hasStaffPerms = member.permissions.has(PermissionFlagsBits.ManageGuild) || 
                                      member.permissions.has(PermissionFlagsBits.BanMembers) || 
                                      member.permissions.has(PermissionFlagsBits.KickMembers) ||
                                      member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
                                      member.permissions.has(PermissionFlagsBits.ManageMessages);
                
                if (!hasStaffPerms) {
                    console.warn(`[System Security] BLOCKED unauthorized execution attempt for /${interaction.commandName} by ${interaction.user.tag} (${interaction.user.id})`);
                    return handleError(interaction, 'System Security Blocked', 'Identity check failed. You do not have the physical permissions required to trigger this system.');
                }
            }

            // Special Category: Setup & Configure is strictly for Server Management (Admins)
            if (category === 'setup' && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return handleError(interaction, 'Admin Required', 'Configuration access requires the physical **Manage Server** permission to prevent accidental mis-calibration.');
            }

            // General Staff Firewall (Moderation + Specific Cmds)
            if ((category === 'moderation' || restrictedCmds.includes(interaction.commandName)) && !isStaff) {
                return handleError(interaction, 'Unauthorized Access', 'This system is physically locked to **Staff Members**. The event has been logged.');
            }

            if (disabledCats.includes(category)) {
                return handleError(interaction, 'Global Blackout', `The entire **${category}** module has been taken offline globally by the Nora Development Team.`);
            }

            if (settings) {
                if (category === 'moderation' && !settings.moderationEnabled) {
                    return handleError(interaction, 'Feature Disabled', 'Moderation features are currently disabled on this server. An administrator can enable them using `/setup dashboard`.');
                }
                if (category === 'leveling' && !settings.levelingEnabled) {
                    return handleError(interaction, 'Feature Disabled', 'Leveling features are currently disabled on this server. An administrator can enable them using `/setup dashboard`.');
                }
                if (category === 'fun' && !settings.funEnabled) {
                    return handleError(interaction, 'Feature Disabled', 'Fun and minigame features are currently disabled on this server. An administrator can enable them using `/setup dashboard`.');
                }
                if (category === 'utility' && !settings.utilityEnabled) {
                    return handleError(interaction, 'Feature Disabled', 'Utility features are currently disabled on this server. An administrator can enable them using `/setup dashboard`.');
                }
            }

            // [System Command] V10.0 tracking
            let argsStr = '';
            if (interaction.options && interaction.options.data) {
                const mapOptions = (opts) => opts.map(o => {
                    if (o.options) return `${o.name}: { ${mapOptions(o.options)} }`;
                    return `${o.name}: ${o.value}`;
                }).join(', ');
                argsStr = mapOptions(interaction.options.data);
            }
            console.log(`[System Command] ${interaction.user.tag} used /${interaction.commandName} ${argsStr ? `[${argsStr}]` : ''} in ${interaction.guild ? interaction.guild.name : 'Direct Messages'}`);

            // Monkey-patch reply methods to handle deferred/replied states gracefully
            const originalReply = interaction.reply.bind(interaction);
            const originalDeferReply = interaction.deferReply.bind(interaction);

            interaction.reply = async (options) => {
                if (interaction.deferred || interaction.replied) {
                    return await interaction.editReply(options);
                }
                return await originalReply(options);
            };

            interaction.deferReply = async (options) => {
                if (interaction.deferred || interaction.replied) {
                    return;
                }
                return await originalDeferReply(options);
            };

            // ⏳ [Global Redirect & Wait] - System Command Monitoring
            const timeoutId = setTimeout(async () => {
                if (!interaction.deferred && !interaction.replied) {
                    try {
                        await interaction.deferReply({ ephemeral: true }).catch(() => {});
                        await interaction.editReply({ content: '☕ **Hang tight!** Nora is just gathering her thoughts. She will be with you in a second...', ephemeral: true }).catch(() => {});
                    } catch (e) {}
                }
            }, 2000);

            try {
                await command.execute(interaction, settings);
                clearTimeout(timeoutId);
            } catch (error) {
                clearTimeout(timeoutId);
                
                const logger = require('../utils/logger');
                await logger.logCommandError(interaction, error);
                
                // Fallback for native Discord 50013 API faults mid-execution
                if (error.code === 50013 || (error.message && error.message.includes('Missing Permissions'))) {
                    const replyData = { content: '❌ **I lack the physical permissions to do this!**\n\nThe most common cause is that my **Bot Role is lower** in the Server Roles list than the user/role I am trying to modify, or I am missing `Manage Roles`/`Manage Channels`.', ephemeral: true };
                    
                    try {
                        if (!interaction.deferred && !interaction.replied) await interaction.reply(replyData);
                        else await interaction.followUp(replyData);
                    } catch (e) {}
                    return;
                }

                if (!interaction.deferred && !interaction.replied) {
                    await handleError(interaction, 'Nora hit a snag', `Something went slightly wrong in her brain. I've sent a quick note to the team to take a look!\n\n**Error details:** \`${error.message || error}\``);
                } else if (interaction.deferred && !interaction.replied) {
                    await handleError(interaction, 'Nora hit a snag', `Something went slightly wrong in her brain. I've sent a quick note to the team to take a look!\n\n**Error details:** \`${error.message || error}\``);
                } else {
                    await interaction.followUp({ content: '❌ **Nora tripped up**: Something went wrong, but the team has been notified!', ephemeral: true }).catch(() => {});
                }
            }
        } catch (error) {
            console.error('[System Fatal] Interaction Engine Fault:', error);
        }
    },
};
