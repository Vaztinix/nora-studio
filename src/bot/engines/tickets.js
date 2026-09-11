const { 
    PermissionFlagsBits, 
    ChannelType, 
    ButtonBuilder, 
    ButtonStyle, 
    ActionRowBuilder, 
    EmbedBuilder, 
    AttachmentBuilder,
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const ActiveTicket = require('../../database/models/ActiveTicket');
const TicketHistory = require('../../database/models/TicketHistory');

const TICKET_BLACKLIST_ROLE_ID = '1487865300316590130';

const TOPIC_PRESETS = {
    general: {
        label: 'General Support',
        description: 'Assistance with server features, commands, or general questions.',
        emoji: '💬',
        fields: [
            { customId: 'ticket_subject', label: 'Subject', placeholder: 'Brief summary of your inquiry', style: 'short', required: true },
            { customId: 'ticket_details', label: 'Detailed Description', placeholder: 'Explain what you need assistance with...', style: 'paragraph', required: true }
        ]
    },
    bug: {
        label: 'Bug Report',
        description: 'Report an issue, glitch, or unexpected bot behavior.',
        emoji: '🐛',
        fields: [
            { customId: 'ticket_bug_title', label: 'Bug Summary', placeholder: 'What went wrong?', style: 'short', required: true },
            { customId: 'ticket_bug_steps', label: 'Steps to Reproduce', placeholder: '1. Ran command...\n2. Clicked button...', style: 'paragraph', required: true },
            { customId: 'ticket_bug_expected', label: 'Expected Behavior', placeholder: 'What should have happened instead?', style: 'paragraph', required: false }
        ]
    },
    billing: {
        label: 'Billing & Premium',
        description: 'Inquiries about Studio Plus, subscriptions, or store purchases.',
        emoji: '💳',
        fields: [
            { customId: 'ticket_billing_order', label: 'Order ID or Discord Username', placeholder: 'Order #, transaction ID, or user tag', style: 'short', required: true },
            { customId: 'ticket_billing_desc', label: 'Inquiry Details', placeholder: 'Describe your billing question or issue...', style: 'paragraph', required: true }
        ]
    },
    inquiry: {
        label: 'Staff Inquiry & Partnerships',
        description: 'Questions for management, partnership proposals, or appeals.',
        emoji: '🤝',
        fields: [
            { customId: 'ticket_inquiry_topic', label: 'Topic / Purpose', placeholder: 'e.g. Server Partnership, Staff Application Question', style: 'short', required: true },
            { customId: 'ticket_inquiry_details', label: 'Details & Proposal', placeholder: 'Include links, details, or context...', style: 'paragraph', required: true }
        ]
    },
    support: {
        label: 'General Support',
        description: 'Assistance with server features, commands, or general questions.',
        emoji: '💬',
        fields: [
            { customId: 'ticket_subject', label: 'Subject', placeholder: 'Brief summary of your inquiry', style: 'short', required: true },
            { customId: 'ticket_details', label: 'Detailed Description', placeholder: 'Explain what you need assistance with...', style: 'paragraph', required: true }
        ]
    },
    reporting: {
        label: 'Member / Rule Report',
        description: 'Confidential report of rule violations or harassment.',
        emoji: '🛡️',
        fields: [
            { customId: 'ticket_report_target', label: 'User ID or Username Being Reported', placeholder: 'e.g. 123456789012345678 or @username', style: 'short', required: true },
            { customId: 'ticket_report_reason', label: 'Violation Details & Evidence Links', placeholder: 'Describe the incident and provide image/message links...', style: 'paragraph', required: true }
        ]
    },
    appeals: {
        label: 'Moderation Appeal',
        description: 'Appeal a mute, ban, warn, or moderation action taken against you.',
        emoji: '⚖️',
        fields: [
            { customId: 'ticket_appeal_action', label: 'Action Appealed', placeholder: 'e.g. Server Ban, Timeout, Warning', style: 'short', required: true },
            { customId: 'ticket_appeal_reason', label: 'Reason for Appeal & Context', placeholder: 'Explain why the action should be reconsidered...', style: 'paragraph', required: true }
        ]
    },
    other: {
        label: 'General Inquiry',
        description: 'Other questions or assistance from the staff team.',
        emoji: '❓',
        fields: [
            { customId: 'ticket_other_subject', label: 'Subject', placeholder: 'Brief topic of your inquiry', style: 'short', required: true },
            { customId: 'ticket_other_details', label: 'Explanation', placeholder: 'Describe your request or inquiry in detail...', style: 'paragraph', required: true }
        ]
    }
};

const PRIORITY_COLORS = {
    Low: 0x94a3b8,
    Normal: 0x5865f2,
    High: 0xf59e0b,
    Urgent: 0xef4444
};

/**
 * Creates and deploys a high-fidelity ticket panel to a channel.
 */
async function sendTicketPanel(channel, options = {}) {
    const title = options.title || 'Support & Assistance Hub';
    const description = options.description || 'Need help or want to contact server staff? Select a topic below to open a private, dedicated support ticket.';
    const color = options.color || 0x5865f2;

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .addFields(
            { name: 'General Support', value: 'Questions, permissions, or general bot help.', inline: true },
            { name: 'Bug Reports', value: 'Report command errors or unexpected glitches.', inline: true },
            { name: 'Billing & Premium', value: 'Assistance with store tiers and subscriptions.', inline: true },
            { name: 'Staff & Inquiries', value: 'Partnership requests and management inquiries.', inline: true },
            { name: 'Member Reports', value: 'Confidential reports of server rule violations.', inline: true }
        )
        .setFooter({ text: 'Nora Support Dispatch • vaztinix.dev' })
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_topic_select')
        .setPlaceholder('Select a support topic to open a ticket...')
        .addOptions([
            { label: 'General Support', value: 'general', description: 'Assistance with commands or server features', emoji: '💬' },
            { label: 'Bug Report', value: 'bug', description: 'Report an issue or unexpected error', emoji: '🐛' },
            { label: 'Billing & Premium', value: 'billing', description: 'Store orders, subscriptions, and upgrades', emoji: '💳' },
            { label: 'Staff Inquiry', value: 'inquiry', description: 'Staff questions, management, partnerships', emoji: '🤝' },
            { label: 'Player / Rule Report', value: 'report', description: 'Confidential report of rule violations', emoji: '🛡️' }
        ]);

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_general').setLabel('General Support').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ticket_bug').setLabel('Bug Report').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket_billing').setLabel('Billing').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_report').setLabel('Report User').setStyle(ButtonStyle.Danger)
    );

    return await channel.send({
        embeds: [embed],
        components: [selectRow, buttonRow]
    });
}

