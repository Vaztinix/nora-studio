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
        }

        // Handle Ticket Close Button Action
        if (interaction.isButton() && interaction.customId.startsWith('ticket_close_')) {
            const ActiveTicket = require('../database/models/ActiveTicket');
            const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
            if (!ticket) return interaction.reply({ content: 'Could not resolve this ticket in database.', ephemeral: true });

            const isCreator = interaction.user.id === ticket.ownerId;
            const settings = await settingsCache.get(interaction.guildId);
            const isSupport = settings.ticketSupportRoleId && interaction.member?.roles.cache.has(settings.ticketSupportRoleId);
            const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.ManageChannels) || interaction.member?.permissions.has(PermissionFlagsBits.Administrator);

            if (!isCreator && !isSupport && !isAdmin) {
                return interaction.reply({ content: '⛔ Only the ticket creator or Support staff can close this ticket.', ephemeral: true });
            }

            await interaction.reply({ content: '🔒 Close request acknowledged. Compiling transcript and closing...', ephemeral: true });

            // Fetch and compile transcript
            const messages = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => []);
            const sortedMessages = [...messages.values()].reverse();

            let transcriptText = `--- NORA SUPPORT TICKET TRANSCRIPT ---\n`;
            transcriptText += `Guild ID: ${interaction.guildId}\n`;
            transcriptText += `Channel ID: ${interaction.channelId}\n`;
            transcriptText += `Ticket Owner: ${ticket.ownerId}\n`;
            transcriptText += `Closed By: ${interaction.user.tag} (${interaction.user.id})\n`;
            transcriptText += `Timestamp: ${new Date().toISOString()}\n`;
            transcriptText += `--------------------------------------\n\n`;

            sortedMessages.forEach(msg => {
                const timestamp = new Date(msg.createdAt).toISOString();
                const attachmentUrls = msg.attachments.map(a => a.url).join(', ');
                const attachmentsSuffix = attachmentUrls ? ` [Attachments: ${attachmentUrls}]` : '';
                transcriptText += `[${timestamp}] ${msg.author.tag}: ${msg.content}${attachmentsSuffix}\n`;
            });

            const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
            const transcriptBuffer = Buffer.from(transcriptText, 'utf-8');
            const transcriptFile = new AttachmentBuilder(transcriptBuffer, { name: `transcript-${interaction.channel.name}.txt` });

            // DM Owner
            const owner = await interaction.client.users.fetch(ticket.ownerId).catch(() => null);
            if (owner) {
                try {
                    await owner.send({
                        content: `👋 Hi! Your support ticket in **${interaction.guild.name}** has been closed. Attached is your transcript logs file.`,
                        files: [transcriptFile]
                    });
                } catch (e) {
                    console.log(`Failed to DM transcript:`, e.message);
                }
            }

            // Send to Server Logging Channel
            if (settings.loggingChannelId) {
                const logChannel = interaction.guild.channels.cache.get(settings.loggingChannelId)
                    || await message.guild.channels.fetch(settings.loggingChannelId).catch(() => null);
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle('🎫 Ticket Closed & Transcribed')
                        .setDescription(`**Owner:** <@${ticket.ownerId}> (${ticket.ownerId})\n**Closed By:** <@${interaction.user.id}>\n**Channel:** ${interaction.channel.name}`)
                        .setColor(0x8b90a5)
                        .setTimestamp();
                    await logChannel.send({ embeds: [embed], files: [transcriptFile] }).catch(() => {});
                }
            }

            await ticket.destroy();
            setTimeout(async () => {
                await interaction.channel.delete().catch(() => {});
            }, 3000);
            return;
        }

        // Handle Ticket Spawn Panel Button Click (Pop Modals)
        if (interaction.isButton() && interaction.customId.startsWith('ticket_') && !interaction.customId.startsWith('ticket_close')) {
            const ticketType = interaction.customId.split('_')[1];
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
            
            const settings = await settingsCache.get(interaction.guildId);
            const modal = new ModalBuilder()
                .setCustomId(`ticket_modal_${ticketType}`)
                .setTitle(`Create ${ticketType} Ticket`);

            let inputs = [];
            let configInputs = [];
            if (settings?.ticketFormInputs) {
                try {
                    configInputs = JSON.parse(settings.ticketFormInputs);
                } catch (e) {}
            }

            if (configInputs && Array.isArray(configInputs) && configInputs.length > 0) {
                configInputs.slice(0, 5).forEach((inp, idx) => {
                    const textInp = new TextInputBuilder()
                        .setCustomId(inp.customId || `ticket_input_${idx}`)
                        .setLabel(inp.label || 'Details')
                        .setStyle(inp.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
                        .setRequired(!!inp.required)
                        .setPlaceholder(inp.placeholder || '');
                    inputs.push(textInp);
                });
            } else {
                const reasonInput = new TextInputBuilder()
                    .setCustomId('ticket_reason')
                    .setLabel('Reason for Request')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder('Describe your issue or request here...');

                const orderInput = new TextInputBuilder()
                    .setCustomId('ticket_order')
                    .setLabel('Order Identifier (Optional)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('e.g. Order # or Username');

                inputs.push(reasonInput, orderInput);
            }

            const rows = inputs.map(input => new ActionRowBuilder().addComponents(input));
            modal.addComponents(rows);

            await interaction.showModal(modal);
            return;
        }

        // Handle Verification Buttons (Anti-Bot Modal Upgrade)
        if (interaction.isButton() && interaction.customId === 'verify_system_button') {
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
            
            const modal = new ModalBuilder()
                .setCustomId('verify_modal_submit')
                .setTitle('Security Verification');

            const captchaInput = new TextInputBuilder()
                .setCustomId('captcha_answer')
                .setLabel('Type the word NORA in ALL CAPS')
                .setPlaceholder('NORA')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(4)
                .setMaxLength(4);

            const row = new ActionRowBuilder().addComponents(captchaInput);
            modal.addComponents(row);

            await interaction.showModal(modal);
            return;
        }

        // Handle Ticket Modal Submission
        if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
            const ticketType = interaction.customId.split('_')[2];
            await interaction.deferReply({ ephemeral: true });

            try {
                const settings = await settingsCache.get(interaction.guildId);
                const safeName = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

                // Gather modal inputs
                const capturedIntake = {};
                let configInputs = [];
                if (settings?.ticketFormInputs) {
                    try {
                        configInputs = JSON.parse(settings.ticketFormInputs);
                    } catch(e) {}
                }

                if (configInputs && Array.isArray(configInputs) && configInputs.length > 0) {
                    configInputs.forEach((inp, idx) => {
                        const customId = inp.customId || `ticket_input_${idx}`;
                        const label = inp.label || `Field ${idx + 1}`;
                        const value = interaction.fields.getTextInputValue(customId);
                        capturedIntake[label] = value;
                    });
                } else {
                    capturedIntake['Reason for Request'] = interaction.fields.getTextInputValue('ticket_reason');
                    capturedIntake['Order Identifier'] = interaction.fields.getTextInputValue('ticket_order') || 'N/A';
                }

                // Resolve support roles for viewing permissions
                const permissionOverwrites = [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                    },
                    {
                        id: interaction.client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles],
                    }
                ];

                if (settings?.ticketSupportRoleId) {
                    permissionOverwrites.push({
                        id: settings.ticketSupportRoleId,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    });
                }

                const ticketChannel = await interaction.guild.channels.create({
                    name: safeName,
                    type: ChannelType.GuildText,
                    parent: settings?.ticketCategoryId || null,
                    permissionOverwrites
                });

                // Create ActiveTicket in Database
                const ActiveTicket = require('../database/models/ActiveTicket');
                await ActiveTicket.create({
                    guildId: interaction.guildId,
                    channelId: ticketChannel.id,
                    ownerId: interaction.user.id,
                    isOpen: true,
                    capturedIntake: JSON.stringify(capturedIntake)
                });

                // Send Ticket Header Embed with Close Button
                const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
                const embed = new EmbedBuilder()
                    .setTitle(`🎫 Support Ticket: ${ticketType}`)
                    .setDescription(`Thank you for reaching out. A support ticket has been opened. Please wait for Support staff to assist you.`)
                    .setColor(0x4F46E5)
                    .setTimestamp();

                Object.entries(capturedIntake).forEach(([label, val]) => {
                    if (val) embed.addFields({ name: label, value: val.substring(0, 1024) });
                });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_close_${interaction.user.id}`)
                        .setLabel('Close Ticket')
                        .setStyle(ButtonStyle.Danger)
                );

                await ticketChannel.send({
                    content: `<@${interaction.user.id}> ${settings.ticketSupportRoleId ? `<@&${settings.ticketSupportRoleId}>` : ''}`,
                    embeds: [embed],
                    components: [row]
                });

                await interaction.editReply({ content: `Ticket opened! Please check <#${ticketChannel.id}>.` });
            } catch (error) {
                console.error('[Ticket Modals Error]:', error);
                await interaction.editReply({ content: `Failed to create ticket: ${error.message}` });
            }
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
        if (interaction.isModalSubmit() && interaction.customId === 'verify_modal_submit') {
            const answer = interaction.fields.getTextInputValue('captcha_answer');

            if (answer.trim().toUpperCase() !== 'NORA') {
                return interaction.reply({ content: '❌ Verification failed. You must type the word **NORA** exactly as shown.', ephemeral: true });
            }

            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member) return interaction.reply({ content: 'Could not resolve your member profile.', ephemeral: true });

            const settings = await settingsCache.get(interaction.guildId);
            if (!settings || !settings.verifyRoleId) {
                return interaction.reply({ content: 'Verification is not fully set up on this server. Please contact an admin.', ephemeral: true });
            }

            try {
                const roleIds = settings.verifyRoleId.split(',');
                let rolesAdded = 0;
                
                if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    return interaction.reply({ content: 'I do not have the **Manage Roles** permission physically required to verify you. Please alert an admin.', ephemeral: true });
                }

                for (const rId of roleIds) {
                    const roleObj = interaction.guild.roles.cache.get(rId);
                    if (roleObj && interaction.guild.members.me.roles.highest.position <= roleObj.position) {
                        return interaction.reply({ content: 'I cannot assign the verification role because it is higher than my highest role. Please alert an admin.', ephemeral: true });
                    }

                    if (!member.roles.cache.has(rId)) {
                        await member.roles.add(rId).catch(()=>{});
                        rolesAdded++;
                    }
                }

                if (rolesAdded === 0) {
                    await interaction.reply({ content: 'You are already verified!', ephemeral: true });
                } else {
                    await interaction.reply({ content: '✅ **Verification Successful!** You have been granted access to the server.', ephemeral: true });
                }
            } catch (error) {
                console.error('Verification Error:', error);
                await interaction.reply({ content: 'I encountered an error trying to assign the roles. Please contact an admin.', ephemeral: true });
            }
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
                    const hasUserPerms = interaction.member.permissions.has(BigInt(requiredUserPerms));
                    if (!hasUserPerms) {
                        const { PermissionsBitField } = require('discord.js');
                        const missing = new PermissionsBitField(BigInt(requiredUserPerms)).missing(interaction.member.permissions);
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
            const isStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) || 
                            interaction.member.permissions.has(PermissionFlagsBits.BanMembers) || 
                            interaction.member.permissions.has(PermissionFlagsBits.KickMembers) ||
                            interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
                            interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);

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
            if (category === 'setup' && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
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
