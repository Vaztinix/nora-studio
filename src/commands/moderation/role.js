const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription("Manage a user's roles with extensive hierarchy checks.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false)
        .addSubcommand(sub => 
            sub.setName('add')
            .setDescription('Add a role to a user')
            .addUserOption(opt => opt.setName('target').setDescription('The user').setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('The role').setRequired(true))
        )
        .addSubcommand(sub => 
            sub.setName('remove')
            .setDescription('Remove a role from a user')
            .addUserOption(opt => opt.setName('target').setDescription('The user').setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('The role').setRequired(true))
        ),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const target = interaction.options.getUser('target');
        const role = interaction.options.getRole('role');
        const subcommand = interaction.options.getSubcommand();
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (!member) {
            return handleError(interaction, 'User Not Found', 'That user is not in this server.');
        }

        // 🛡️ Nora System Security Matrix: OWNER IMMUNITY
        if (target.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            return handleError(interaction, 'Owner Security Bypass', 'You cannot physically modify the Server Owner. This event has been flagged and logged.');
        }

        // Hierarchy checks for the executor (Role check)
        if (interaction.member.roles.highest.position <= role.position && interaction.guild.ownerId !== interaction.user.id) {
            return handleError(interaction, 'Hierarchy Error', `You cannot manage the role ${role} because it is equal to or higher than your own highest role.`);
        }

        // Hierarchy checks for the executor (User check)
        if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id && interaction.user.id !== target.id) {
            return handleError(interaction, 'User Hierarchy Error', `You cannot manage roles for <@${target.id}> because their highest role is equal to or higher than yours.`);
        }

        // Hierarchy checks for the bot
        if (interaction.guild.members.me.roles.highest.position <= role.position) {
            return handleError(interaction, 'Bot Hierarchy Error', `I cannot manage the role ${role} because it is equal to or higher than my own highest role.`);
        }

        try {
            if (subcommand === 'add') {
                if (member.roles.cache.has(role.id)) {
                    return handleError(interaction, 'Already Has Role', `The user <@${target.id}> already has the ${role} role.`);
                }
                await member.roles.add(role);
                await handleSuccess(interaction, 'Role Added', `Successfully added ${role} to **${target.tag}**.`);
            } else if (subcommand === 'remove') {
                if (!member.roles.cache.has(role.id)) {
                    return handleError(interaction, "Doesn't Have Role", `The user <@${target.id}> does not have the ${role} role.`);
                }
                await member.roles.remove(role);
                await handleSuccess(interaction, 'Role Removed', `Successfully removed ${role} from **${target.tag}**.`);
            }
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while updating roles. Please ensure I have the Manage Roles permission.');
        }
    },
};
