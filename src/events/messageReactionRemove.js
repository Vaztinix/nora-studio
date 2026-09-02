const { Events } = require('discord.js');

module.exports = {
    name: Events.MessageReactionRemove,
    async execute(reaction, user) {
        if (user.bot) return;

        // Handle partial reaction / message
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('[Reaction Remove] Failed to fetch partial reaction:', error);
                return;
            }
        }

        const guild = reaction.message.guild;
        if (!guild) return;

        // ---- Starboard Integration ----
        try {
            const GuildSettings = require('../database/models/GuildSettings');
            const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
            
            if (settings && settings.starboardEnabled && settings.starboardChannelId) {
                const triggerEmoji = settings.starboardEmoji || '⭐';
                const emojiName = reaction.emoji.id ? null : reaction.emoji.name;
                const emojiId = reaction.emoji.id;
                
                const isMatch = (emojiId && triggerEmoji.includes(emojiId)) || 
                                (emojiName && triggerEmoji === emojiName);

                if (isMatch) {
                    const starboardChannel = guild.channels.cache.get(settings.starboardChannelId) || 
                                             await guild.channels.fetch(settings.starboardChannelId).catch(() => null);
                    if (starboardChannel) {
                        // Fetch last 100 messages in starboard channel
                        const messages = await starboardChannel.messages.fetch({ limit: 100 }).catch(() => null);
                        const existingMsg = messages ? messages.find(m => 
                            m.embeds.length > 0 && 
                            m.embeds[0].footer && 
                            m.embeds[0].footer.text === `Message ID: ${reaction.message.id}`
                        ) : null;

                        if (existingMsg) {
                            const threshold = settings.starboardThreshold || 3;
                            if (reaction.count < threshold) {
                                // Delete if below threshold
                                await existingMsg.delete().catch(() => {});
                            } else {
                                // Otherwise update count
                                let starText = settings.starboardMessageTemplate || '{emoji} **{count}** | {channel}';
                                starText = starText
                                    .replace(/{emoji}/g, triggerEmoji)
                                    .replace(/{count}/g, reaction.count)
                                    .replace(/{channel}/g, `<#${reaction.message.channel.id}>`);

                                if (existingMsg.webhookId) {
                                    const webhooks = await starboardChannel.fetchWebhooks().catch(() => null);
                                    const webhook = webhooks ? webhooks.find(wh => wh.name.toLowerCase().includes('nora')) : null;
                                    if (webhook) {
                                        await webhook.editMessage(existingMsg.id, {
                                            content: starText,
                                            username: settings.starboardWebhookName || 'Nora Starboard',
                                            avatarURL: settings.starboardWebhookAvatar || null
                                        }).catch(() => {});
                                    } else {
                                        await existingMsg.edit({ content: starText }).catch(() => {});
                                    }
                                } else {
                                    await existingMsg.edit({ content: starText }).catch(() => {});
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[Starboard Error] messageReactionRemove failed:', e.message);
        }

        // ---- Reaction Role Removal Integration ----
        const ReactionRole = require('../database/models/ReactionRole');
        const { matchesEmoji, checkAndConsumeSuppression, enqueueRoleAction } = require('../utils/reactionRoleHelper');

        const emojiKey = reaction.emoji.id ? reaction.emoji.id : reaction.emoji.name;
        const rawEmojiStr = reaction.emoji.toString();

        // Check if this reaction removal was initiated by Nora (e.g. Single-Select mode)
        if (checkAndConsumeSuppression(reaction.message.id, user.id, emojiKey) || 
            checkAndConsumeSuppression(reaction.message.id, user.id, rawEmojiStr)) {
            return;
        }

        try {
            const allMessageMappings = await ReactionRole.findAll({
                where: {
                    guildId: guild.id,
                    messageId: reaction.message.id
                }
            });

            if (!allMessageMappings || allMessageMappings.length === 0) return;

            const match = allMessageMappings.find(m => matchesEmoji(reaction.emoji, m.emoji));
            if (!match) return;

            await enqueueRoleAction(guild.id, user.id, async () => {
                const member = await guild.members.fetch(user.id).catch(() => null);
                if (!member) return;

                // Check if user still has the role
                if (!member.roles.cache.has(match.roleId)) return;

                // Check if the user has another active reaction on this message that grants the same role
                try {
                    const targetMsg = await reaction.message.fetch(true).catch(() => reaction.message);
                    const freshReactions = targetMsg.reactions ? targetMsg.reactions.cache : new Map();

                    let hasOtherGrantingReaction = false;
                    for (const [rId, msgReaction] of freshReactions) {
                        const isThisRemovedEmoji = matchesEmoji(msgReaction.emoji, match.emoji) || matchesEmoji(msgReaction.emoji, reaction.emoji);
                        if (!isThisRemovedEmoji) {
                            const otherMapping = allMessageMappings.find(m => m.roleId === match.roleId && matchesEmoji(msgReaction.emoji, m.emoji));
                            if (otherMapping) {
                                const usersReacted = await msgReaction.users.fetch().catch(() => msgReaction.users.cache);
                                if (usersReacted && usersReacted.has(user.id)) {
                                    hasOtherGrantingReaction = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (hasOtherGrantingReaction) {
                        return; // Keep role because member still has another qualifying reaction
                    }
                } catch (e) {
                    console.error('[Reaction Remove Check Error]:', e.message);
                }

                const role = guild.roles.cache.get(match.roleId) || await guild.roles.fetch(match.roleId).catch(() => null);
                if (role) {
                    const botHighest = guild.members.me.roles.highest.position;
                    if (role.position < botHighest) {
                        await member.roles.remove(role).catch(err => {
                            console.error(`[Reaction Role Remove] Failed to remove role ${role.name} from ${member.user.tag}:`, err.message);
                        });

                        const GuildSettings = require('../database/models/GuildSettings');
                        const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
                        if (!settings || settings.reactionRoleNotifyDm !== false) {
                            const { EmbedBuilder } = require('discord.js');
                            const dmEmbed = new EmbedBuilder()
                                .setTitle('Role Removed')
                                .setDescription(`The **${role.name}** role was removed from you in **${guild.name}** because you unreacted.`)
                                .setColor(0xEF4444);
                            await user.send({ embeds: [dmEmbed] }).catch(() => {});
                        }
                    }
                }
            });
        } catch (error) {
            console.error('[Reaction Remove Error] Fault:', error);
        }
    }
};
