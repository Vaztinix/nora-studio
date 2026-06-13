const { Events } = require('discord.js');
const ReactionRole = require('../database/models/ReactionRole');

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
                if (member && member.roles.cache.has(match.roleId)) {
                    const role = guild.roles.cache.get(match.roleId);
                    if (role) {
                        const botHighest = guild.members.me.roles.highest.position;
                        if (role.position < botHighest) {
                            await member.roles.remove(role).catch(err => {
                                console.error(`[Reaction Role] Failed to remove role ${role.name} from ${member.user.tag}:`, err.message);
                            });

                            const GuildSettings = require('../database/models/GuildSettings');
                            const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
                            if (!settings || settings.reactionRoleNotifyDm !== false) {
                                const { EmbedBuilder } = require('discord.js');
                                const dmEmbed = new EmbedBuilder()
                                    .setTitle('Role Removed')
                                    .setDescription(`The **${role.name}** role has been removed from you in **${guild.name}**!`)
                                    .setColor(role.color || 0x4F46E5);
                                await user.send({ embeds: [dmEmbed] }).catch(() => {});
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[Reaction Remove Error] Fault:', error);
        }
    }
};
