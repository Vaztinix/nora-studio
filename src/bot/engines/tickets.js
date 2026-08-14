const { PermissionFlagsBits, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const ActiveTicket = require('../../database/models/ActiveTicket');
const TicketHistory = require('../../database/models/TicketHistory');

/**
 * Common core logic to close a ticket, compile transcript, send logs, and delete channel.
 */
async function closeTicket(channel, ticket, settings, closedByUserId, closedByTag, client) {
    // Fetch and compile transcript
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => []);
    const sortedMessages = [...messages.values()].reverse();

    let intakeText = '';
    if (ticket.capturedIntake) {
        try {
            const parsed = JSON.parse(ticket.capturedIntake);
            intakeText = Object.entries(parsed)
                .map(([label, val]) => `* **${label}**: ${val}`)
                .join('\n');
        } catch (e) {
            intakeText = `* **Raw Intake**: ${ticket.capturedIntake}`;
        }
    } else {
        intakeText = '*No intake data captured.*';
    }

    let transcriptText = `# 🎫 Support Ticket Transcript: #${channel.name}\n\n`;
    transcriptText += `## 📌 Ticket Metadata\n`;
    transcriptText += `- **Guild:** ${channel.guild.name} (${channel.guild.id})\n`;
    transcriptText += `- **Ticket Owner:** <@${ticket.ownerId}> (${ticket.ownerId})\n`;
    transcriptText += `- **Closed By:** ${closedByTag} (${closedByUserId})\n`;
    transcriptText += `- **Closed At:** ${new Date().toISOString()}\n\n`;
    transcriptText += `## 📋 Intake Form Responses\n${intakeText}\n\n`;
    transcriptText += `## 💬 Chat Logs\n`;

    sortedMessages.forEach(msg => {
        const timestamp = new Date(msg.createdAt).toLocaleTimeString();
        const attachmentUrls = msg.attachments.map(a => a.url).join(', ');
        const attachmentsSuffix = attachmentUrls ? ` *[Attachments: ${attachmentUrls}]*` : '';
        transcriptText += `* **[${timestamp}] ${msg.author.tag}**: ${msg.content}${attachmentsSuffix}\n`;
    });

    const { AttachmentBuilder } = require('discord.js');
    const transcriptBuffer = Buffer.from(transcriptText, 'utf-8');
    const transcriptFile = new AttachmentBuilder(transcriptBuffer, { name: `transcript-${channel.name}.md` });

    // DM Owner
    const owner = await client.users.fetch(ticket.ownerId).catch(() => null);
    if (owner) {
        try {
            await owner.send({
                content: `👋 Hi! Your support ticket in **${channel.guild.name}** has been closed. Attached is your transcript logs file.`,
                files: [transcriptFile]
            });
        } catch (e) {
            console.log(`Failed to DM transcript:`, e.message);
        }
    }

    // Send to Server Logging Channel
    const loggerUtil = require('../../utils/logger');
    const targetLogId = loggerUtil.resolveLogChannelId(settings, 'moderation');
    if (targetLogId) {
        const logChannel = channel.guild.channels.cache.get(targetLogId)
            || await channel.guild.channels.fetch(targetLogId).catch(() => null);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('🎫 Ticket Closed & Transcribed')
                .setDescription(`**Owner:** <@${ticket.ownerId}> (${ticket.ownerId})\n**Closed By:** <@${closedByUserId}>\n**Channel:** ${channel.name}`)
                .setColor(0x8b90a5)
                .setTimestamp();
            await logChannel.send({ embeds: [embed], files: [transcriptFile] }).catch(() => {});
        }
    }

    // Update TicketHistory record to resolved/closed
    try {
        const historyRecord = await TicketHistory.findOne({
            where: { guildId: channel.guild.id, channelId: channel.id }
        });
        if (historyRecord) {
            await historyRecord.update({
                status: 'closed',
                resolveTime: new Date(),
                closedById: closedByUserId
            });
        }
    } catch (err) {
        console.error('Failed to update TicketHistory on close:', err);
    }

    await ticket.destroy();
    setTimeout(async () => {
        await channel.delete().catch(() => {});
    }, 3000);
}

/**
 * Handles the ticket close button interaction.
 */
