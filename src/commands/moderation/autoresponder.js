const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const Autoresponder = require('../../database/models/Autoresponder');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('autoresponder')
        .setDescription('Configure autoresponder triggers.')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a new autoresponder trigger.')
                .addStringOption(opt => opt.setName('trigger').setDescription('Word or phrase that triggers the bot').setRequired(true))
                .addStringOption(opt => opt.setName('response').setDescription('What the bot replies with').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('match_type')
                        .setDescription('How the trigger should match (default: contains)')
                        .addChoices(
                            { name: 'Contains', value: 'contains' },
                            { name: 'Exact Match', value: 'exact' },
                            { name: 'Starts With', value: 'startsWith' }
                        )
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove an existing autoresponder trigger.')
                .addStringOption(opt => opt.setName('trigger').setDescription('The trigger to delete').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all autoresponders configured for this server.')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (subcommand === 'add') {
            const trigger = interaction.options.getString('trigger').trim();
            const response = interaction.options.getString('response');
            const matchType = interaction.options.getString('match_type') || 'contains';

            await interaction.deferReply({ ephemeral: true });

            try {
                const [record, created] = await Autoresponder.findOrCreate({
                    where: { guildId, trigger },
                    defaults: { response, matchType }
                });

                if (!created) {
                    await record.update({ response, matchType });
                }

                return await handleSuccess(
                    interaction,
                    'Autoresponder Configured',
                    `Successfully configured trigger!\n- **Trigger**: \`${trigger}\`\n- **Match Type**: \`${matchType}\`\n- **Response**: ${response}`
                );
            } catch (error) {
                console.error('[Autoresponder Add Command Error]:', error);
                return await handleError(interaction, 'System Error', 'Failed to configure autoresponder.');
            }
        }

        if (subcommand === 'remove') {
            const trigger = interaction.options.getString('trigger').trim();
            await interaction.deferReply({ ephemeral: true });

            try {
                const count = await Autoresponder.destroy({
                    where: { guildId, trigger }
                });

                if (count === 0) {
                    return await handleError(interaction, 'Not Found', `No autoresponder found with trigger \`${trigger}\`.`);
                }

                return await handleSuccess(
                    interaction,
                    'Autoresponder Removed',
                    `Successfully deleted autoresponder for trigger \`${trigger}\`.`
                );
            } catch (error) {
                console.error('[Autoresponder Remove Command Error]:', error);
                return await handleError(interaction, 'System Error', 'Failed to remove autoresponder.');
            }
        }

        if (subcommand === 'list') {
            await interaction.deferReply({ ephemeral: true });

            try {
                const list = await Autoresponder.findAll({ where: { guildId } });
                if (list.length === 0) {
                    const embed = new EmbedBuilder()
                        .setTitle('🤖 Server Autoresponders')
                        .setDescription('No autoresponders configured for this server. Use `/autoresponder add` to create one!')
                        .setColor('#4F46E5');
                    return await interaction.editReply({ embeds: [embed] });
                }

                const embed = new EmbedBuilder()
                    .setTitle('🤖 Server Autoresponders')
                    .setColor('#4F46E5')
                    .setDescription(
                        list.map((r, i) => `**${i + 1}.** Trigger: \`${r.trigger}\` (Match: \`${r.matchType}\`)\n   Response: ${r.response.length > 100 ? r.response.slice(0, 97) + '...' : r.response}`)
                            .join('\n\n')
                    );

                return await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error('[Autoresponder List Command Error]:', error);
                return await handleError(interaction, 'System Error', 'Failed to fetch autoresponder list.');
            }
        }
    }
};
