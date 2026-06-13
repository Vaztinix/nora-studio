const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const TempRole = require('../../database/models/TempRole');
const Case = require('../../database/models/Case');

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
        )
        .addSubcommand(sub =>
            sub.setName('temp')
            .setDescription('Temporarily give a user a role')
            .addUserOption(opt => opt.setName('target').setDescription('The user').setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('The role').setRequired(true))
            .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 30m, 2h, 1d)').setRequired(true))
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
                const caseRecord = await Case.create({
                    guildId: interaction.guild.id,
                    userId: target.id,
                    moderatorId: interaction.user.id,
                    action: 'RoleAdd',
                    reason: `Role ${role.name} added`
                });
                await handleSuccess(interaction, 'Role Added', `Successfully added ${role} to **${target.tag}**. (Case #${caseRecord.id})`);
            } else if (subcommand === 'remove') {
                if (!member.roles.cache.has(role.id)) {
                    return handleError(interaction, "Doesn't Have Role", `The user <@${target.id}> does not have the ${role} role.`);
                }
                await member.roles.remove(role);
                const caseRecord = await Case.create({
                    guildId: interaction.guild.id,
                    userId: target.id,
                    moderatorId: interaction.user.id,
                    action: 'RoleRemove',
                    reason: `Role ${role.name} removed`
                });
                await handleSuccess(interaction, 'Role Removed', `Successfully removed ${role} from **${target.tag}**. (Case #${caseRecord.id})`);
            } else if (subcommand === 'temp') {
                const durationStr = interaction.options.getString('duration');
                const durationMs = parseDuration(durationStr);
                if (!durationMs) {
                    return handleError(interaction, 'Invalid Duration', 'Please provide a valid duration (e.g., `30m` for 30 minutes, `2h` for 2 hours, `1d` for 1 day).');
                }

                if (member.roles.cache.has(role.id)) {
                    return handleError(interaction, 'Already Has Role', `The user <@${target.id}> already has the ${role} role.`);
                }

                await member.roles.add(role);

                const removeTime = new Date(Date.now() + durationMs);
                await TempRole.create({
                    guildId: interaction.guild.id,
                    userId: target.id,
                    roleId: role.id,
                    removeTime
                });

                const caseRecord = await Case.create({
                    guildId: interaction.guild.id,
                    userId: target.id,
                    moderatorId: interaction.user.id,
                    action: 'RoleTemp',
                    reason: `Temporarily given role ${role.name} for ${durationStr}`
                });

                await handleSuccess(interaction, 'Role Temporarily Added', `Successfully gave role ${role} to **${target.tag}** temporarily for ${durationStr}. (Case #${caseRecord.id})`);
            }
        } catch (error) {
            console.error(error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while updating roles. Please ensure I have the Manage Roles permission.');
        }
    },
};

function parseDuration(str) {
    const regex = /^(\d+)([smhd])$/i;
    const match = str.match(regex);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}
