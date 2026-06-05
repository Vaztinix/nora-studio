const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const { formatMessage } = require('../utils/messageFormatter');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        try {
            // Check if member just boosted the server
            const oldBoost = oldMember.premiumSince;
            const newBoost = newMember.premiumSince;

            if (!oldBoost && newBoost) {
                // User just boosted!
                const settings = await GuildSettings.findOne({ where: { guildId: newMember.guild.id } });
                if (!settings) return;

                // 1. Send Boost Announcement
                if (settings.boostChannelId) {
                    let boostChannel = newMember.guild.channels.cache.get(settings.boostChannelId);
                    if (!boostChannel) boostChannel = await newMember.guild.channels.fetch(settings.boostChannelId).catch(() => null);

                    if (boostChannel) {
                        const template = settings.logBoostMessage;
                        let customDesc = `Thank you <@${newMember.id}> for boosting **${newMember.guild.name}**! 🚀`;
                        if (template) {
                            customDesc = formatMessage(template, newMember);
                        }

                        const embed = new EmbedBuilder()
                            .setTitle(`Server Boost! 🚀`)
                            .setDescription(customDesc)
                            .setColor(0xff73fa) // Purple/pink theme color for server boosts
                            .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true, size: 256 }))
                            .setFooter({ text: `${newMember.guild.name} is now at ${newMember.guild.premiumSubscriptionCount} boosts!` })
                            .setTimestamp();

                        await boostChannel.send({ embeds: [embed] }).catch(() => {});
                    }
                }

                // 2. Assign Boost Reward Role
                if (settings.boostRewardRoleId) {
                    const role = newMember.guild.roles.cache.get(settings.boostRewardRoleId);
                    if (role && newMember.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                        const myHighest = newMember.guild.members.me.roles.highest.position;
                        if (role.position < myHighest) {
                            await newMember.roles.add(role).catch(() => {});
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[Logger] Error in MemberUpdate (Boost check):', error);
        }
    }
};
