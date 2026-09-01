const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const { formatMessage } = require('../utils/messageFormatter');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        try {
            const settings = await GuildSettings.findOne({ where: { guildId: newMember.guild.id } });
            if (!settings) return;
            const loggerUtil = require('../utils/logger');

            // 1. Boost Detection
            const oldBoost = oldMember.premiumSince;
            const newBoost = newMember.premiumSince;

            if (!oldBoost && newBoost) {
                // Send Boost Announcement
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
                            .setColor(0xff73fa)
                            .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true, size: 256 }))
                            .setFooter({ text: `${newMember.guild.name} is now at ${newMember.guild.premiumSubscriptionCount} boosts!` })
                            .setTimestamp();

                        await boostChannel.send({ embeds: [embed] }).catch(() => {});
                    }
                }

                // Assign Boost Reward Role
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

            // 2. Nickname Change Logging
            if (oldMember.nickname !== newMember.nickname) {
                const nickEmbed = new EmbedBuilder()
                    .setTitle('👤 Member Nickname Changed')
                    .setAuthor({
                        name: newMember.user.tag,
                        iconURL: newMember.user.displayAvatarURL({ dynamic: true })
                    })
                    .setColor(0x3498DB)
                    .addFields(
                        { name: 'Member', value: `<@${newMember.id}> (\`${newMember.id}\`)`, inline: true },
                        { name: 'Old Nickname', value: oldMember.nickname || '*None (Username used)*', inline: true },
                        { name: 'New Nickname', value: newMember.nickname || '*Reset to Username*', inline: true }
                    )
                    .setTimestamp();
                await loggerUtil.sendEventLog(newMember.guild, 'memberUpdate', nickEmbed, settings);
            }

            // 3. Role Changes Logging
            const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
            const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

            if (addedRoles.size > 0 || removedRoles.size > 0) {
                const roleEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Member Roles Updated')
                    .setAuthor({
                        name: newMember.user.tag,
                        iconURL: newMember.user.displayAvatarURL({ dynamic: true })
                    })
                    .setColor(0x9B59B6)
                    .addFields({ name: 'Member', value: `<@${newMember.id}> (\`${newMember.id}\`)`, inline: false });

                if (addedRoles.size > 0) {
                    roleEmbed.addFields({ name: '➕ Roles Added', value: addedRoles.map(r => `<@&${r.id}>`).join(', '), inline: false });
                }
                if (removedRoles.size > 0) {
                    roleEmbed.addFields({ name: '➖ Roles Removed', value: removedRoles.map(r => `<@&${r.id}>`).join(', '), inline: false });
                }
                roleEmbed.setTimestamp();
                await loggerUtil.sendEventLog(newMember.guild, 'memberUpdate', roleEmbed, settings);

                // Check if the assigned role is the Underage Role (1544420452439556116)
                if (addedRoles.has('1544420452439556116')) {
                    try {
                        const { processUnderageMember } = require('../utils/underageSweep');
                        processUnderageMember(newMember, newMember.client).catch(err => {
                            console.error('[Underage Sweep] Error processing member on role assign:', err);
                        });
                    } catch (err) {
                        console.error('[Underage Sweep] Failed to invoke processUnderageMember:', err);
                    }
                }
            }

            // 4. Timeout Status Logging
            if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
                const isTimedOut = newMember.isCommunicationDisabled();
                const timeoutEmbed = new EmbedBuilder()
                    .setTitle(isTimedOut ? '⏳ Member Timed Out' : '🔊 Member Timeout Removed')
                    .setAuthor({
                        name: newMember.user.tag,
                        iconURL: newMember.user.displayAvatarURL({ dynamic: true })
                    })
                    .setColor(isTimedOut ? 0xE74C3C : 0x2ECC71)
                    .addFields(
                        { name: 'Member', value: `<@${newMember.id}> (\`${newMember.id}\`)`, inline: true },
                        { name: 'Status', value: isTimedOut ? `Timed out until <t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:F>` : 'Timeout Lifted', inline: true }
                    )
                    .setTimestamp();
                await loggerUtil.sendEventLog(newMember.guild, 'memberUpdate', timeoutEmbed, settings);
            }

        } catch (error) {
            console.error('[Logger] Error in MemberUpdate:', error);
        }
    }
};