async function handleTicketClose(interaction, settings) {
    try {
        const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
        if (!ticket) {
            const msg = 'Could not resolve this ticket in database.';
            if (interaction.deferred || interaction.replied) return await interaction.editReply({ content: msg });
            return await interaction.reply({ content: msg, ephemeral: true });
        }
        
        const isCreator = interaction.user.id === ticket.ownerId;
        const isSupport = settings?.ticketSupportRoleId && interaction.member?.roles.cache.has(settings.ticketSupportRoleId);
        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

        if (!isCreator && !isSupport && !isAdmin) {
            const msg = '⛔ Only the ticket creator or Support staff can close this ticket.';
            if (interaction.deferred || interaction.replied) return await interaction.editReply({ content: msg });
            return await interaction.reply({ content: msg, ephemeral: true });
        }

        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content: '🔒 Close request acknowledged. Compiling transcript and closing...', ephemeral: true });
        } else {
            await interaction.editReply({ content: '🔒 Close request acknowledged. Compiling transcript and closing...' });
        }

        await closeTicket(interaction.channel, ticket, settings, interaction.user.id, interaction.user.tag, interaction.client);
    } catch (err) {
        console.error('[Ticket Engine] Error handling ticket close:', err);
        const errContent = `⚠️ An error occurred while closing the ticket: ${err.message}`;
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: errContent }).catch(() => {});
        } else {
            await interaction.reply({ content: errContent, ephemeral: true }).catch(() => {});
        }
    }
}

/**
 * Handles spawning/popping the ticket creation intake modal.
 */
async function handleTicketButton(interaction, settings) {
    const ticketType = interaction.customId.split('_')[1];
    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    
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
}

/**
 * Handles the ticket modal submission and channel creation.
 */
async function handleTicketSubmit(interaction, settings) {
    const ticketType = interaction.customId.split('_')[2];
    await interaction.deferReply({ ephemeral: true });

    try {
        // Sequential Padded Ticket Numbering
        let ticketNum = (settings.ticketLastNumber || 0) + 1;
        await settings.update({ ticketLastNumber: ticketNum });

        const settingsCache = require('../../utils/settingsCache');
        settingsCache.invalidate(interaction.guildId);

        const paddedNumber = String(ticketNum).padStart(4, '0');
        const safeName = `ticket-${paddedNumber}`;

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
        await ActiveTicket.create({
            guildId: interaction.guildId,
            channelId: ticketChannel.id,
            ownerId: interaction.user.id,
            isOpen: true,
            capturedIntake: JSON.stringify(capturedIntake)
        });

        // Create TicketHistory in Database
        await TicketHistory.create({
            guildId: interaction.guildId,
            channelId: ticketChannel.id,
            ownerId: interaction.user.id,
            status: 'open',
            topic: ticketType || 'Support',
            openTime: new Date(),
            intakeResponses: JSON.stringify(capturedIntake)
        }).catch(err => console.error('Failed to log ticket to TicketHistory:', err));

        // Send Ticket Header Embed with Close Button
        const embed = new EmbedBuilder()
            .setTitle(`🎫 Support Ticket: ${ticketType}`)
            .setDescription(`Thank you for reaching out. A support ticket has been opened. Please wait for Support staff to assist you.`)
            .setColor(0xffffff) // Pure white theme for Nora Studio
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
}

/**
 * Adds a user to the active ticket channel.
 */
async function handleTicketUserAdd(interaction, targetUser) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: '⚠️ This command must be used inside an active ticket channel.', ephemeral: true });
    }

    try {
        await interaction.channel.permissionOverwrites.edit(targetUser.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        });

        const embed = new EmbedBuilder()
            .setTitle('👤 User Added to Ticket')
            .setDescription(`Successfully added <@${targetUser.id}> (\`${targetUser.tag}\`) to this ticket.`)
            .setColor(0x43b581)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        console.error('[Tickets Engine] Error adding user to ticket:', err);
        return interaction.reply({ content: `❌ Failed to add user: ${err.message}`, ephemeral: true });
    }
}

/**
 * Removes a user from the active ticket channel.
 */
