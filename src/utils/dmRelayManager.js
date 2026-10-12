const { EmbedBuilder } = require('discord.js');
const UnderageSuspension = require('../database/models/UnderageSuspension');

const DEVELOPER_ID = '1214048435632603137';

class DMRelayManager {
    constructor() {
        // In-memory cache of messageId -> targetUserId
        this.relayCache = new Map();
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

            // Check for manual command: !dm <userId> <message> or !reply <userId> <message>
            const cmdMatch = message.content.match(/^!(?:reply|dm|msg|send)\s+(\d{17,20})\s+([\s\S]+)$/i);
            if (cmdMatch) {
                const targetUserId = cmdMatch[1];
                const contentToSend = cmdMatch[2];
                return await this.sendReplyToUser(message, client, targetUserId, contentToSend);
            }

            return false;
        }

        // ========================================================
        // CASE B: Regular user DMing Nora (Appeal or General Support)
        // ========================================================
        return await this.forwardUserDMToDeveloper(message, client);
    }

    /**
     * Forwards a regular user's DM to the developer (Vaztinix)
     */
    async forwardUserDMToDeveloper(message, client) {
        try {
            const devUser = client.users.cache.get(DEVELOPER_ID) || await client.users.fetch(DEVELOPER_ID).catch(() => null);
            if (!devUser) {
                console.error('[DMRelayManager] Developer user could not be fetched:', DEVELOPER_ID);
                return false;
            }

            // Check if this user has an active underage suspension record
            let suspension = null;
            try {
                suspension = await UnderageSuspension.findOne({
                    where: { userId: message.author.id, status: 'suspended' }
                });
            } catch (err) {
                console.error('[DMRelayManager] Error checking UnderageSuspension:', err.message);
            }

            const isAppeal = Boolean(suspension);
            const createdUnix = Math.floor(message.author.createdTimestamp / 1000);

            const relayEmbed = new EmbedBuilder()
                .setTitle(isAppeal ? '⚖️ Underage Suspension Appeal Received' : '📩 Support DM / Inquiry Received')
                .setColor(isAppeal ? 0xE67E22 : 0x3498DB)
                .setThumbnail(message.author.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: '👤 User', value: `${message.author.tag} (\`${message.author.username}\`)`, inline: true },
                    { name: '🆔 User ID', value: `\`${message.author.id}\` (<@${message.author.id}>)`, inline: true },
                    { name: '📅 Account Created', value: `<t:${createdUnix}:R>`, inline: true }
                );

            if (isAppeal) {
                const kickedTime = suspension.kickedAt ? `<t:${Math.floor(new Date(suspension.kickedAt).getTime() / 1000)}:R>` : '*Recorded*';
                const rejoinUnix = suspension.rejoinEligibleAt ? Math.floor(new Date(suspension.rejoinEligibleAt).getTime() / 1000) : null;
                const rejoinTime = rejoinUnix ? `<t:${rejoinUnix}:F> (<t:${rejoinUnix}:R>)` : '*3 Years Default*';

                relayEmbed.addFields(
                    { name: '🛑 Suspension Status', value: 'Active (3 Years Default)', inline: true },
                    { name: '📅 Suspended Since', value: kickedTime, inline: true },
                    { name: '⏳ Rejoin Date', value: rejoinTime, inline: true }
                );
            }

            const messageText = message.content && message.content.trim().length > 0 
                ? (message.content.length > 1000 ? message.content.slice(0, 1000) + '...' : message.content)
                : '*[No text content - Media / attachment only]*';

            relayEmbed.addFields({
                name: isAppeal ? '📝 Appeal Explanation' : '💬 Message Content',
                value: `>>> ${messageText}`,
                inline: false
            });

            relayEmbed.setFooter({
                text: `User ID: ${message.author.id} • Reply to this message to send a response`
            }).setTimestamp();

            let contentNotice = `📩 **New ${isAppeal ? 'Appeal' : 'DM'} from ${message.author.tag} (<@${message.author.id}>)**\n*💡 Reply to this message to send your response back to them!*`;

            const attachmentUrls = message.attachments ? Array.from(message.attachments.values()).map(a => a.url) : [];
            if (attachmentUrls.length > 0) {
                contentNotice += `\n**📎 Attachments:**\n` + attachmentUrls.join('\n');
            }

            // Send to Developer
            const forwardedMsg = await devUser.send({
                content: contentNotice,
                embeds: [relayEmbed]
            });

            // Store in cache
            this.relayCache.set(forwardedMsg.id, message.author.id);

            // Acknowledge receipt to the user
            const ackEmbed = new EmbedBuilder()
                .setTitle(isAppeal ? '⚖️ Appeal Forwarded' : '📨 Message Delivered')
                .setColor(0x2ECC71)
                .setDescription(
                    isAppeal
                        ? `Your appeal and details have been forwarded directly to server administrator **Vaztinix** (<@${DEVELOPER_ID}>) for review.\n\nWhen they respond, Nora will deliver their message directly to you here. Thank you for your patience!`
                        : `Your message has been delivered directly to server administrator **Vaztinix** (<@${DEVELOPER_ID}>).\n\nWhen they reply, Nora will deliver their response back to you here.`
                )
                .setFooter({ text: 'You can reply to this DM anytime to send additional details.' })
                .setTimestamp();

            await message.reply({ embeds: [ackEmbed] }).catch(() => {});
            return true;
        } catch (err) {
            console.error('[DMRelayManager] Error forwarding DM to developer:', err);
            return false;
        }
    }

    /**
     * Sends the developer's reply directly to the target user's DMs
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

            const responseText = overrideContent || message.content;
            if (!responseText && (!message.attachments || message.attachments.size === 0)) {
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
                .setDescription(responseText ? `>>> ${responseText}` : '*[Attachment only]*')
                .setFooter({ text: 'Reply to this DM anytime to continue your support conversation.' })
                .setTimestamp();

            const attachmentFiles = message.attachments ? Array.from(message.attachments.values()).map(a => a.url) : [];

            // Attempt delivery to user
            let delivered = false;
            try {
                await targetUser.send({
                    embeds: [replyEmbed],
                    files: attachmentFiles
                });
                delivered = true;
            } catch (dmErr) {
                await message.reply({
                    content: `⚠️ **Delivery Failed**: Could not deliver message to <@${targetUserId}> (${targetUser.tag}). Their DMs may be closed or they have blocked the bot.\n*Error:* \`${dmErr.message || 'DMs closed'}\``,
                    allowedMentions: { repliedUser: false }
                }).catch(() => {});
                return true;
            }

            if (delivered) {
                // React with checkmark on developer's message
                await message.react('✅').catch(() => {});

                // Send confirmation receipt to developer
                await message.reply({
                    content: `📨 **Delivered to ${targetUser.tag}** (\`${targetUserId}\`)!`,
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
}

module.exports = new DMRelayManager();
