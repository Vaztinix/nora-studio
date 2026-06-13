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