/**
 * Handles spawning modal when user selects a topic from the select menu.
 */
async function handleTicketSelectMenu(interaction, settings) {
    if (interaction.member?.roles?.cache?.has(TICKET_BLACKLIST_ROLE_ID)) {
        return await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⛔ Ticket Access Denied')
                    .setDescription('You have been blacklisted from creating support tickets in this server.')
                    .setColor(0xED4245)
            ],
            ephemeral: true
        });
    }
    const topicKey = interaction.values[0] || 'general';
    return await spawnTicketModal(interaction, topicKey, settings);
}

/**
 * Handles spawning modal when user clicks a button on the ticket panel.
 */
async function handleTicketButton(interaction, settings) {
    if (interaction.member?.roles?.cache?.has(TICKET_BLACKLIST_ROLE_ID)) {
        return await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⛔ Ticket Access Denied')
                    .setDescription('You have been blacklisted from creating support tickets in this server.')
                    .setColor(0xED4245)
            ],
            ephemeral: true
        });
    }
    const rawType = interaction.customId.replace('ticket_', '').toLowerCase();
    const topicKey = TOPIC_PRESETS[rawType] ? rawType : 'general';
    return await spawnTicketModal(interaction, topicKey, settings);
}

/**
 * Constructs and displays the dynamic modal for a chosen topic.
 */
