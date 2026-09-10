const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const ticketsEngine = require('../../bot/engines/tickets');
const settingsCache = require('../../utils/settingsCache');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Advanced support ticket management suite.')
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
        .addSubcommandGroup(group =>
            group
                .setName('note')
                .setDescription('Internal staff notes for this ticket')
                .addSubcommand(sub =>
                    sub
                        .setName('add')
                        .setDescription('Add an internal staff note')
                        .addStringOption(opt =>
                            opt.setName('content')
                                .setDescription('Note text')
                                .setRequired(true)))
                .addSubcommand(sub =>
                    sub
                        .setName('view')
                        .setDescription('View all internal staff notes for this ticket')))
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
                .setName('transfer')
                .setDescription('Transfer ticket assignment to another staff member')
                .addUserOption(opt =>
                    opt.setName('staff')
                        .setDescription('The staff member to assign this ticket to')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub
                .setName('priority')
                .setDescription('Set the priority level of this ticket')
                .addStringOption(opt =>
                    opt.setName('level')
                        .setDescription('Priority level')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Low', value: 'Low' },
                            { name: 'Normal', value: 'Normal' },
                            { name: 'High', value: 'High' },
                            { name: 'Urgent', value: 'Urgent' }
                        )))
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
                        .setDescription('Topic/category of your issue (e.g. General Support, Bug Report, Billing)')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Brief description of your issue')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub
                .setName('close')
                .setDescription('Close the current ticket channel and compile transcript'))
        .addSubcommand(sub =>
            sub
                .setName('panel')
                .setDescription('Deploy an interactive support ticket panel into a channel')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('The channel to send the ticket panel to')
                        .addChannelTypes(ChannelType.GuildText)
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

            if (group === 'note') {
                if (subcommand === 'add') {
                    const content = interaction.options.getString('content');
                    return await ticketsEngine.handleTicketStaffNote(interaction, 'add', content);
                } else if (subcommand === 'view') {
                    return await ticketsEngine.handleTicketStaffNote(interaction, 'view');
                }
            }

            if (subcommand === 'claim') {
                return await ticketsEngine.handleTicketClaimButton(interaction, settings);
            } else if (subcommand === 'unclaim') {
                return await ticketsEngine.handleTicketUnclaimButton(interaction, settings);
            } else if (subcommand === 'transfer') {
                const targetStaff = interaction.options.getUser('staff');
                return await ticketsEngine.handleTicketTransfer(interaction, targetStaff);
            } else if (subcommand === 'priority') {
                const level = interaction.options.getString('level');
                return await ticketsEngine.handleTicketPriority(interaction, level);
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
            } else if (subcommand === 'panel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return interaction.reply({ content: 'You must have Manage Server permissions to deploy ticket panels.', ephemeral: true });
                }
                const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
                await ticketsEngine.sendTicketPanel(targetChannel, {
                    title: settings.ticketPanelTitle || 'Support & Assistance Hub',
                    description: settings.ticketPanelDesc || 'Need help or want to contact server staff? Select a topic below to open a private, dedicated support ticket.'
                });
                return interaction.reply({ content: `Ticket panel successfully deployed in <#${targetChannel.id}>!`, ephemeral: true });
            }
        } catch (err) {
            console.error(`Error executing /ticket ${group ? `${group} ` : ''}${subcommand}:`, err);
            return await handleError(interaction, 'Execution Error', 'An error occurred while executing the ticket command.');
        }
    }
};
