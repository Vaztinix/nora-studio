const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ticketsEngine = require('../../bot/engines/tickets');
const settingsCache = require('../../utils/settingsCache');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Support ticket management system.')
        .setDMPermission(false)
        .addSubcommandGroup(group =>
            group
                .setName('user')
                .setDescription('Manage users in active ticket channel')
                .addSubcommand(sub =>
                    sub
                        .setName('add')
                        .setDescription('Add a user to the current ticket channel')
                        .addUserOption(opt =>
                            opt.setName('user')
                                .setDescription('The user to add to this ticket')
                                .setRequired(true)))
                .addSubcommand(sub =>
                    sub
                        .setName('remove')
                        .setDescription('Remove a user from the current ticket channel')
                        .addUserOption(opt =>
                            opt.setName('user')
                                .setDescription('The user to remove from this ticket')
                                .setRequired(true))))
        .addSubcommand(sub =>
            sub
                .setName('claim')
                .setDescription('Claim the current ticket as the assigned support staff'))
        .addSubcommand(sub =>
            sub
                .setName('unclaim')
                .setDescription('Unclaim the current ticket'))
        .addSubcommand(sub =>
            sub
                .setName('rename')
                .setDescription('Rename the current ticket channel')
                .addStringOption(opt =>
                    opt.setName('name')
                        .setDescription('New channel name for this ticket')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub
                .setName('open')
                .setDescription('Open a new support ticket')
                .addStringOption(opt =>
                    opt.setName('topic')
                        .setDescription('Topic/category of your issue (e.g. Support, Billing, Bug)')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Brief description of your issue')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub
                .setName('close')
                .setDescription('Close the current ticket channel and compile transcript')
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason for closing this ticket')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub
                .setName('autoclose-exclude')
                .setDescription('Exclude or include this ticket from automatic 24-hour inactivity closure')
                .addBooleanOption(opt =>
                    opt.setName('enabled')
                        .setDescription('Set true to exclude from auto-close, false to enable auto-close')
                        .setRequired(false))),

    async execute(interaction) {
        const settings = await settingsCache.get(interaction.guild.id);
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();

        try {
            if (group === 'user') {
                const targetUser = interaction.options.getUser('user');
                if (subcommand === 'add') {
                    return await ticketsEngine.handleTicketUserAdd(interaction, targetUser);
                } else if (subcommand === 'remove') {
                    return await ticketsEngine.handleTicketUserRemove(interaction, targetUser);
                }
            }

            if (subcommand === 'claim') {
                return await ticketsEngine.handleTicketClaim(interaction);
            } else if (subcommand === 'unclaim') {
                return await ticketsEngine.handleTicketUnclaim(interaction);
            } else if (subcommand === 'rename') {
                const newName = interaction.options.getString('name');
                return await ticketsEngine.handleTicketRename(interaction, newName);
            } else if (subcommand === 'open') {
                const topic = interaction.options.getString('topic') || 'General Support';
                const reason = interaction.options.getString('reason') || 'No reason specified';
                return await ticketsEngine.handleTicketOpenCommand(interaction, settings, topic, reason);
            } else if (subcommand === 'close') {
                return await ticketsEngine.handleTicketClose(interaction, settings);
            } else if (subcommand === 'autoclose-exclude') {
                const enabled = interaction.options.getBoolean('enabled');
                return await ticketsEngine.handleTicketAutocloseExclude(interaction, enabled);
            }
        } catch (err) {
            console.error(`Error executing /ticket ${group ? `${group} ` : ''}${subcommand}:`, err);
            return await handleError(interaction, 'Execution Error', 'An error occurred while executing the ticket command.');
        }
    }
};
