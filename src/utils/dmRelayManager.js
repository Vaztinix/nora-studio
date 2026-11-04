const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const UnderageSuspension = require('../database/models/UnderageSuspension');

const DEVELOPER_ID = '1214048435632603137';

/**
 * Downloads and buffers an attachment so it can be re-uploaded reliably to Discord
 * without hitting raw CDN url expiration or cross-domain fetch barriers.
 * @param {import('discord.js').Attachment} attachment
 * @param {string} defaultPrefix
 * @returns {Promise<{ builder: AttachmentBuilder, name: string, isImage: boolean, size: number, url: string } | null>}
 */
async function bufferAttachment(attachment, defaultPrefix = 'attachment') {
    try {
        if (!attachment || !attachment.url) return null;
        const res = await fetch(attachment.url);
        if (!res.ok) return null;
        const arrayBuf = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const extMatch = (attachment.name || '').match(/\.(png|jpe?g|webp|gif|svg|bmp|pdf|txt|docx?)$/i);
        const ext = extMatch ? extMatch[1].toLowerCase() : 'png';
        const isImage = (attachment.contentType && attachment.contentType.startsWith('image/')) || /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(attachment.name || '') || /\.(png|jpe?g|webp|gif)($|\?)/i.test(attachment.url);
        const cleanName = `${defaultPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        return {
            builder: new AttachmentBuilder(buffer, { name: cleanName }),
            name: cleanName,
            isImage,
            size: buffer.length,
            url: attachment.url
        };
    } catch (e) {
        console.error('[DMRelayManager] Failed to buffer attachment:', e.message);
        return null;
    }
}

class DMRelayManager {
    constructor() {
        // In-memory cache of messageId -> targetUserId
        this.relayCache = new Map();
        // In-memory pending messages awaiting user confirmation: userId -> { content, attachments, timestamp, messageId, author }
        this.pendingUserDMs = new Map();
        // In-memory message history: userId -> Array<{ content, timestamp, isFromUser, attachments }>
        this.userMessageHistory = new Map();
        // Set of highlighted user IDs (marked by staff for priority attention)
        this.highlightedUsers = new Set();
    }

    /**
     * Resolves the target user ID from a referenced message
     * @param {import('discord.js').Message} refMsg
     * @returns {string|null}
     */
    extractTargetUserId(refMsg) {
        if (!refMsg) return null;

        // 1. Check in-memory cache
        if (this.relayCache.has(refMsg.id)) {
            return this.relayCache.get(refMsg.id);
        }

        // 2. Check embed footer (e.g. "User ID: 123456789012345678")
        if (refMsg.embeds && refMsg.embeds.length > 0) {
            for (const embed of refMsg.embeds) {
                if (embed.footer && embed.footer.text) {
                    const match = embed.footer.text.match(/User ID:\s*(\d{17,20})/i);
                    if (match) return match[1];
                }
                if (embed.fields && embed.fields.length > 0) {
                    for (const field of embed.fields) {
                        if (field.name.toLowerCase().includes('user id') || field.name.toLowerCase().includes('user')) {
                            const match = field.value.match(/(\d{17,20})/);
                            if (match) return match[1];
                        }
                    }
                }
                if (embed.description) {
                    const match = embed.description.match(/<@!?(\d{17,20})>/);
                    if (match) return match[1];
                }
            }
        }

        // 3. Check message content for user mentions or raw snowflake ID
        if (refMsg.content) {
            const mentionMatch = refMsg.content.match(/<@!?(\d{17,20})>/);
            if (mentionMatch) return mentionMatch[1];

            const idMatch = refMsg.content.match(/\b(\d{17,20})\b/);
            if (idMatch) return idMatch[1];
        }

        return null;
    }

    /**
     * Main DM event handler called from messageCreate
     * @param {import('discord.js').Message} message
     * @param {import('discord.js').Client} client
     * @returns {Promise<boolean>} true if handled as a DM relay
     */
    async handleDirectMessage(message, client) {
        if (!message || message.guild || !message.author || message.author.bot) {
            return false;
        }

        const isDeveloper = message.author.id === DEVELOPER_ID;

        // ========================================================
        // CASE A: Developer replying to a user's forwarded message
        // ========================================================
        if (isDeveloper) {
            // Check for Discord Reply (message.reference)
            if (message.reference && message.reference.messageId) {
                const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                const targetUserId = this.extractTargetUserId(refMsg);

                if (!targetUserId) {
                    await message.reply({
                        content: `⚠️ Could not find a target User ID in that referenced message. You can also use \`!dm <userId> <message>\`.`,
                        allowedMentions: { repliedUser: false }
                    }).catch(() => {});
                    return true;
                }

                if (targetUserId === DEVELOPER_ID) {
                    await message.reply({
                        content: `⚠️ That message references your own ID.`,
                        allowedMentions: { repliedUser: false }
                    }).catch(() => {});
                    return true;
                }

                return await this.sendReplyToUser(message, client, targetUserId);
            }

            // Check for manual command: !dm <userId> [message...] or !reply <userId> [message...]
            const cmdMatch = message.content.match(/^!(?:reply|dm|msg|send)\s+(\d{17,20})(?:\s+([\s\S]*))?$/i);
            if (cmdMatch) {
                const targetUserId = cmdMatch[1];
                const contentToSend = cmdMatch[2] ? cmdMatch[2].trim() : '';
                return await this.sendReplyToUser(message, client, targetUserId, contentToSend);
            }

            return false;
        }

        // ========================================================
        // CASE B: Regular user DMing Nora (Support vs AI Prompt)
        // ========================================================
        return await this.handleUserDMIncoming(message, client);
    }

    /**
     * Forwards a regular user's DM to the developer (Vaztinix) with full image & appeal support
     */
    /**
     * Intercepts incoming user DMs and asks every time if they wish to forward to Support or chat with Nora
     * @param {import('discord.js').Message} message
     * @param {import('discord.js').Client} client
     */
    async handleUserDMIncoming(message, client) {
        try {
            // Check if user has an active underage suspension record
            let suspension = null;
            try {
                suspension = await UnderageSuspension.findOne({
                    where: { userId: message.author.id },
                    order: [['createdAt', 'DESC']]
                });
            } catch (err) {}

            // Record into volatile user message history
            let userHistory = this.userMessageHistory.get(message.author.id);
            if (!userHistory) {
                userHistory = [];
                this.userMessageHistory.set(message.author.id, userHistory);
            }
            userHistory.push({
                content: message.content || '',
                timestamp: Date.now(),
                isFromUser: true
            });
            if (userHistory.length > 25) userHistory.shift();

            const isHighlighted = this.highlightedUsers.has(message.author.id);
            const appealKeywords = /\b(appeal|unban|unmute|suspension|suspended|suspend|proof|dob|birthday|birthdate|age|underage|13|id|passport|license|reinstate|re-appeal)\b/i;
            const isAppeal = Boolean(suspension) || appealKeywords.test(message.content || '');

            // Formal suspension appeals bypass the prompt and forward immediately
            if (isAppeal) {
                return await this.forwardUserDMToDeveloper(message, client, true);
            }

            // Save pending DM awaiting user confirmation
            this.pendingUserDMs.set(message.author.id, {
                content: message.content || '',
                attachments: message.attachments,
                timestamp: Date.now(),
                messageId: message.id,
                author: message.author
            });

            const previewText = message.content && message.content.trim().length > 0
                ? (message.content.length > 500 ? message.content.slice(0, 497) + '...' : message.content)
                : (message.attachments && message.attachments.size > 0 ? '*[Image/File Attachment]*' : '*[Empty Message]*');

            const promptEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setAuthor({
                    name: 'Nora Support & Direct Message Relay',
                    iconURL: client.user.displayAvatarURL()
                })
                .setTitle('📬 Direct Message Received')
                .setDescription(
                    `Hey **${message.author.username}**! I received your message.\n\n` +
                    `Would you like to **forward this directly to Support** so **Vaztinix** (<@${DEVELOPER_ID}>) can assist you personally, or would you like to **chat with Nora**?`
                )
                .addFields({
                    name: '💬 Your Message',
                    value: `>>> ${previewText}`,
                    inline: false
                })
                .setFooter({ text: 'Choose an option below • Nora Zero-Access Privacy' })
                .setTimestamp();

            const promptRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`dm_forward_support_${message.author.id}`)
                    .setLabel('Forward to Support')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📩'),
                new ButtonBuilder()
                    .setCustomId(`dm_chat_nora_${message.author.id}`)
                    .setLabel('Chat with Nora')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('💬'),
                new ButtonBuilder()
                    .setCustomId(`dm_cancel_${message.author.id}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('✖️')
            );

            await message.reply({ embeds: [promptEmbed], components: [promptRow] });
            return true;
        } catch (err) {
            console.error('[DMRelayManager] Error in handleUserDMIncoming:', err);
            return false;
        }
    }

    /**
     * Handles user clicking one of the 3 choice buttons on the DM prompt
     */
    async handleUserPromptChoice(interaction, client) {
        const userId = interaction.user.id;
        const customId = interaction.customId;

        if (!customId.endsWith(userId)) {
            return interaction.reply({ content: '❌ This prompt is not for your account.', ephemeral: true });
        }

        const pending = this.pendingUserDMs.get(userId);

        if (customId.startsWith('dm_cancel_')) {
            this.pendingUserDMs.delete(userId);
            const cancelEmbed = new EmbedBuilder()
                .setColor(0x6B7280)
                .setTitle('✖️ Message Cancelled')
                .setDescription('Your message was not forwarded and no data was retained.')
                .setTimestamp();
            return await interaction.update({ embeds: [cancelEmbed], components: [] }).catch(() => {});
        }

        if (customId.startsWith('dm_chat_nora_')) {
            this.pendingUserDMs.delete(userId);
            await interaction.deferUpdate().catch(() => {});

            const userPrompt = pending ? pending.content : '';
            let responseText = null;

            try {
                const { getBuiltInResponse } = require('./builtInBrain');
                responseText = await getBuiltInResponse(userPrompt || 'Hello Nora!', {
                    authorName: interaction.user.username,
                    isVoiceMode: false
                });
            } catch (aiErr) {
                responseText = null;
            }

            if (!responseText || typeof responseText !== 'string') {
                const geminiKeyManager = require('./geminiKeyManager');
                if (geminiKeyManager.areAllKeysOnCooldown()) {
                    responseText = geminiKeyManager.getQuotaNotice();
                } else {
                    const { getPrivacyResponse } = require('./privateBrain');
                    responseText = await getPrivacyResponse(userPrompt || 'Hello Nora!');
                }
            }

            const chatEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setAuthor({
                    name: 'Nora',
                    iconURL: client.user.displayAvatarURL()
                })
                .setDescription(responseText)
                .setFooter({ text: 'Nora Companion AI • Direct Chat' })
                .setTimestamp();

            return await interaction.editReply({ embeds: [chatEmbed], components: [] }).catch(() => {});
        }

        if (customId.startsWith('dm_forward_support_')) {
            if (!pending) {
                return await interaction.update({
                    content: '⚠️ Message session expired. Please type your message again in this chat.',
                    embeds: [],
                    components: []
                }).catch(() => {});
            }

            this.pendingUserDMs.delete(userId);
            await interaction.deferUpdate().catch(() => {});

            // Package as simulated message and forward strictly to Vaztinix's DMs
            const simulatedMessage = {
                author: pending.author || interaction.user,
                content: pending.content,
                attachments: pending.attachments || new Map(),
                id: pending.messageId || interaction.id
            };

            const success = await this.forwardUserDMToDeveloper(simulatedMessage, client, false);

            if (success) {
                const deliveredEmbed = new EmbedBuilder()
                    .setTitle('✅ Delivered to Vaztinix')
                    .setColor(0x10B981)
                    .setDescription(
                        `Your message has been delivered directly to **Vaztinix** (<@${DEVELOPER_ID}>)!\n\n` +
                        `When they reply, Nora will deliver their message right here in this DM chat. You can reply anytime to send more details or images.`
                    )
                    .setFooter({ text: 'Nora Support Relay • Zero-Access RAM Architecture' })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [deliveredEmbed], components: [] }).catch(() => {});
            } else {
                return await interaction.editReply({
                    content: '⚠️ Failed to deliver message to support at this moment. Please try again shortly or join our Discord server at https://discord.gg/m9WPYV287q',
                    embeds: [],
                    components: []
                }).catch(() => {});
            }
        }
    }

    /**
     * Handles developer / staff buttons on forwarded DMs
     */
    async handleStaffAction(interaction, client) {
        if (interaction.user.id !== DEVELOPER_ID) {
            return interaction.reply({ content: '❌ You are not authorized to use staff DM controls.', ephemeral: true });
        }

        const customId = interaction.customId;
        const targetUserId = customId.split('_').pop();
        const targetUser = client.users.cache.get(targetUserId) || await client.users.fetch(targetUserId).catch(() => null);

        // 1. Quick Reply Modal
        if (customId.startsWith('dm_quick_reply_')) {
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
            const modal = new ModalBuilder()
                .setCustomId(`dm_modal_reply_${targetUserId}`)
                .setTitle(`Reply to ${targetUser ? targetUser.username : targetUserId}`.slice(0, 45));

            const replyInput = new TextInputBuilder()
                .setCustomId('quick_reply_text')
                .setLabel('Your Message to User')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Type your response here... It will be sent via Nora in their DMs.')
                .setRequired(true)
                .setMaxLength(1900);

            modal.addComponents(new ActionRowBuilder().addComponents(replyInput));
            return await interaction.showModal(modal);
        }

        // 2. View Last 5 Forwarded Messages
        if (customId.startsWith('dm_last_5_')) {
            const history = this.userMessageHistory.get(targetUserId) || [];
            const last5 = history.slice(-5);

            const historyEmbed = new EmbedBuilder()
                .setTitle(`📜 Forwarded Message History • ${targetUser ? targetUser.username : targetUserId}`)
                .setColor(0x3B82F6)
                .setThumbnail(targetUser ? targetUser.displayAvatarURL({ dynamic: true }) : null);

            if (last5.length === 0) {
                historyEmbed.setDescription('No previous message history recorded for this user in volatile memory.');
            } else {
                const historyLines = last5.map((item, idx) => {
                    const sender = item.isFromUser ? '👤 **User**' : '🛡️ **Vaztinix**';
                    const time = `<t:${Math.floor(item.timestamp / 1000)}:R>`;
                    const snippet = item.content ? (item.content.length > 250 ? item.content.slice(0, 247) + '...' : item.content) : '*[Attachment / Media]*';
                    return `${sender} (${time}):\n> ${snippet}`;
                }).join('\n\n');

                historyEmbed.setDescription(historyLines);
            }

            historyEmbed.setFooter({ text: `Showing last ${last5.length} of ${history.length} stored messages • User ID: ${targetUserId}` })
                .setTimestamp();

            return await interaction.reply({ embeds: [historyEmbed], ephemeral: true });
        }

        // 3. Create Conversation Thread Summary
        if (customId.startsWith('dm_create_convo_')) {
            const history = this.userMessageHistory.get(targetUserId) || [];
            const isHighlighted = this.highlightedUsers.has(targetUserId);

            const convoEmbed = new EmbedBuilder()
                .setTitle(`🧵 Conversation Log & Overview • ${targetUser ? targetUser.tag : targetUserId}`)
                .setColor(isHighlighted ? 0xF59E0B : 0x8B5CF6)
                .setThumbnail(targetUser ? targetUser.displayAvatarURL({ dynamic: true }) : null)
                .addFields(
                    { name: '👤 User', value: `${targetUser ? targetUser.tag : 'Unknown'} (\`${targetUserId}\`)`, inline: true },
                    { name: '⭐ Highlighted', value: isHighlighted ? '🌟 Yes (Priority)' : 'No', inline: true },
                    { name: '📊 Total Messages', value: `**${history.length}** exchanged in this session`, inline: true }
                );

            if (history.length > 0) {
                const firstContact = `<t:${Math.floor(history[0].timestamp / 1000)}:F>`;
                const latestContact = `<t:${Math.floor(history[history.length - 1].timestamp / 1000)}:R>`;
                convoEmbed.addFields(
                    { name: '⏱️ First Contact', value: firstContact, inline: true },
                    { name: '⚡ Latest Activity', value: latestContact, inline: true }
                );

                const recentSnippets = history.slice(-3).map(m => {
                    return `${m.isFromUser ? '👤' : '🛡️'} <t:${Math.floor(m.timestamp / 1000)}:t>: ${m.content.slice(0, 100)}`;
                }).join('\n');

                convoEmbed.addFields({
                    name: '📝 Recent Dialogue',
                    value: `>>> ${recentSnippets}`,
                    inline: false
                });
            } else {
                convoEmbed.setDescription('No messages exchanged in this session yet.');
            }

            convoEmbed.setFooter({ text: 'Nora Support Desk • Embeds v2 Engine' })
                .setTimestamp();

            return await interaction.reply({ embeds: [convoEmbed], ephemeral: true });
        }

        // 4. Highlight / Un-highlight User
        if (customId.startsWith('dm_highlight_')) {
            let nowHighlighted = false;
            if (this.highlightedUsers.has(targetUserId)) {
                this.highlightedUsers.delete(targetUserId);
                nowHighlighted = false;
            } else {
                this.highlightedUsers.add(targetUserId);
                nowHighlighted = true;
            }

            return await interaction.reply({
                content: nowHighlighted 
                    ? `⭐ <@${targetUserId}> has been marked as a **Highlighted / Priority** user! All subsequent messages from them will display a gold highlight badge.`
                    : `Removed priority highlight from <@${targetUserId}>.`,
                ephemeral: true
            });
        }
    }

    /**
     * Handles developer submitting the quick reply modal
     */
    async handleStaffModalReply(interaction, client) {
        if (interaction.user.id !== DEVELOPER_ID) {
            return interaction.reply({ content: '❌ Unauthorized.', ephemeral: true });
        }

        const targetUserId = interaction.customId.replace('dm_modal_reply_', '');
        const replyText = interaction.fields.getTextInputValue('quick_reply_text');

        await interaction.deferReply({ ephemeral: true });

        const fakeMessage = {
            author: interaction.user,
            content: replyText,
            attachments: new Map(),
            reply: async (obj) => interaction.followUp(obj),
            react: async () => {}
        };

        const success = await this.sendReplyToUser(fakeMessage, client, targetUserId, replyText);

        if (success) {
            // Record in message history
            let history = this.userMessageHistory.get(targetUserId);
            if (!history) {
                history = [];
                this.userMessageHistory.set(targetUserId, history);
            }
            history.push({
                content: replyText,
                timestamp: Date.now(),
                isFromUser: false
            });
            if (history.length > 25) history.shift();

            return await interaction.editReply({
                content: `✅ **Quick Reply Delivered to <@${targetUserId}>!**\n>>> ${replyText.length > 200 ? replyText.slice(0, 197) + '...' : replyText}`
            });
        } else {
            return await interaction.editReply({
                content: `❌ Failed to deliver message to <@${targetUserId}>. Their DMs may be closed.`
            });
        }
    }

    async forwardUserDMToDeveloper(message, client, bypassSuspension = false) {
        try {
            const devUser = client.users.cache.get(DEVELOPER_ID) || await client.users.fetch(DEVELOPER_ID).catch(() => null);
            if (!devUser) {
                console.error('[DMRelayManager] Developer user could not be fetched:', DEVELOPER_ID);
                return false;
            }

            // Check if this user has any underage suspension record (active, denied, or lifted)
            let suspension = null;
            try {
                suspension = await UnderageSuspension.findOne({
                    where: { userId: message.author.id },
                    order: [['createdAt', 'DESC']]
                });
            } catch (err) {
                console.error('[DMRelayManager] Error checking UnderageSuspension:', err.message);
            }

            const appealKeywords = /\b(appeal|unban|unmute|suspension|suspended|suspend|proof|dob|birthday|birthdate|age|underage|13|id|passport|license|reinstate|re-appeal)\b/i;
            const hasAppealIntent = appealKeywords.test(message.content || '');
            const hasAttachments = message.attachments && message.attachments.size > 0;
            const isAppeal = Boolean(suspension) || hasAppealIntent;
            const createdUnix = Math.floor(message.author.createdTimestamp / 1000);

            // Buffer attachments safely into memory so Discord can embed them cleanly
            const processedFiles = [];
            let firstImageName = null;
            const rawUrls = [];

            if (hasAttachments) {
                let count = 1;
                for (const att of message.attachments.values()) {
                    rawUrls.push(att.url);
                    const processed = await bufferAttachment(att, `user_proof_${count}`);
                    if (processed) {
                        processedFiles.push(processed.builder);
                        if (processed.isImage && !firstImageName) {
                            firstImageName = processed.name;
                        }
                        count++;
                    }
                }
            }

            const relayEmbed = new EmbedBuilder()
                .setTitle(isAppeal ? '⚖️ Underage Suspension Appeal / Proof Received' : '📩 Support DM / Inquiry Received')
                .setColor(isAppeal ? 0xE67E22 : (isHighlighted ? 0xF59E0B : 0x5865F2))
                .setThumbnail(message.author.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: '👤 User', value: `${message.author.tag} (\`${message.author.username}\`)`, inline: true },
                    { name: '🆔 User ID', value: `\`${message.author.id}\` (<@${message.author.id}>)`, inline: true },
                    { name: '📅 Account Created', value: `<t:${createdUnix}:R>`, inline: true }
                );

            if (suspension) {
                let statusLabel = 'Active (Suspended)';
                if (suspension.status === 'denied') statusLabel = '⚠️ Previously Denied (Sending New Proof)';
                else if (suspension.status === 'lifted') statusLabel = '🟢 Previously Lifted';

                const kickedTime = suspension.kickedAt ? `<t:${Math.floor(new Date(suspension.kickedAt).getTime() / 1000)}:R>` : '*Recorded*';
                const rejoinUnix = suspension.rejoinEligibleAt ? Math.floor(new Date(suspension.rejoinEligibleAt).getTime() / 1000) : null;
                const rejoinTime = rejoinUnix ? `<t:${rejoinUnix}:F> (<t:${rejoinUnix}:R>)` : '*3 Years Default*';

                relayEmbed.addFields(
                    { name: '🛑 Suspension Record', value: statusLabel, inline: true },
                    { name: '📅 Suspended Since', value: kickedTime, inline: true },
                    { name: '⏳ Rejoin Date', value: rejoinTime, inline: true }
                );
            }

            const messageText = message.content && message.content.trim().length > 0 
                ? (message.content.length > 1000 ? message.content.slice(0, 1000) + '...' : message.content)
                : (processedFiles.length > 0 ? '*[Proof Attachment / Image only - preview below]*' : '*[No text content]*');

            relayEmbed.addFields({
                name: isAppeal ? '📝 Appeal / Proof Content' : '💬 Message Content',
                value: `>>> ${messageText}`,
                inline: false
            });

            if (firstImageName) {
                relayEmbed.setImage(`attachment://${firstImageName}`);
            }

            relayEmbed.setFooter({
                text: `User ID: ${message.author.id} • Reply to this message with text or images to respond`
            }).setTimestamp();

            let contentNotice = `📩 **New ${isAppeal ? 'Appeal / Proof' : 'DM'} from ${message.author.tag} (<@${message.author.id}>)**\n*💡 Reply to this message to send your response back to them!*`;
            if (rawUrls.length > 0) {
                contentNotice += `\n**📎 Attachments (${rawUrls.length}):**\n` + rawUrls.slice(0, 5).join('\n');
            }

            const components = [];
            if (isAppeal) {
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`appeal_lift_${message.author.id}`)
                        .setLabel('Approve & Lift')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🟢'),
                    new ButtonBuilder()
                        .setCustomId(`appeal_deny_${message.author.id}`)
                        .setLabel('Deny Appeal')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🛑')
                ));
            } else {
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`dm_quick_reply_${message.author.id}`)
                        .setLabel('Quick Reply')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('💬'),
                    new ButtonBuilder()
                        .setCustomId(`dm_last_5_${message.author.id}`)
                        .setLabel('Last 5 Msgs')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📜'),
                    new ButtonBuilder()
                        .setCustomId(`dm_create_convo_${message.author.id}`)
                        .setLabel('Conversation')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🧵'),
                    new ButtonBuilder()
                        .setCustomId(`dm_highlight_${message.author.id}`)
                        .setLabel(isHighlighted ? 'Un-Highlight' : 'Highlight')
                        .setStyle(isHighlighted ? ButtonStyle.Danger : ButtonStyle.Secondary)
                        .setEmoji('⭐')
                ));
            }

            // Send to Developer
            let forwardedMsg = null;
            let dmDeliverySuccess = false;
            try {
                forwardedMsg = await devUser.send({
                    content: contentNotice,
                    embeds: [relayEmbed],
                    files: processedFiles,
                    components
                });
                dmDeliverySuccess = true;
            } catch (sendErr) {
                console.warn('[DMRelayManager] Send with attachments failed, retrying without files:', sendErr.message);
                try {
                    relayEmbed.setImage(null);
                    forwardedMsg = await devUser.send({
                        content: contentNotice,
                        embeds: [relayEmbed],
                        components
                    });
                    dmDeliverySuccess = true;
                } catch (retryErr) {
                    console.error('[DMRelayManager] Direct message to developer failed (DMs may be restricted):', retryErr.message);
                }
            }

            if (forwardedMsg) {
                this.relayCache.set(forwardedMsg.id, message.author.id);
            }

            if (isAppeal) {
            // Dual Dispatch: Mirror to the dedicated staff audit log channel so the appeal is visible in Milo's World
            try {
                const targetGuildId = (suspension && suspension.guildId) ? suspension.guildId : '1487342521133830174';
                const logChannelId = '1510677727206969625';
                const logChannel = client.channels.cache.get(logChannelId) || await client.channels.fetch(logChannelId).catch(() => null);
                if (logChannel && logChannel.isTextBased()) {
                    const auditNotice = dmDeliverySuccess 
                        ? `📩 **[DM Appeal Relay]** From <@${message.author.id}> (\`${message.author.id}\`):`
                        : `⚠️ <@${DEVELOPER_ID}> **[DM Appeal Alert — Direct DM Delivery Unavailable]** From <@${message.author.id}> (\`${message.author.id}\`):`;
                    const auditMsg = await logChannel.send({
                        content: auditNotice,
                        embeds: [relayEmbed],
                        files: processedFiles.length > 0 ? processedFiles : undefined,
                        components: isAppeal ? components : []
                    }).catch(() => null);
                    if (auditMsg) {
                        this.relayCache.set(auditMsg.id, message.author.id);
                    }
                }
            } catch (auditErr) {
                console.error('[DMRelayManager] Failed to mirror to audit log channel:', auditErr.message);
            }
            }

            // Acknowledge receipt to the user
            const ackEmbed = new EmbedBuilder()
                .setTitle(isAppeal ? '⚖️ Appeal Message & Proof Forwarded' : '📨 Message Delivered')
                .setColor(0x2ECC71)
                .setDescription(
                    isAppeal
                        ? `Your message and **${processedFiles.length > 0 ? `${processedFiles.length} proof attachment(s)` : 'details'}** have been forwarded directly to server administrator **Vaztinix** (<@${DEVELOPER_ID}>) for review.\n\n` +
                          `📸 **Need to send more images or documents?**\n` +
                          `You can upload and send more photos, documents, or screenshots directly here in this DM chat anytime.\n\n` +
                          `When staff responds, Nora will deliver their message directly to you here.`
                        : `Your message has been delivered directly to server administrator **Vaztinix** (<@${DEVELOPER_ID}>).\n\nWhen they reply, Nora will deliver their response back to you here.`
                )
                .setFooter({ text: 'You can reply to this DM anytime to send additional details, links, or image attachments.' })
                .setTimestamp();

            const ackComponents = [];
            if (isAppeal) {
                ackComponents.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('appeal_suspension_btn')
                        .setLabel('Submit Formal Appeal Form')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('⚖️')
                ));
            }

            await message.reply({ embeds: [ackEmbed], components: ackComponents }).catch(() => {});
            return true;
        } catch (err) {
            console.error('[DMRelayManager] Error forwarding DM to developer:', err);
            return false;
        }
    }

    /**
     * Sends the developer's reply directly to the target user's DMs with image preview support
     */
    async sendReplyToUser(message, client, targetUserId, overrideContent = null) {
        try {
            const targetUser = await client.users.fetch(targetUserId).catch(() => null);
            if (!targetUser) {
                await message.reply({
                    content: `❌ Could not find user with ID \`${targetUserId}\`.`,
                    allowedMentions: { repliedUser: false }
                }).catch(() => {});
                return true;
            }

            // Buffer developer's attachments safely
            const devFiles = [];
            let devPreviewName = null;
            const devUrls = [];

            if (message.attachments && message.attachments.size > 0) {
                let count = 1;
                for (const att of message.attachments.values()) {
                    devUrls.push(att.url);
                    const processed = await bufferAttachment(att, `staff_file_${count}`);
                    if (processed) {
                        devFiles.push(processed.builder);
                        if (processed.isImage && !devPreviewName) {
                            devPreviewName = processed.name;
                        }
                        count++;
                    }
                }
            }

            const responseText = overrideContent !== null ? overrideContent : message.content;
            if ((!responseText || responseText.trim().length === 0) && devFiles.length === 0) {
                await message.reply({
                    content: `⚠️ Please provide a message or attachment to send!`,
                    allowedMentions: { repliedUser: false }
                }).catch(() => {});
                return true;
            }

            const replyEmbed = new EmbedBuilder()
                .setTitle('💬 Support Response from Server Administrator')
                .setColor(0x5865F2)
                .setAuthor({
                    name: 'Vaztinix (Server Administrator)',
                    iconURL: message.author.displayAvatarURL({ dynamic: true })
                })
                .setDescription(responseText && responseText.trim().length > 0 ? `>>> ${responseText}` : '*[Server Administrator attached image/document above]*')
                .setFooter({ text: 'Reply to this DM anytime to continue your support conversation or submit proof.' })
                .setTimestamp();

            if (devPreviewName) {
                replyEmbed.setImage(`attachment://${devPreviewName}`);
            }

            // Attempt delivery to user
            let delivered = false;
            try {
                await targetUser.send({
                    embeds: [replyEmbed],
                    files: devFiles
                });
                delivered = true;
            } catch (dmErr) {
                // If delivery with files failed, try falling back to embed with link
                if (devFiles.length > 0) {
                    try {
                        replyEmbed.setImage(null);
                        replyEmbed.addFields({ name: '📎 Attachments', value: devUrls.join('\n') });
                        await targetUser.send({ embeds: [replyEmbed] });
                        delivered = true;
                    } catch (fallbackErr) {
                        await message.reply({
                            content: `⚠️ **Delivery Failed**: Could not deliver message to <@${targetUserId}> (${targetUser.tag}). Their DMs may be closed or they have blocked the bot.\n*Error:* \`${dmErr.message || fallbackErr.message || 'DMs closed'}\``,
                            allowedMentions: { repliedUser: false }
                        }).catch(() => {});
                        return true;
                    }
                } else {
                    await message.reply({
                        content: `⚠️ **Delivery Failed**: Could not deliver message to <@${targetUserId}> (${targetUser.tag}). Their DMs may be closed or they have blocked the bot.\n*Error:* \`${dmErr.message || 'DMs closed'}\``,
                        allowedMentions: { repliedUser: false }
                    }).catch(() => {});
                    return true;
                }
            }

            if (delivered) {
                // React with checkmark on developer's message
                await message.react('✅').catch(() => {});

                // Send confirmation receipt to developer
                const fileInfo = devFiles.length > 0 ? ` with ${devFiles.length} attachment(s)` : '';
                await message.reply({
                    content: `📨 **Delivered to ${targetUser.tag}** (\`${targetUserId}\`)${fileInfo}!`,
                    allowedMentions: { repliedUser: false }
                }).catch(() => {});
            }

            return true;
        } catch (err) {
            console.error('[DMRelayManager] Error sending reply to user:', err);
            await message.reply({
                content: `❌ An unexpected error occurred while relaying your reply: \`${err.message}\``,
                allowedMentions: { repliedUser: false }
            }).catch(() => {});
            return true;
        }
    }

    /**
     * Forwards a structured modal appeal from user to developer
     */
    async forwardModalAppealToDeveloper(interaction, client, { explanation, proof, links }) {
        try {
            const devUser = client.users.cache.get(DEVELOPER_ID) || await client.users.fetch(DEVELOPER_ID).catch(() => null);
            if (!devUser) {
                return interaction.reply({ content: '⚠️ Could not connect with administrator at this time. Please try again shortly.', ephemeral: true });
            }

            let suspension = null;
            try {
                suspension = await UnderageSuspension.findOne({
                    where: { userId: interaction.user.id },
                    order: [['createdAt', 'DESC']]
                });
            } catch (err) {
                console.error('[DMRelayManager] Error checking UnderageSuspension:', err.message);
            }

            const createdUnix = Math.floor(interaction.user.createdTimestamp / 1000);
            const relayEmbed = new EmbedBuilder()
                .setTitle('⚖️ Suspension Appeal Form Submitted')
                .setColor(0xE67E22)
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: '👤 User', value: `${interaction.user.tag} (\`${interaction.user.username}\`)`, inline: true },
                    { name: '🆔 User ID', value: `\`${interaction.user.id}\` (<@${interaction.user.id}>)`, inline: true },
                    { name: '📅 Account Created', value: `<t:${createdUnix}:R>`, inline: true }
                );

            if (suspension) {
                const kickedTime = suspension.kickedAt ? `<t:${Math.floor(new Date(suspension.kickedAt).getTime() / 1000)}:R>` : '*Recorded*';
                const rejoinUnix = suspension.rejoinEligibleAt ? Math.floor(new Date(suspension.rejoinEligibleAt).getTime() / 1000) : null;
                const rejoinTime = rejoinUnix ? `<t:${rejoinUnix}:F> (<t:${rejoinUnix}:R>)` : '*3 Years Default*';

                relayEmbed.addFields(
                    { name: '🛑 Suspension Status', value: suspension.status === 'suspended' ? 'Active (3 Years Default)' : suspension.status, inline: true },
                    { name: '📅 Suspended Since', value: kickedTime, inline: true },
                    { name: '⏳ Rejoin Date', value: rejoinTime, inline: true }
                );
            }

            const linksContent = (links && links.trim().length > 0) ? links.trim() : '*None provided*';
            relayEmbed.addFields(
                { name: '📝 Appeal Explanation', value: `>>> ${(explanation || '*No reason given*').slice(0, 1020)}`, inline: false },
                { name: '📋 Proof / DOB Information', value: `>>> ${(proof || 'None provided').slice(0, 1020)}`, inline: false },
                { name: '🔗 Proof Images & Links', value: `>>> ${linksContent.slice(0, 1020)}`, inline: false }
            );

            // If a direct image link was supplied, attempt to preview it on the embed
            const urlMatches = (links || '').match(/https?:\/\/[^\s]+/gi) || [];
            const directImage = urlMatches.find(u => /\.(png|jpe?g|webp|gif)($|\?)/i.test(u));
            const modalFiles = [];
            if (directImage) {
                try {
                    const res = await fetch(directImage);
                    if (res.ok) {
                        const buf = Buffer.from(await res.arrayBuffer());
                        const extMatch = directImage.match(/\.(png|jpe?g|webp|gif)($|\?)/i);
                        const ext = extMatch ? extMatch[1].toLowerCase() : 'png';
                        const fileName = `appeal_evidence.${ext}`;
                        modalFiles.push(new AttachmentBuilder(buf, { name: fileName }));
                        relayEmbed.setImage(`attachment://${fileName}`);
                    } else {
                        relayEmbed.setImage(directImage);
                    }
                } catch (e) {
                    relayEmbed.setImage(directImage);
                }
            }

            relayEmbed.setFooter({
                text: `User ID: ${interaction.user.id} • Reply to this message with text or images to respond`
            }).setTimestamp();

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`appeal_lift_${interaction.user.id}`)
                    .setLabel('Approve & Lift')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🟢'),
                new ButtonBuilder()
                    .setCustomId(`appeal_deny_${interaction.user.id}`)
                    .setLabel('Deny Appeal')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🛑')
            );

            let contentNotice = `📩 **New Suspension Appeal from ${interaction.user.tag} (<@${interaction.user.id}>)**\n*💡 Click Approve & Lift below, or reply to this message with text or images to respond!*`;
            if (urlMatches.length > 0) {
                contentNotice += `\n**🔗 Provided Links:**\n` + urlMatches.slice(0, 5).join('\n');
            }

            let forwardedMsg = null;
            let dmDeliverySuccess = false;
            try {
                forwardedMsg = await devUser.send({
                    content: contentNotice,
                    embeds: [relayEmbed],
                    files: modalFiles,
                    components: [actionRow]
                });
                dmDeliverySuccess = true;
            } catch (sendErr) {
                relayEmbed.setImage(null);
                try {
                    forwardedMsg = await devUser.send({
                        content: contentNotice,
                        embeds: [relayEmbed],
                        components: [actionRow]
                    });
                    dmDeliverySuccess = true;
                } catch (retryErr) {
                    console.error('[DMRelayManager] Direct message to developer failed for modal appeal:', retryErr.message);
                }
            }

            if (forwardedMsg) {
                this.relayCache.set(forwardedMsg.id, interaction.user.id);
            }

            // Dual Dispatch: Mirror to the dedicated staff audit log channel so the appeal is visible in Milo's World
            try {
                const targetGuildId = (suspension && suspension.guildId) ? suspension.guildId : '1487342521133830174';
                const logChannelId = '1510677727206969625';
                const logChannel = client.channels.cache.get(logChannelId) || await client.channels.fetch(logChannelId).catch(() => null);
                if (logChannel && logChannel.isTextBased()) {
                    const auditNotice = dmDeliverySuccess 
                        ? `📩 **[DM Appeal Relay Form]** From <@${interaction.user.id}> (\`${interaction.user.id}\`):`
                        : `⚠️ <@${DEVELOPER_ID}> **[DM Appeal Alert — Direct DM Delivery Unavailable]** From <@${interaction.user.id}> (\`${interaction.user.id}\`):`;
                    const auditMsg = await logChannel.send({
                        content: auditNotice,
                        embeds: [relayEmbed],
                        files: modalFiles.length > 0 ? modalFiles : undefined,
                        components: [actionRow]
                    }).catch(() => null);
                    if (auditMsg) {
                        this.relayCache.set(auditMsg.id, interaction.user.id);
                    }
                }
            } catch (auditErr) {
                console.error('[DMRelayManager] Failed to mirror modal appeal to audit log channel:', auditErr.message);
            }

            const ackEmbed = new EmbedBuilder()
                .setTitle('⚖️ Appeal Forwarded Successfully')
                .setColor(0x2ECC71)
                .setDescription(
                    `Your appeal has been delivered directly to server administrator **Vaztinix** (<@${DEVELOPER_ID}>) for review.\n\n` +
                    `📸 **Have proof photos, screenshots, or documents?**\n` +
                    `You can upload and send image attachments **directly in this DM chat right now**! Nora will forward them automatically to staff to help verify your appeal faster.\n\n` +
                    `When staff responds, Nora will deliver their decision or reply directly to your DMs here.`
                )
                .setFooter({ text: 'You can send messages and image attachments directly in this DM anytime.' })
                .setTimestamp();

            await interaction.reply({ embeds: [ackEmbed] });
        } catch (err) {
            console.error('[DMRelayManager] Error submitting modal appeal:', err);
            await interaction.reply({ content: '❌ Failed to forward appeal. Please send a direct text message here instead.', ephemeral: true }).catch(() => {});
        }
    }

    /**
     * Handles developer clicking "Approve & Lift" on a forwarded appeal
     */
    async handleDeveloperLiftAppeal(interaction, client, targetUserId) {
        await interaction.deferUpdate();
        try {
            const TARGET_GUILD_ID = '1487342521133830174';
            const LOG_CHANNEL_ID = '1510677727206969625';

            let record = await UnderageSuspension.findOne({
                where: { userId: targetUserId },
                order: [['createdAt', 'DESC']]
            });

            const targetUser = await client.users.fetch(targetUserId).catch(() => null);

            // Fetch guild and generate invite
            const guild = client.guilds.cache.get(TARGET_GUILD_ID) || await client.guilds.fetch(TARGET_GUILD_ID).catch(() => null);
            let inviteObj = null;
            if (guild) {
                const inviteChannel = guild.rulesChannel || guild.systemChannel || 
                    guild.channels.cache.find(c => c && c.type === 0 && c.permissionsFor(guild.members.me)?.has('CreateInstantInvite'));
                if (inviteChannel) {
                    inviteObj = await inviteChannel.createInvite({
                        maxAge: 7 * 86400, // 7 days
                        maxUses: 1,
                        unique: true,
                        reason: `Suspension lifted via DM appeal by ${interaction.user.tag}`
                    }).catch(() => null);
                }
            }

            // Update database record
            if (record) {
                await record.update({
                    status: 'lifted',
                    liftedBy: interaction.user.id,
                    liftedAt: new Date(),
                    staffNote: `[Approved by ${interaction.user.tag} via DM Appeal]: Suspension lifted.`,
                    inviteSent: Boolean(inviteObj),
                    inviteUrl: inviteObj ? inviteObj.url : null
                });
            }

            // DM target user
            let userNotified = false;
            if (targetUser) {
                const userEmbed = new EmbedBuilder()
                    .setTitle('🎉 Suspension Appeal Approved!')
                    .setColor(0x2ECC71)
                    .setDescription(
                        `Hello <@${targetUserId}>,\n\n` +
                        `Your appeal has been **reviewed and approved** by server administrator **Vaztinix**!\n` +
                        `Your age suspension has been officially **lifted** from **${guild ? guild.name : 'the server'}**.\n\n` +
                        (inviteObj ? `You may rejoin using the invite link below:\n🔗 **${inviteObj.url}**` : `You are now welcome to rejoin the server!`)
                    )
                    .setTimestamp();

                const dmComponents = [];
                if (inviteObj) {
                    dmComponents.push(new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Rejoin Server')
                            .setStyle(ButtonStyle.Link)
                            .setURL(inviteObj.url)
                    ));
                }

                await targetUser.send({ embeds: [userEmbed], components: dmComponents }).then(() => { userNotified = true; }).catch(() => {});
            }

            // Log to Audit Channel
            if (guild) {
                try {
                    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID) || await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                    if (logChannel && logChannel.isTextBased()) {
                        const auditEmbed = new EmbedBuilder()
                            .setTitle('🟢 Age Suspension Lifted (DM Appeal Approved)')
                            .setColor(0x2ECC71)
                            .setThumbnail(targetUser ? targetUser.displayAvatarURL({ dynamic: true }) : null)
                            .setDescription(`Administrator <@${interaction.user.id}> approved the appeal for <@${targetUserId}> in DMs.`)
                            .addFields(
                                { name: '👤 Target User', value: `<@${targetUserId}> (\`${targetUserId}\`)`, inline: true },
                                { name: '🛡️ Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
                                { name: '📨 Server Invite', value: inviteObj ? `[Invite Link](${inviteObj.url})` : '*None generated*', inline: true },
                                { name: '📬 User DM Notice', value: userNotified ? '✅ Delivered to user' : '⚠️ DM failed (DMs closed)', inline: false }
                            )
                            .setFooter({ text: 'Age Suspension DM Appeal System' })
                            .setTimestamp();
                        await logChannel.send({ embeds: [auditEmbed] });
                    }
                } catch (e) {}
            }

            // Update developer's message
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('done_lift').setLabel('Appeal Approved & Lifted').setStyle(ButtonStyle.Success).setDisabled(true)
            );

            await interaction.editReply({
                content: `✅ **Appeal Approved & Suspension Lifted!**\nTarget: <@${targetUserId}> (\`${targetUserId}\`)\nInvite: ${inviteObj ? inviteObj.url : '*None*'}\nUser DM: ${userNotified ? 'Delivered' : 'Failed'}`,
                components: [disabledRow]
            });
        } catch (err) {
            console.error('[DMRelayManager] Error in handleDeveloperLiftAppeal:', err);
        }
    }

    /**
     * Opens modal for developer to enter a reason when denying an appeal
     */
    async handleDeveloperDenyAppeal(interaction, client, targetUserId) {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const modal = new ModalBuilder()
            .setCustomId(`appeal_deny_modal_${targetUserId}`)
            .setTitle('Deny Suspension Appeal');

        const reasonInput = new TextInputBuilder()
            .setCustomId('deny_reason')
            .setLabel('Reason for Denying Appeal (Sent to user)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Explain why the appeal cannot be approved at this time...')
            .setRequired(true)
            .setMaxLength(500);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
    }

    /**
     * Confirms developer denial after modal submission
     */
    async confirmDeveloperDenyAppeal(interaction, client, targetUserId, reason) {
        await interaction.deferUpdate();
        try {
            const targetUser = await client.users.fetch(targetUserId).catch(() => null);
            let userNotified = false;

            // Update database record if exists
            let record = await UnderageSuspension.findOne({
                where: { userId: targetUserId },
                order: [['createdAt', 'DESC']]
            });
            if (record) {
                await record.update({
                    status: 'denied',
                    staffNote: `[Denied by ${interaction.user.tag}]: ${reason}`
                });
            }

            if (targetUser) {
                const denyEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Suspension Appeal Decision')
                    .setColor(0xE74C3C)
                    .setDescription(
                        `Hello <@${targetUserId}>,\n\n` +
                        `Your suspension appeal has been reviewed by server administrator **Vaztinix**.\n\n` +
                        `At this time, your suspension cannot be lifted.\n\n` +
                        `**Reason:**\n> ${reason}\n\n` +
                        `📸 **Have additional verification or new proof to submit?**\n` +
                        `If you have valid ID, proof of age, or clarifying documents, you can click **Submit Appeal / Proof** below or simply upload and send your proof images directly in this DM anytime.`
                    )
                    .setFooter({ text: 'Discord Safety & Account Policy Enforcement • Nora DM Appeal Relay' })
                    .setTimestamp();

                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('appeal_suspension_btn')
                        .setLabel('Submit Appeal / Proof')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('⚖️')
                );

                await targetUser.send({ embeds: [denyEmbed], components: [actionRow] }).then(() => { userNotified = true; }).catch(() => {});
            }

            const TARGET_GUILD_ID = '1487342521133830174';
            const LOG_CHANNEL_ID = '1510677727206969625';
            const guild = client.guilds.cache.get(TARGET_GUILD_ID) || await client.guilds.fetch(TARGET_GUILD_ID).catch(() => null);
            if (guild) {
                try {
                    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID) || await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                    if (logChannel && logChannel.isTextBased()) {
                        const auditEmbed = new EmbedBuilder()
                            .setTitle('🛑 Age Suspension Appeal Denied')
                            .setColor(0xE74C3C)
                            .setThumbnail(targetUser ? targetUser.displayAvatarURL({ dynamic: true }) : null)
                            .setDescription(`Administrator <@${interaction.user.id}> denied the appeal for <@${targetUserId}> in DMs.`)
                            .addFields(
                                { name: '👤 Target User', value: `<@${targetUserId}> (\`${targetUserId}\`)`, inline: true },
                                { name: '🛡️ Reviewed By', value: `<@${interaction.user.id}>`, inline: true },
                                { name: '📝 Reason Given', value: `>>> ${reason}`, inline: false },
                                { name: '📬 User DM Notice', value: userNotified ? '✅ Delivered to user' : '⚠️ DM failed (DMs closed)', inline: false }
                            )
                            .setFooter({ text: 'Age Suspension DM Appeal System' })
                            .setTimestamp();
                        await logChannel.send({ embeds: [auditEmbed] });
                    }
                } catch (e) {}
            }

            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('done_deny').setLabel('Appeal Denied').setStyle(ButtonStyle.Danger).setDisabled(true)
            );

            await interaction.editReply({
                content: `🛑 **Appeal Denied**\nTarget: <@${targetUserId}> (\`${targetUserId}\`)\nReason: ${reason}\nUser DM: ${userNotified ? 'Delivered' : 'Failed'}`,
                components: [disabledRow]
            });
        } catch (err) {
            console.error('[DMRelayManager] Error in confirmDeveloperDenyAppeal:', err);
        }
    }
}

module.exports = new DMRelayManager();