async function handleTicketUserRemove(interaction, targetUser) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: '⚠️ This command must be used inside an active ticket channel.', ephemeral: true });
    }

    if (targetUser.id === ticket.ownerId) {
        return interaction.reply({ content: '❌ You cannot remove the ticket creator from their own ticket.', ephemeral: true });
    }

    try {
        await interaction.channel.permissionOverwrites.delete(targetUser.id).catch(async () => {
            await interaction.channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: false });
        });

        const embed = new EmbedBuilder()
            .setTitle('👤 User Removed from Ticket')
            .setDescription(`Successfully removed <@${targetUser.id}> (\`${targetUser.tag}\`) from this ticket.`)
            .setColor(0xed4245)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        console.error('[Tickets Engine] Error removing user from ticket:', err);
        return interaction.reply({ content: `❌ Failed to remove user: ${err.message}`, ephemeral: true });
    }
}

/**
 * Claims an active ticket for a staff member.
 */
async function handleTicketClaim(interaction) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: '⚠️ This command must be used inside an active ticket channel.', ephemeral: true });
    }

    if (ticket.claimedByUserId) {
        return interaction.reply({ content: `⚠️ This ticket is already claimed by <@${ticket.claimedByUserId}>.`, ephemeral: true });
    }

    try {
        ticket.claimedByUserId = interaction.user.id;
        await ticket.save();

        await interaction.channel.setTopic(`Ticket Channel | Claimed by ${interaction.user.tag}`).catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle('🎫 Ticket Claimed')
            .setDescription(`This ticket has been claimed by <@${interaction.user.id}>! They will be handling your request.`)
            .setColor(0x57acf2)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        console.error('[Tickets Engine] Error claiming ticket:', err);
        return interaction.reply({ content: `❌ Failed to claim ticket: ${err.message}`, ephemeral: true });
    }
}

/**
 * Unclaims an active ticket.
 */
async function handleTicketUnclaim(interaction) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: '⚠️ This command must be used inside an active ticket channel.', ephemeral: true });
    }

    if (!ticket.claimedByUserId) {
        return interaction.reply({ content: '⚠️ This ticket is not currently claimed.', ephemeral: true });
    }

    const isClaimer = interaction.user.id === ticket.claimedByUserId;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (!isClaimer && !isAdmin) {
        return interaction.reply({ content: '❌ Only the staff member who claimed this ticket or an Admin can unclaim it.', ephemeral: true });
    }

    try {
        ticket.claimedByUserId = null;
        await ticket.save();

        await interaction.channel.setTopic(`Ticket Channel | Unclaimed`).catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle('🔓 Ticket Unclaimed')
            .setDescription(`This ticket has been unclaimed by <@${interaction.user.id}> and is now open for any available staff member.`)
            .setColor(0xfaa61a)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        console.error('[Tickets Engine] Error unclaiming ticket:', err);
        return interaction.reply({ content: `❌ Failed to unclaim ticket: ${err.message}`, ephemeral: true });
    }
}

/**
 * Renames the current ticket channel.
 */
async function handleTicketRename(interaction, newName) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: '⚠️ This command must be used inside an active ticket channel.', ephemeral: true });
    }

    const safeName = newName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32);
    if (!safeName) {
        return interaction.reply({ content: '⚠️ Please provide a valid channel name.', ephemeral: true });
    }

    try {
        const oldName = interaction.channel.name;
        await interaction.channel.setName(safeName);

        const embed = new EmbedBuilder()
            .setTitle('✏️ Ticket Renamed')
            .setDescription(`Channel renamed from \`#${oldName}\` to \`#${safeName}\`.`)
            .setColor(0x57acf2)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        console.error('[Tickets Engine] Error renaming ticket:', err);
        return interaction.reply({ content: `❌ Failed to rename channel: ${err.message}`, ephemeral: true });
    }
}

/**
 * Opens a ticket via command.
 */