async function spawnTicketModal(interaction, topicKey, settings) {
    const preset = TOPIC_PRESETS[topicKey] || TOPIC_PRESETS.general;
    
    const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_${topicKey}`)
        .setTitle(`Create Ticket: ${preset.label}`.slice(0, 45));

    let fields = preset.fields;

    let customInputs = [];
    if (settings?.ticketFormInputs) {
        try {
            customInputs = JSON.parse(settings.ticketFormInputs);
        } catch (_) {}
    }

    if (customInputs && Array.isArray(customInputs) && customInputs.length > 0) {
        fields = customInputs.slice(0, 5).map((inp, idx) => ({
            customId: inp.customId || `ticket_input_${idx}`,
            label: inp.label || `Field ${idx + 1}`,
            placeholder: inp.placeholder || '',
            style: inp.style === 'paragraph' ? 'paragraph' : 'short',
            required: !!inp.required
        }));
    }

    const rows = fields.map(f => {
        const textInput = new TextInputBuilder()
            .setCustomId(f.customId)
            .setLabel(f.label.slice(0, 45))
            .setStyle(f.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(f.required !== false)
            .setPlaceholder(f.placeholder ? f.placeholder.slice(0, 100) : '');
        return new ActionRowBuilder().addComponents(textInput);
    });

    modal.addComponents(rows);
    await interaction.showModal(modal);
}

/**
 * Handles ticket creation after modal submission.
 */
async function handleTicketSubmit(interaction, settings) {
    if (interaction.member?.roles?.cache?.has(TICKET_BLACKLIST_ROLE_ID)) {
        return await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⛔ Ticket Access Denied')
                    .setDescription('You have been blacklisted from creating support tickets in this server.')
                    .setColor(0xED4245)
            ],
            ephemeral: true
        });
    }
    const topicKey = interaction.customId.replace('ticket_modal_', '').toLowerCase();
    const preset = TOPIC_PRESETS[topicKey] || TOPIC_PRESETS.general;
    await interaction.deferReply({ ephemeral: true });

    try {
        let ticketNum = (settings.ticketLastNumber || 0) + 1;
        await settings.update({ ticketLastNumber: ticketNum });

        const settingsCache = require('../../utils/settingsCache');
        settingsCache.invalidate(interaction.guildId);

        const paddedNumber = String(ticketNum).padStart(4, '0');
        const safeName = `ticket-${paddedNumber}`;

        const capturedIntake = {};
        const fields = preset.fields;

        let customInputs = [];
        if (settings?.ticketFormInputs) {
            try {
                customInputs = JSON.parse(settings.ticketFormInputs);
            } catch (_) {}
        }

        if (customInputs && Array.isArray(customInputs) && customInputs.length > 0) {
            customInputs.slice(0, 5).forEach((inp, idx) => {
                const id = inp.customId || `ticket_input_${idx}`;
                const label = inp.label || `Field ${idx + 1}`;
                try {
                    capturedIntake[label] = interaction.fields.getTextInputValue(id) || 'N/A';
                } catch (_) {
                    capturedIntake[label] = 'N/A';
                }
            });
        } else {
            fields.forEach(f => {
                try {
                    capturedIntake[f.label] = interaction.fields.getTextInputValue(f.customId) || 'N/A';
                } catch (_) {
                    capturedIntake[f.label] = 'N/A';
                }
            });
        }

        const permissionOverwrites = [
            {
                id: interaction.guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks
                ]
            },
            {
                id: interaction.client.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.AttachFiles
                ]
            }
        ];

        if (settings?.ticketSupportRoleId) {
            permissionOverwrites.push({
                id: settings.ticketSupportRoleId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks
                ]
            });
        }

        const ticketChannel = await interaction.guild.channels.create({
            name: safeName,
            type: ChannelType.GuildText,
            parent: settings?.ticketCategoryId || null,
            permissionOverwrites,
            topic: `Ticket #${paddedNumber} | Topic: ${preset.label} | Owner: ${interaction.user.tag} (${interaction.user.id}) | Priority: Normal`
        });

        await ActiveTicket.create({
            guildId: interaction.guildId,
            channelId: ticketChannel.id,
            ownerId: interaction.user.id,
            topic: preset.label,
            priority: 'Normal',
            isOpen: true,
            capturedIntake: JSON.stringify(capturedIntake),
            staffNotes: '[]'
        });

        await TicketHistory.create({
            guildId: interaction.guildId,
            channelId: ticketChannel.id,
            ownerId: interaction.user.id,
            status: 'open',
            topic: preset.label,
            priority: 'Normal',
            openTime: new Date(),
            intakeResponses: JSON.stringify(capturedIntake)
        }).catch(err => console.error('[Ticket Engine] Failed to record TicketHistory:', err));

        const headerEmbed = new EmbedBuilder()
            .setTitle(`Support Ticket #${paddedNumber}: ${preset.label}`)
            .setDescription(`Hello <@${interaction.user.id}>, welcome to your support ticket. A staff member will be with you shortly. Please review your submitted details below.`)
            .setColor(PRIORITY_COLORS.Normal)
            .addFields(
                { name: 'Owner', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
                { name: 'Topic', value: preset.label, inline: true },
                { name: 'Priority', value: '`Normal`', inline: true }
            )
            .setFooter({ text: 'Nora Support Engine • Use /ticket to manage' })
            .setTimestamp();

        Object.entries(capturedIntake).forEach(([lbl, val]) => {
            if (val && val !== 'N/A') {
                headerEmbed.addFields({ name: lbl, value: String(val).slice(0, 1024), inline: false });
            }
        });

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_claim_btn')
                .setLabel('Claim Ticket')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`ticket_close_${interaction.user.id}`)
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({
            content: `<@${interaction.user.id}> ${settings?.ticketSupportRoleId ? `<@&${settings.ticketSupportRoleId}>` : ''}`,
            embeds: [headerEmbed],
            components: [actionRow]
        });

        return await interaction.editReply({
            content: `Your support ticket has been created! Head over to <#${ticketChannel.id}>.`
        });
    } catch (err) {
        console.error('[Ticket Engine] Creation error:', err);
        return await interaction.editReply({
            content: `Failed to create support ticket: ${err.message}`
        });
    }
}

