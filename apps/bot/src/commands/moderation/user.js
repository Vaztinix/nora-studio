const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('user')
        .setDescription('User management commands.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('nick')
                .setDescription('Change the nickname of a user.')
                .addUserOption(option => 
                    option.setName('target')
                        .setDescription('The user to manage')
                        .setRequired(true)
                )
                .addStringOption(option => 
                    option.setName('nickname')
                        .setDescription('The new nickname (leave blank to clear)')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'nick') {
            const target = interaction.options.getUser('target');
            const nickname = interaction.options.getString('nickname');

            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) {
                return handleError(interaction, 'User Not Found', 'That user is not in this server.');
            }

            if (member.id === interaction.guild.ownerId) {
                return handleError(interaction, 'Owner Security Bypass', 'The Server Owner nickname cannot be changed by bots.');
            }

            if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
                return handleError(interaction, 'Hierarchy Error', `You cannot change <@${target.id}>'s nickname because their highest role is equal to or higher than yours.`);
            }

            if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                return handleError(interaction, 'Bot Permission Error', 'I lack the **Manage Nicknames** permission. Please update my roles.');
            }

            if (interaction.guild.members.me.roles.highest.position <= member.roles.highest.position) {
                return handleError(interaction, 'Bot Hierarchy Error', `I cannot modify <@${target.id}> because their highest role is equal to or higher than my highest role.`);
            }

            try {
                await member.setNickname(nickname, `Requested by ${interaction.user.tag}`);
                if (nickname) {
                    await handleSuccess(interaction, 'Nickname Changed', `Successfully changed <@${target.id}>'s nickname to **${nickname}**.`);
                } else {
                    await handleSuccess(interaction, 'Nickname Cleared', `Successfully cleared <@${target.id}>'s nickname.`);
                }
            } catch (error) {
                console.error(error);
                await handleError(interaction, 'Execution Error', 'An unexpected error occurred while modifying the user nickname.');
            }
        }
    },
};
