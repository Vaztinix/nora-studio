const { Events } = require('discord.js');
const ReactionRole = require('../database/models/ReactionRole');

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        if (user.bot) return;

        // Handle partial reaction / message
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('[Reaction Add] Failed to fetch partial reaction:', error);
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
                    const threshold = settings.starboardThreshold || 3;
                    if (reaction.count >= threshold) {
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

                            const { EmbedBuilder } = require('discord.js');
                            const embed = new EmbedBuilder()
                                .setAuthor({ 
                                    name: reaction.message.author.tag, 
                                    iconURL: reaction.message.author.displayAvatarURL({ dynamic: true }) 
                                })
                                .setDescription(reaction.message.content || '*No content*')
                                .setColor(0xffac33)
                                .setTimestamp(reaction.message.createdAt)
                                .setFooter({ text: `Message ID: ${reaction.message.id}` });

                            // If message has image attachments
                            const attachment = reaction.message.attachments.first();
                            if (attachment && attachment.contentType && attachment.contentType.startsWith('image/')) {
                                embed.setImage(attachment.url);
                            }

                            embed.addFields({ name: 'Original', value: `[Jump to message](${reaction.message.url})`, inline: true });

                            const starText = `${triggerEmoji} **${reaction.count}** | <#${reaction.message.channel.id}>`;

                            if (existingMsg) {
                                await existingMsg.edit({ content: starText, embeds: [embed] }).catch(() => {});
                            } else {
                                await starboardChannel.send({ content: starText, embeds: [embed] }).catch(() => {});
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[Starboard Error] messageReactionAdd failed:', e.message);
        }

        const emojiKey = reaction.emoji.id ? reaction.emoji.id : reaction.emoji.name;

        try {
            const match = await ReactionRole.findOne({
                where: {
                    guildId: guild.id,
                    messageId: reaction.message.id,
                    emoji: emojiKey
                }
            });

            if (match) {
                const member = await guild.members.fetch(user.id).catch(() => null);
                if (member) {
                    const role = guild.roles.cache.get(match.roleId);
                    if (role) {
                        const botHighest = guild.members.me.roles.highest.position;
                        if (role.position < botHighest) {
                            await member.roles.add(role).catch(err => {
                                console.error(`[Reaction Role] Failed to add role ${role.name} to ${member.user.tag}:`, err.message);
                            });

                            const GuildSettings = require('../database/models/GuildSettings');
                            const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
                            if (!settings || settings.reactionRoleNotifyDm !== false) {
                                const { EmbedBuilder } = require('discord.js');
                                const dmEmbed = new EmbedBuilder()
                                    .setTitle('Role Added')
                                    .setDescription(`You have been given the **${role.name}** role in **${guild.name}**!`)
                                    .setColor(role.color || 0x4F46E5);
                                await user.send({ embeds: [dmEmbed] }).catch(() => {});
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[Reaction Add Error] Fault:', error);
        }
    }
};