/**
 * Handles initiating the close modal dialog.
 */
async function handleTicketClose(interaction, settings) {
    try {
        const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
        if (!ticket) {
            const msg = 'This channel does not correspond to an active ticket.';
            if (interaction.deferred || interaction.replied) return await interaction.editReply({ content: msg });
            return await interaction.reply({ content: msg, ephemeral: true });
        }

        const isCreator = interaction.user.id === ticket.ownerId;
        const isSupport = settings?.ticketSupportRoleId && interaction.member?.roles.cache.has(settings.ticketSupportRoleId);
        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

        if (!isCreator && !isSupport && !isAdmin) {
            const msg = 'Only the ticket creator or authorized staff can close this ticket.';
            if (interaction.deferred || interaction.replied) return await interaction.editReply({ content: msg });
            return await interaction.reply({ content: msg, ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId(`ticket_close_modal_${interaction.channelId}`)
            .setTitle('Close Support Ticket');

        const reasonInput = new TextInputBuilder()
            .setCustomId('close_reason')
            .setLabel('Resolution Summary / Reason')
            .setPlaceholder('e.g. Issue resolved, user assisted, or duplicate ticket')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        return await interaction.showModal(modal);
    } catch (err) {
        console.error('[Ticket Engine] Close init error:', err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: `Error initiating close: ${err.message}`, ephemeral: true });
        }
    }
}

/**
 * Handles close reason submission from modal and triggers final close.
 */
async function handleTicketCloseModalSubmit(interaction, settings) {
    await interaction.deferReply({ ephemeral: true });
    try {
        const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
        if (!ticket) {
            return await interaction.editReply({ content: 'Could not resolve ticket in database.' });
        }

        const reason = interaction.fields.getTextInputValue('close_reason') || 'Resolved by user/staff';
        await interaction.editReply({ content: 'Closing ticket and generating transcript...' });

        await closeTicket(interaction.channel, ticket, settings, interaction.user.id, interaction.user.tag, interaction.client, reason);
    } catch (err) {
        console.error('[Ticket Engine] Close modal submit error:', err);
        await interaction.editReply({ content: `Failed to close ticket: ${err.message}` });
    }
}

/**
 * Core close logic: fetches messages, builds markdown transcript, logs, DMs owner with rating prompt, and deletes channel.
 */
async function closeTicket(channel, ticket, settings, closedByUserId, closedByTag, client, closeReason = 'Resolved') {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => []);
    const sortedMessages = [...messages.values()].reverse();

    let intakeText = '';
    if (ticket.capturedIntake) {
        try {
            const parsed = JSON.parse(ticket.capturedIntake);
            intakeText = Object.entries(parsed)
                .map(([lbl, val]) => `* **${lbl}**: ${val}`)
                .join('\n');
        } catch (_) {
            intakeText = `* **Intake**: ${ticket.capturedIntake}`;
        }
    } else {
        intakeText = '*No intake data provided.*';
    }

    let staffNotesText = '';
    if (ticket.staffNotes) {
        try {
            const notes = JSON.parse(ticket.staffNotes);
            if (Array.isArray(notes) && notes.length > 0) {
                staffNotesText = notes.map(n => `* **[${new Date(n.timestamp).toLocaleTimeString()}] ${n.authorTag}**: ${n.note}`).join('\n');
            }
        } catch (_) {}
    }

    let transcript = `# Support Ticket Transcript: #${channel.name}\n\n`;
    transcript += `## Ticket Details\n`;
    transcript += `- **Server:** ${channel.guild.name} (${channel.guild.id})\n`;
    transcript += `- **Topic:** ${ticket.topic || 'General Support'}\n`;
    transcript += `- **Priority:** ${ticket.priority || 'Normal'}\n`;
    transcript += `- **Owner:** <@${ticket.ownerId}> (${ticket.ownerId})\n`;
    transcript += `- **Closed By:** ${closedByTag} (${closedByUserId})\n`;
    transcript += `- **Close Reason:** ${closeReason}\n`;
    transcript += `- **Closed At:** ${new Date().toUTCString()}\n\n`;
    
    transcript += `## Intake Responses\n${intakeText}\n\n`;
    
    if (staffNotesText) {
        transcript += `## Staff Internal Notes\n${staffNotesText}\n\n`;
    }

    transcript += `## Message Logs\n`;
    sortedMessages.forEach(msg => {
        const time = new Date(msg.createdAt).toLocaleTimeString();
        const attachments = msg.attachments.map(a => a.url).join(', ');
        const attachSuffix = attachments ? ` [Attachments: ${attachments}]` : '';
        transcript += `* [${time}] **${msg.author.tag}**: ${msg.content}${attachSuffix}\n`;
    });

    const transcriptBuffer = Buffer.from(transcript, 'utf-8');
    const transcriptFile = new AttachmentBuilder(transcriptBuffer, { name: `transcript-${channel.name}.md` });

    // Send DM to Owner with transcript & Rating Feedback Buttons
    const owner = await client.users.fetch(ticket.ownerId).catch(() => null);
    if (owner) {
        try {
            const ratingRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ticket_rate_1_${ticket.id}`).setLabel('⭐ 1').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`ticket_rate_2_${ticket.id}`).setLabel('⭐ 2').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`ticket_rate_3_${ticket.id}`).setLabel('⭐ 3').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`ticket_rate_4_${ticket.id}`).setLabel('⭐ 4').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`ticket_rate_5_${ticket.id}`).setLabel('⭐ 5 (Excellent)').setStyle(ButtonStyle.Success)
            );

            const dmEmbed = new EmbedBuilder()
                .setTitle(`Support Ticket Closed: #${channel.name}`)
                .setDescription(`Your support ticket in **${channel.guild.name}** has been closed.\n\n**Reason:** ${closeReason}\n\nAttached is your full conversation transcript. How would you rate the support you received?`)
                .setColor(0x5865f2)
                .setFooter({ text: 'Nora Support Feedback' })
                .setTimestamp();

            await owner.send({
                embeds: [dmEmbed],
                files: [transcriptFile],
                components: [ratingRow]
            });
        } catch (_) {}
    }

    // Send to Moderation/Audit Log Channel
    const loggerUtil = require('../../utils/logger');
    const targetLogId = loggerUtil.resolveLogChannelId(settings, 'moderation');
    if (targetLogId) {
        const logChannel = channel.guild.channels.cache.get(targetLogId)
            || await channel.guild.channels.fetch(targetLogId).catch(() => null);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('Ticket Closed & Transcribed')
                .setDescription(`**Channel:** #${channel.name}\n**Topic:** ${ticket.topic || 'General'}\n**Owner:** <@${ticket.ownerId}>\n**Closed By:** <@${closedByUserId}>\n**Reason:** ${closeReason}`)
                .setColor(0x94a3b8)
                .setTimestamp();
            await logChannel.send({ embeds: [logEmbed], files: [transcriptFile] }).catch(() => {});
        }
    }

    try {
        const history = await TicketHistory.findOne({
            where: { guildId: channel.guild.id, channelId: channel.id }
        });
        if (history) {
            await history.update({
                status: 'closed',
                resolveTime: new Date(),
                closedById: closedByUserId,
                closeReason: closeReason
            });
        }
    } catch (e) {
        console.error('[Ticket Engine] Failed updating history on close:', e);
    }

    await ticket.destroy().catch(() => {});

    setTimeout(async () => {
        await channel.delete().catch(() => {});
    }, 2000);
}