async function handleTicketOpenCommand(interaction, settings, topic = 'General', reason = 'No reason provided') {
    try {
        let ticketNum = (settings.ticketLastNumber || 0) + 1;
        await settings.update({ ticketLastNumber: ticketNum });

        const settingsCache = require('../../utils/settingsCache');
        settingsCache.invalidate(interaction.guildId);

        const paddedNumber = String(ticketNum).padStart(4, '0');
        const safeName = `ticket-${paddedNumber}`;

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

        const capturedIntake = {
            'Topic': topic,
            'Reason': reason
        };

        await ActiveTicket.create({
            guildId: interaction.guildId,
            channelId: ticketChannel.id,
            ownerId: interaction.user.id,
            isOpen: true,
            capturedIntake: JSON.stringify(capturedIntake)
        });

        await TicketHistory.create({
            guildId: interaction.guildId,
            channelId: ticketChannel.id,
            ownerId: interaction.user.id,
            status: 'open',
            topic: topic,
            openTime: new Date(),
            intakeResponses: JSON.stringify(capturedIntake)
        }).catch(err => console.error('Failed to log ticket to TicketHistory:', err));

        const embed = new EmbedBuilder()
            .setTitle(`🎫 Support Ticket: ${topic}`)
            .setDescription(`Thank you for opening a ticket! A staff member will assist you shortly.`)
            .addFields(
                { name: 'Topic', value: topic, inline: true },
                { name: 'Reason', value: reason, inline: true }
            )
            .setColor(0xffffff)
            .setTimestamp();

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

        return interaction.reply({ content: `✅ Ticket created! Head over to <#${ticketChannel.id}>.`, ephemeral: true });
    } catch (err) {
        console.error('[Tickets Engine] Error opening ticket command:', err);
        return interaction.reply({ content: `❌ Failed to create ticket: ${err.message}`, ephemeral: true });
    }
}

/**
 * Sets the auto-close exclusion state for an active ticket.
 */
async function handleTicketAutocloseExclude(interaction, enabledState) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: '⚠️ This command must be used inside an active ticket channel.', ephemeral: true });
    }

    const shouldExclude = enabledState !== null ? enabledState : !ticket.excludeAutoClose;

    try {
        ticket.excludeAutoClose = shouldExclude;
        await ticket.save();

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Auto-Close Exclude Updated')
            .setDescription(
                shouldExclude
                    ? '🟢 This ticket is now **EXCLUDED** from automatic 24-hour inactivity closure.'
                    : '🔴 This ticket is no longer excluded and will follow standard server auto-archive rules.'
            )
            .setColor(shouldExclude ? 0x43b581 : 0xed4245)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        console.error('[Tickets Engine] Error setting autoclose-exclude:', err);
        return interaction.reply({ content: `❌ Failed to update auto-close exclusion: ${err.message}`, ephemeral: true });
    }
}

/**
 * Automatically archives inactive tickets.
 */
async function autoArchiveTickets(client) {
    try {
        const activeTickets = await ActiveTicket.findAll({ where: { isOpen: true } });
        const settingsCache = require('../../utils/settingsCache');

        for (const ticket of activeTickets) {
            try {
                if (ticket.excludeAutoClose) continue;

                const guild = client.guilds.cache.get(ticket.guildId) || await client.guilds.fetch(ticket.guildId).catch(() => null);
                if (!guild) continue;

                const channel = guild.channels.cache.get(ticket.channelId) || await guild.channels.fetch(ticket.channelId).catch(() => null);
                if (!channel) {
                    await ticket.destroy().catch(() => {});
                    continue;
                }

                const settings = await settingsCache.get(ticket.guildId);
                if (!settings || !settings.ticketAutoArchive) continue;

                const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
                const lastMsg = messages ? messages.first() : null;
                const lastActive = lastMsg ? lastMsg.createdAt : channel.createdAt;
                const msSinceActive = Date.now() - lastActive.getTime();
                const inactiveLimit = 24 * 60 * 60 * 1000; // 24 hours

                if (msSinceActive >= inactiveLimit) {
                    console.log(`[Auto-Archive] Closing inactive ticket channel: ${channel.name} in guild: ${guild.name}`);
                    await channel.send('🔒 This ticket has been inactive for 24 hours and is being auto-archived. Compiling transcript...').catch(() => {});
                    await closeTicket(channel, ticket, settings, client.user.id, `${client.user.username} (Auto-Archive)`, client);
                }
            } catch (err) {
                console.error(`[Auto-Archive] Error processing ticket ${ticket.id}:`, err);
            }
        }
    } catch (err) {
        console.error('[Auto-Archive] Fatal error in sweeper:', err);
    }
}

module.exports = {
    handleTicketClose,
    handleTicketButton,
    handleTicketSubmit,
    autoArchiveTickets,
    handleTicketUserAdd,
    handleTicketUserRemove,
    handleTicketClaim,
    handleTicketUnclaim,
    handleTicketRename,
    handleTicketOpenCommand,
    handleTicketAutocloseExclude
};
