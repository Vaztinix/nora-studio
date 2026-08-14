const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const StatusFlag = require('../../database/models/StatusFlag');

module.exports = {
    category: 'owner',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('statusflag')
        .setDescription('Manage operational flags & incident notes for vaztinix.dev/status (Owner only)')
        .setDefaultMemberPermissions(0)
        .setDMPermission(true)
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Publish a new status flag or operational incident note')
                .addStringOption(opt =>
                    opt.setName('title')
                        .setDescription('Short summary title for the incident')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('Detailed explanation / operational notes')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('severity')
                        .setDescription('Severity level')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Info / Announcement', value: 'info' },
                            { name: 'Degraded Performance', value: 'degraded' },
                            { name: 'Partial / Service Outage', value: 'outage' },
                            { name: 'Scheduled Maintenance', value: 'maintenance' }
                        ))
                .addIntegerOption(opt =>
                    opt.setName('shard')
                        .setDescription('Target shard ID (defaults to Shard #0)')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('resolve')
                .setDescription('Resolve an active status flag on vaztinix.dev/status')
                .addIntegerOption(opt =>
                    opt.setName('id')
                        .setDescription('The ID of the status flag to resolve')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('note')
                        .setDescription('Resolution note explaining the fix')
                        .setRequired(false))),

    async execute(interaction) {
        const APP_OWNER_ID = '1214048435632603137';
        if (interaction.user.id !== APP_OWNER_ID) {
            const { handleError } = require('../../utils/embeds');
            return handleError(interaction, 'Unauthorized Access', 'This command is physically locked to **Vaztinix**.');
        }

        await interaction.deferReply({ ephemeral: true });
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            const title = interaction.options.getString('title');
            const message = interaction.options.getString('message');
            const severity = interaction.options.getString('severity');
            const shardId = interaction.options.getInteger('shard') || 0;

            const flag = await StatusFlag.create({
                title,
                message,
                severity,
                shardId,
                author: `${interaction.user.username} (Owner)`,
                isResolved: false
            });

            const colorMap = {
                info: 0x3B82F6,
                degraded: 0xF59E0B,
                outage: 0xEF4444,
                maintenance: 0x7C3AED
            };

            const embed = new EmbedBuilder()
                .setTitle('🚨 Status Flag Published')
                .setDescription(`Published operational note to [vaztinix.dev/status](https://vaztinix.dev/status).`)
                .setColor(colorMap[severity] || 0x7C3AED)
                .addFields(
                    { name: 'Flag ID', value: `\`#${flag.id}\``, inline: true },
                    { name: 'Severity', value: `\`${severity.toUpperCase()}\``, inline: true },
                    { name: 'Target Shard', value: `\`Shard #${shardId}\``, inline: true },
                    { name: 'Title', value: title, inline: false },
                    { name: 'Message', value: message, inline: false }
                )
                .setFooter({ text: 'vaztinix.dev/status • Live Status Monitor' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } else if (subcommand === 'resolve') {
            const flagId = interaction.options.getInteger('id');
            const note = interaction.options.getString('note') || 'Issue resolved and operations restored.';

            const flag = await StatusFlag.findByPk(flagId);
            if (!flag) {
                return interaction.editReply({ content: `❌ Status flag \`#${flagId}\` was not found in the database.` });
            }

            flag.isResolved = true;
            flag.resolvedAt = new Date();
            flag.resolutionNote = note;
            await flag.save();

            const embed = new EmbedBuilder()
                .setTitle('✅ Status Flag Resolved')
                .setDescription(`Marked Status Flag \`#${flag.id}\` as resolved on [vaztinix.dev/status](https://vaztinix.dev/status).`)
                .setColor(0x10B981)
                .addFields(
                    { name: 'Flag Title', value: flag.title, inline: true },
                    { name: 'Resolution Note', value: note, inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    }
};