/**
 * Handles rating feedback button click from user DM.
 */
async function handleTicketRating(interaction) {
    const parts = interaction.customId.split('_');
    const stars = parseInt(parts[2], 10) || 5;
    const ticketId = parts[3];

    try {
        if (ticketId) {
            const history = await TicketHistory.findOne({ where: { id: ticketId } });
            if (history) {
                await history.update({ rating: stars });
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('Feedback Received')
            .setDescription(`Thank you! You rated your support experience **${stars} / 5 Stars** (${'⭐'.repeat(stars)}). Your feedback helps improve support quality!`)
            .setColor(0x10b981)
            .setTimestamp();

        return await interaction.update({
            embeds: [embed],
            components: []
        });
    } catch (err) {
        console.error('[Ticket Engine] Rating error:', err);
        return await interaction.reply({ content: 'Thank you for your rating feedback!', ephemeral: true });
    }
}

/**
 * Changes the ticket priority level and updates channel topic.
 */
async function handleTicketPriority(interaction, level) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: 'This command must be used inside an active ticket channel.', ephemeral: true });
    }

    const validLevels = ['Low', 'Normal', 'High', 'Urgent'];
    const chosen = validLevels.find(l => l.toLowerCase() === level.toLowerCase()) || 'Normal';

    try {
        ticket.priority = chosen;
        await ticket.save();

        const color = PRIORITY_COLORS[chosen] || 0x5865f2;
        await interaction.channel.setTopic(`Ticket Channel | Topic: ${ticket.topic} | Priority: ${chosen}`).catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle('Priority Updated')
            .setDescription(`Ticket priority has been set to **${chosen}**.`)
            .setColor(color)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        return interaction.reply({ content: `Failed to update priority: ${err.message}`, ephemeral: true });
    }
}

