const { PermissionFlagsBits, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const ActiveTicket = require('../../database/models/ActiveTicket');
const TicketHistory = require('../../database/models/TicketHistory');

/**
 * Handles the ticket close button interaction.
 */
async function handleTicketClose(interaction, settings) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) return interaction.reply({ content: 'Could not resolve this ticket in database.', ephemeral: true });
    
    const isCreator = interaction.user.id === ticket.ownerId;
    const isSupport = settings.ticketSupportRoleId && interaction.member?.roles.cache.has(settings.ticketSupportRoleId);
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (!isCreator && !isSupport && !isAdmin) {
        return interaction.reply({ content: '⛔ Only the ticket creator or Support staff can close this ticket.', ephemeral: true });
    }

    await interaction.reply({ content: '🔒 Close request acknowledged. Compiling transcript and closing...', ephemeral: true });

    // Fetch and compile transcript
    const messages = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => []);
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

    let transcriptText = `# 🎫 Support Ticket Transcript: #${interaction.channel.name}\n\n`;
    transcriptText += `## 📌 Ticket Metadata\n`;
    transcriptText += `- **Guild:** ${interaction.guild.name} (${interaction.guildId})\n`;
    transcriptText += `- **Ticket Owner:** <@${ticket.ownerId}> (${ticket.ownerId})\n`;
    transcriptText += `- **Closed By:** ${interaction.user.tag} (${interaction.user.id})\n`;
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
    const transcriptFile = new AttachmentBuilder(transcriptBuffer, { name: `transcript-${interaction.channel.name}.md` });

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
            || await interaction.guild.channels.fetch(settings.loggingChannelId).catch(() => null);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('🎫 Ticket Closed & Transcribed')
                .setDescription(`**Owner:** <@${ticket.ownerId}> (${ticket.ownerId})\n**Closed By:** <@${interaction.user.id}>\n**Channel:** ${interaction.channel.name}`)
                .setColor(0x8b90a5)
                .setTimestamp();
            await logChannel.send({ embeds: [embed], files: [transcriptFile] }).catch(() => {});
        }
    }

    // Update TicketHistory record to resolved/closed
    try {
        const historyRecord = await TicketHistory.findOne({
            where: { guildId: interaction.guildId, channelId: interaction.channelId }
        });
        if (historyRecord) {
            await historyRecord.update({
                status: 'closed',
                resolveTime: new Date(),
                closedById: interaction.user.id
            });
        }
    } catch (err) {
        console.error('Failed to update TicketHistory on close:', err);
    }

    await ticket.destroy();
    setTimeout(async () => {
        await interaction.channel.delete().catch(() => {});
    }, 3000);
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
}

module.exports = {
    handleTicketClose,
    handleTicketButton,
    handleTicketSubmit
};
