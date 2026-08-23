const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const TempRole = require('../../database/models/TempRole');
const Case = require('../../database/models/Case');
const { processBulkRole, handleViewOperations, handleCancelOperation } = require('../../utils/bulkRoleProcessor');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription("Manage roles individually or in bulk with extensive hierarchy checks.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false)
        .addSubcommand(sub => 
            sub.setName('add')
            .setDescription('Add a role to a single user')
            .addUserOption(opt => opt.setName('target').setDescription('The user to give the role to').setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('The role to assign').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for the audit log').setRequired(false))
        )
        .addSubcommand(sub => 
            sub.setName('remove')
            .setDescription('Remove a role from a single user')
            .addUserOption(opt => opt.setName('target').setDescription('The user to remove the role from').setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('The role to remove').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for the audit log').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('temp')
            .setDescription('Temporarily give a user a role')
            .addUserOption(opt => opt.setName('target').setDescription('The user').setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('The role').setRequired(true))
            .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 30m, 2h, 1d)').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for the audit log').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('bulk-add')
            .setDescription('Bulk assign a role to multiple members based on filter criteria')
            .addRoleOption(opt => opt.setName('role').setDescription('The role to bulk assign').setRequired(true))
            .addStringOption(opt => 
                opt.setName('filter')
                .setDescription('Which members to target')
                .setRequired(true)
                .addChoices(
                    { name: '👥 All Members (Humans & Bots)', value: 'all' },
                    { name: '👤 Humans Only (No Bots)', value: 'humans' },
                    { name: '🤖 Bots Only', value: 'bots' },
                    { name: '✅ Members With a Specific Role', value: 'has_role' },
                    { name: '❌ Members Without a Specific Role', value: 'lacks_role' }
                )
            )
            .addRoleOption(opt => opt.setName('filter_role').setDescription('Role to check if using "Members With/Without a Specific Role"').setRequired(false))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for the audit log').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('bulk-remove')
            .setDescription('Bulk remove a role from multiple members based on filter criteria')
            .addRoleOption(opt => opt.setName('role').setDescription('The role to bulk remove').setRequired(true))
            .addStringOption(opt => 
                opt.setName('filter')
                .setDescription('Which members to target')
                .setRequired(true)
                .addChoices(
                    { name: '👥 All Members (Humans & Bots)', value: 'all' },
                    { name: '👤 Humans Only (No Bots)', value: 'humans' },
                    { name: '🤖 Bots Only', value: 'bots' },
                    { name: '✅ Members With a Specific Role', value: 'has_role' },
                    { name: '❌ Members Without a Specific Role', value: 'lacks_role' }
                )
            )
            .addRoleOption(opt => opt.setName('filter_role').setDescription('Role to check if using "Members With/Without a Specific Role"').setRequired(false))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for the audit log').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('bulk-view')
            .setDescription('View active bulk operations or recent history in this server')
        )
        .addSubcommand(sub =>
            sub.setName('bulk-cancel')
            .setDescription('Cancel an ongoing bulk role operation in this server')
        ),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'bulk-view') {
            return await handleViewOperations(interaction);
        }

        if (subcommand === 'bulk-cancel') {
            return await handleCancelOperation(interaction);
        }

        if (subcommand === 'bulk-add' || subcommand === 'bulk-remove') {
            return await processBulkRole({
                interaction,
                isAdd: subcommand === 'bulk-add',
                role: interaction.options.getRole('role'),
                filter: interaction.options.getString('filter') || 'all',
                filterRole: interaction.options.getRole('filter_role'),
                customReason: interaction.options.getString('reason')
            });
        }

        const target = interaction.options.getUser('target');
        const role = interaction.options.getRole('role');
        const customReason = interaction.options.getString('reason');
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
                await member.roles.add(role, customReason || `Role added by ${interaction.user.tag}`);
                const caseRecord = await Case.create({
                    guildId: interaction.guild.id,
                    userId: target.id,
                    moderatorId: interaction.user.id,
                    type: 'ROLE_ADD',
                    reason: customReason || `Role ${role.name} added`,
                    status: 'active'
                });
                await handleSuccess(interaction, 'Role Added', `Successfully added ${role} to **${target.tag}**.\n**Reason**: \`${customReason || 'No reason provided'}\` (Case #${caseRecord.id})`);
            } else if (subcommand === 'remove') {
                if (!member.roles.cache.has(role.id)) {
                    return handleError(interaction, "Doesn't Have Role", `The user <@${target.id}> does not have the ${role} role.`);
                }
                await member.roles.remove(role, customReason || `Role removed by ${interaction.user.tag}`);
                const caseRecord = await Case.create({
                    guildId: interaction.guild.id,
                    userId: target.id,
                    moderatorId: interaction.user.id,
                    type: 'ROLE_REMOVE',
                    reason: customReason || `Role ${role.name} removed`,
                    status: 'active'
                });
                await handleSuccess(interaction, 'Role Removed', `Successfully removed ${role} from **${target.tag}**.\n**Reason**: \`${customReason || 'No reason provided'}\` (Case #${caseRecord.id})`);
            } else if (subcommand === 'temp') {
                const durationStr = interaction.options.getString('duration');
                const durationMs = parseDuration(durationStr);
                if (!durationMs) {
                    return handleError(interaction, 'Invalid Duration', 'Please provide a valid duration (e.g., `30m` for 30 minutes, `2h` for 2 hours, `1d` for 1 day).');
                }

                if (member.roles.cache.has(role.id)) {
                    return handleError(interaction, 'Already Has Role', `The user <@${target.id}> already has the ${role} role.`);
                }

                await member.roles.add(role, customReason || `Temp role (${durationStr}) by ${interaction.user.tag}`);

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
                    type: 'ROLE_ADD',
                    reason: customReason ? `${customReason} (Temp: ${durationStr})` : `Temporarily given role ${role.name} for ${durationStr}`,
                    status: 'active',
                    duration: durationMs
                });

                await handleSuccess(interaction, 'Role Temporarily Added', `Successfully gave role ${role} to **${target.tag}** temporarily for **${durationStr}**.\n**Reason**: \`${customReason || 'No reason provided'}\` (Case #${caseRecord.id})`);
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