/**
 * Adds or views internal staff notes on an active ticket.
 */
async function handleTicketStaffNote(interaction, action, noteText) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: 'This command must be used inside an active ticket channel.', ephemeral: true });
    }

    let notes = [];
    try {
        notes = JSON.parse(ticket.staffNotes || '[]');
    } catch (_) {
        notes = [];
    }

    if (action === 'view') {
        if (notes.length === 0) {
            return interaction.reply({ content: 'There are no internal staff notes attached to this ticket.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle(`Staff Notes: #${interaction.channel.name}`)
            .setColor(0x5865f2)
            .setDescription(notes.map((n, idx) => `**#${idx + 1}** <t:${Math.floor(new Date(n.timestamp).getTime() / 1000)}:R> by **${n.authorTag}**:\n${n.note}`).join('\n\n'))
            .setFooter({ text: 'Internal staff notes are included in closed transcripts.' });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (!noteText) {
        return interaction.reply({ content: 'Please provide note text to add.', ephemeral: true });
    }

    notes.push({
        authorId: interaction.user.id,
        authorTag: interaction.user.tag,
        note: noteText,
        timestamp: new Date().toISOString()
    });

    ticket.staffNotes = JSON.stringify(notes);
    await ticket.save();

    const embed = new EmbedBuilder()
        .setTitle('Staff Note Added')
        .setDescription(`New staff note recorded by <@${interaction.user.id}>:\n> ${noteText}`)
        .setColor(0x10b981)
        .setTimestamp();

    return interaction.reply({ embeds: [embed] });
}

/**
 * Transfers ticket ownership / assigned staff member.
 */
async function handleTicketTransfer(interaction, targetStaff) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: 'This command must be used inside an active ticket channel.', ephemeral: true });
    }

    try {
        ticket.claimedByUserId = targetStaff.id;
        await ticket.save();

        await interaction.channel.permissionOverwrites.edit(targetStaff.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true
        });

        await interaction.channel.setTopic(`Ticket Channel | Claimed by ${targetStaff.tag}`).catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle('Ticket Transferred')
            .setDescription(`This ticket has been transferred and assigned to <@${targetStaff.id}>.`)
            .setColor(0x5865f2)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        return interaction.reply({ content: `Failed to transfer ticket: ${err.message}`, ephemeral: true });
    }
}

/**
 * Handles claim button click on ticket header embed.
 */
async function handleTicketClaimButton(interaction, settings) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: 'Could not resolve this ticket in database.', ephemeral: true });
    }

    const isSupport = settings?.ticketSupportRoleId && interaction.member?.roles.cache.has(settings.ticketSupportRoleId);
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (!isSupport && !isAdmin) {
        return interaction.reply({ content: 'Only Support staff can claim tickets.', ephemeral: true });
    }

    if (ticket.claimedByUserId) {
        return interaction.reply({ content: `This ticket is already claimed by <@${ticket.claimedByUserId}>.`, ephemeral: true });
    }

    try {
        ticket.claimedByUserId = interaction.user.id;
        await ticket.save();

        await interaction.channel.setTopic(`Ticket Channel | Claimed by ${interaction.user.tag}`).catch(() => {});

        const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_unclaim_btn')
                .setLabel(`Unclaim (${interaction.user.username})`)
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`ticket_close_${ticket.ownerId}`)
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.update({ components: [newRow] });

        const embed = new EmbedBuilder()
            .setTitle('Ticket Claimed')
            .setDescription(`This ticket has been claimed by <@${interaction.user.id}>. They will assist you with your inquiry.`)
            .setColor(0x5865f2)
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] }).catch(() => {});
    } catch (err) {
        return interaction.reply({ content: `Failed to claim ticket: ${err.message}`, ephemeral: true });
    }
}

