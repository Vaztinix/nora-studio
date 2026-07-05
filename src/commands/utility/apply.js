const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const Application = require('../../database/models/Application');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('apply')
        .setDescription('Apply to an open position in this server'),

    async execute(interaction) {
        const guildId = interaction.guildId;

        try {
            // Find all active applications for the guild
            const apps = await Application.findAll({
                where: { guildId, isActive: true }
            });

            if (!apps || apps.length === 0) {
                return interaction.reply({
                    content: '❌ There are no active applications available in this server right now.',
                    ephemeral: true
                });
            }

            // If there's only 1 application, show an apply button
            if (apps.length === 1) {
                const app = apps[0];
                const embed = new EmbedBuilder()
                    .setTitle(`Apply for ${app.name}`)
                    .setDescription(app.description || 'Click the button below to start your application.')
                    .setColor(0x57acf2)
                    .setFooter({ text: 'Application Portal' });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`app_start_${app.id}`)
                        .setLabel('Start Application')
                        .setStyle(ButtonStyle.Success)
                );

                return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
            }

            // If there are multiple, show a select menu to choose
            const embed = new EmbedBuilder()
                .setTitle('Server Application Portal')
                .setDescription('Please select the position you wish to apply for from the dropdown menu below.')
                .setColor(0x57acf2);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('app_select')
                .setPlaceholder('Choose a position...')
                .addChoices(
                    apps.map(app => ({
                        label: app.name.slice(0, 100),
                        description: (app.description || 'Open position').slice(0, 100),
                        value: app.id
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

        } catch (error) {
            console.error('Error starting application process:', error);
            await handleError(interaction, 'Application Error', 'An unexpected error occurred while loading server applications.');
        }
    }
};
