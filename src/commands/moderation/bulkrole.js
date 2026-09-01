const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { processBulkRole, handleViewOperations, handleCancelOperation } = require('../../utils/bulkRoleProcessor');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('bulkrole')
        .setDescription('Bulk assign or remove roles from multiple members, view progress, or cancel tasks.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('add')
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
            .addStringOption(opt => opt.setName('joined_after').setDescription('Filter members who joined after date/time (e.g. 2024-01-01, 7d, 24h)').setRequired(false))
            .addStringOption(opt => opt.setName('joined_before').setDescription('Filter members who joined before date/time (e.g. 2024-01-01, 30d, 2w)').setRequired(false))
            .addStringOption(opt => opt.setName('created_after').setDescription('Filter accounts created after date/time (e.g. 2024-01-01, 7d)').setRequired(false))
            .addStringOption(opt => opt.setName('created_before').setDescription('Filter accounts created before date/time (e.g. 2024-01-01, 30d, 1y)').setRequired(false))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for the audit log').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
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
            .addStringOption(opt => opt.setName('joined_after').setDescription('Filter members who joined after date/time (e.g. 2024-01-01, 7d, 24h)').setRequired(false))
            .addStringOption(opt => opt.setName('joined_before').setDescription('Filter members who joined before date/time (e.g. 2024-01-01, 30d, 2w)').setRequired(false))
            .addStringOption(opt => opt.setName('created_after').setDescription('Filter accounts created after date/time (e.g. 2024-01-01, 7d)').setRequired(false))
            .addStringOption(opt => opt.setName('created_before').setDescription('Filter accounts created before date/time (e.g. 2024-01-01, 30d, 1y)').setRequired(false))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for the audit log').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('view')
            .setDescription('View active operations or recent operation history in this server')
        )
        .addSubcommand(sub =>
            sub.setName('cancel')
            .setDescription('Cancel an ongoing bulk role operation in this server')
        ),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            return await handleViewOperations(interaction);
        }

        if (subcommand === 'cancel') {
            return await handleCancelOperation(interaction);
        }

        const isAdd = subcommand === 'add';

        return await processBulkRole({
            interaction,
            isAdd,
            role: interaction.options.getRole('role'),
            filter: interaction.options.getString('filter') || 'all',
            filterRole: interaction.options.getRole('filter_role'),
            joinedBeforeStr: interaction.options.getString('joined_before'),
            joinedAfterStr: interaction.options.getString('joined_after'),
            createdBeforeStr: interaction.options.getString('created_before'),
            createdAfterStr: interaction.options.getString('created_after'),
            customReason: interaction.options.getString('reason')
        });
    }
};