/**
 * Handles unclaim button click on ticket header embed.
 */
async function handleTicketUnclaimButton(interaction, settings) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: 'Could not resolve this ticket in database.', ephemeral: true });
    }

    if (!ticket.claimedByUserId) {
        return interaction.reply({ content: 'This ticket is not currently claimed.', ephemeral: true });
    }

    const isClaimer = interaction.user.id === ticket.claimedByUserId;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (!isClaimer && !isAdmin) {
        return interaction.reply({ content: `Only <@${ticket.claimedByUserId}> or an Administrator can unclaim this ticket.`, ephemeral: true });
    }

    try {
        ticket.claimedByUserId = null;
        await ticket.save();

        await interaction.channel.setTopic(`Ticket Channel | Unclaimed`).catch(() => {});

        const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_claim_btn')
                .setLabel('Claim Ticket')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`ticket_close_${ticket.ownerId}`)
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.update({ components: [newRow] });

        const embed = new EmbedBuilder()
            .setTitle('Ticket Unclaimed')
            .setDescription(`This ticket has been unclaimed by <@${interaction.user.id}> and is open for any available staff member.`)
            .setColor(0xf59e0b)
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] }).catch(() => {});
    } catch (err) {
        return interaction.reply({ content: `Failed to unclaim ticket: ${err.message}`, ephemeral: true });
    }
}

/**
 * Adds a user to the active ticket channel.
 */
async function handleTicketUserAdd(interaction, targetUser) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: 'This command must be used inside an active ticket channel.', ephemeral: true });
    }

    try {
        await interaction.channel.permissionOverwrites.edit(targetUser.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true
        });

        const embed = new EmbedBuilder()
            .setTitle('User Added')
            .setDescription(`Successfully added <@${targetUser.id}> (\`${targetUser.tag}\`) to this ticket.`)
            .setColor(0x10b981)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        return interaction.reply({ content: `Failed to add user: ${err.message}`, ephemeral: true });
    }
}

/**
 * Removes a user from the active ticket channel.
 */
async function handleTicketUserRemove(interaction, targetUser) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: 'This command must be used inside an active ticket channel.', ephemeral: true });
    }

    if (targetUser.id === ticket.ownerId) {
        return interaction.reply({ content: 'You cannot remove the ticket creator from their own ticket.', ephemeral: true });
    }

    try {
        await interaction.channel.permissionOverwrites.delete(targetUser.id).catch(async () => {
            await interaction.channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: false });
        });

        const embed = new EmbedBuilder()
            .setTitle('User Removed')
            .setDescription(`Successfully removed <@${targetUser.id}> (\`${targetUser.tag}\`) from this ticket.`)
            .setColor(0xef4444)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        return interaction.reply({ content: `Failed to remove user: ${err.message}`, ephemeral: true });
    }
}

/**
 * Renames the current ticket channel.
 */
async function handleTicketRename(interaction, newName) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: 'This command must be used inside an active ticket channel.', ephemeral: true });
    }

    const safeName = newName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32);
    if (!safeName) {
        return interaction.reply({ content: 'Please provide a valid channel name.', ephemeral: true });
    }

    try {
        const oldName = interaction.channel.name;
        await interaction.channel.setName(safeName);

        const embed = new EmbedBuilder()
            .setTitle('Ticket Renamed')
            .setDescription(`Channel renamed from \`#${oldName}\` to \`#${safeName}\`.`)
            .setColor(0x5865f2)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        return interaction.reply({ content: `Failed to rename channel: ${err.message}`, ephemeral: true });
    }
}

/**
 * Sets the auto-close exclusion state for an active ticket.
 */
