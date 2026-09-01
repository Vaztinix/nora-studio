const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const afkManager = require('../../utils/afkManager');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('afkclear')
        .setDescription('Clear the AFK status of a server member.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('The member whose AFK status you want to clear')
                .setRequired(true)),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) &&
            !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return await handleError(interaction, 'Permission Denied', 'You need `Manage Messages` or `Manage Server` permission to use this command.');
        }

        const targetUser = interaction.options.getUser('user');
        const afkData = afkManager.getAfk(interaction.guild.id, targetUser.id);

        if (!afkData) {
            return await handleError(interaction, 'Not AFK', `<@${targetUser.id}> is not currently marked as AFK in this server.`);
        }

        await afkManager.removeAfk(interaction.guild.id, targetUser.id);

        // Try to restore original nickname if it was altered
        try {
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (member && member.manageable && afkData.autoNicknameChanged) {
                await member.setNickname(afkData.originalNickname).catch(() => {});
            }
        } catch (e) {}

        const embed = new EmbedBuilder()
            .setColor('#10b981')
            .setDescription(`✅ Successfully removed AFK status for <@${targetUser.id}>.`)
            .setFooter({ text: `Action by ${interaction.user.tag}` })
            .setTimestamp();

        return await interaction.reply({ embeds: [embed] });
    }
};
