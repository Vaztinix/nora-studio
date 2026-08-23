const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleViewOperations, handleCancelOperation } = require('../../utils/bulkRoleProcessor');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('operations')
        .setDescription('View live background server operations or cancel an active task.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('view')
            .setDescription('View active background tasks and recent operation history in this server')
        )
        .addSubcommand(sub =>
            sub.setName('cancel')
            .setDescription('Cancel an ongoing background operation in this server')
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
    }
};