async function handleTicketAutocloseExclude(interaction, enabledState) {
    const ticket = await ActiveTicket.findOne({ where: { channelId: interaction.channelId } });
    if (!ticket) {
        return interaction.reply({ content: 'This command must be used inside an active ticket channel.', ephemeral: true });
    }

    const shouldExclude = enabledState !== null ? enabledState : !ticket.excludeAutoClose;

    try {
        ticket.excludeAutoClose = shouldExclude;
        await ticket.save();

        const embed = new EmbedBuilder()
            .setTitle('Auto-Close Policy Updated')
            .setDescription(
                shouldExclude
                    ? 'This ticket is now **EXCLUDED** from automatic 24-hour inactivity closure.'
                    : 'This ticket will now follow standard server auto-archive rules.'
            )
            .setColor(shouldExclude ? 0x10b981 : 0xef4444)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        return interaction.reply({ content: `Failed to update auto-close exclusion: ${err.message}`, ephemeral: true });
    }
}

/**
 * Opens a ticket via command.
 */
async function handleTicketOpenCommand(interaction, settings, topic = 'General Support', reason = 'No details provided') {
    if (interaction.member?.roles?.cache?.has(TICKET_BLACKLIST_ROLE_ID)) {
        return await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⛔ Ticket Access Denied')
                    .setDescription('You have been blacklisted from creating support tickets in this server.')
                    .setColor(0xED4245)
            ],
            ephemeral: true
        });
    }

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
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks
                ]
            },
            {
                id: interaction.client.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.AttachFiles
                ]
            }
        ];

        if (settings?.ticketSupportRoleId) {
            permissionOverwrites.push({
                id: settings.ticketSupportRoleId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks
                ]
            });
        }

        const ticketChannel = await interaction.guild.channels.create({
            name: safeName,
            type: ChannelType.GuildText,
            parent: settings?.ticketCategoryId || null,
            permissionOverwrites,
            topic: `Ticket #${paddedNumber} | Topic: ${topic} | Owner: ${interaction.user.tag}`
        });

        const capturedIntake = {
            'Topic': topic,
            'Reason': reason
        };

        await ActiveTicket.create({
            guildId: interaction.guildId,
            channelId: ticketChannel.id,
            ownerId: interaction.user.id,
            topic: topic,
            priority: 'Normal',
            isOpen: true,
            capturedIntake: JSON.stringify(capturedIntake),
            staffNotes: '[]'
        });

        await TicketHistory.create({
            guildId: interaction.guildId,
            channelId: ticketChannel.id,
            ownerId: interaction.user.id,
            status: 'open',
            topic: topic,
            priority: 'Normal',
            openTime: new Date(),
            intakeResponses: JSON.stringify(capturedIntake)
        }).catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle(`Support Ticket #${paddedNumber}: ${topic}`)
            .setDescription(`Hello <@${interaction.user.id}>, welcome to your support ticket. A staff member will assist you shortly.`)
            .setColor(0x5865f2)
            .addFields(
                { name: 'Owner', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Topic', value: topic, inline: true },
                { name: 'Details', value: reason, inline: false }
            )
            .setFooter({ text: 'Nora Support Dispatch' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_claim_btn').setLabel('Claim Ticket').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`ticket_close_${interaction.user.id}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({
            content: `<@${interaction.user.id}> ${settings?.ticketSupportRoleId ? `<@&${settings.ticketSupportRoleId}>` : ''}`,
            embeds: [embed],
            components: [row]
        });

        return interaction.reply({ content: `Ticket created! Head over to <#${ticketChannel.id}>.`, ephemeral: true });
    } catch (err) {
        return interaction.reply({ content: `Failed to create ticket: ${err.message}`, ephemeral: true });
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
                    await channel.send('This ticket has been inactive for 24 hours and is being automatically archived. Generating transcript...').catch(() => {});
                    await closeTicket(channel, ticket, settings, client.user.id, `${client.user.username} (Auto-Archive)`, client, 'Automated Inactivity Archive');
                }
            } catch (err) {
                console.error(`[Auto-Archive] Error on ticket ${ticket.id}:`, err);
            }
        }
    } catch (err) {
        console.error('[Auto-Archive] Fatal error in sweeper:', err);
    }
}

module.exports = {
    sendTicketPanel,
    handleTicketClose,
    handleTicketCloseModalSubmit,
    handleTicketButton,
    handleTicketSelectMenu,
    handleTicketSubmit,
    handleTicketRating,
    handleTicketPriority,
    handleTicketStaffNote,
    handleTicketTransfer,
    autoArchiveTickets,
    handleTicketUserAdd,
    handleTicketUserRemove,
    handleTicketClaimButton,
    handleTicketUnclaimButton,
    handleTicketRename,
    handleTicketOpenCommand,
    handleTicketAutocloseExclude
};
