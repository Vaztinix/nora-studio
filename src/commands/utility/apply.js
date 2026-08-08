const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const Application = require('../../database/models/Application');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('apply')
        .setDescription('Apply to an open position or deploy application panels')
        .addSubcommand(sub =>
            sub.setName('start')
               .setDescription('Open the application portal to apply for open positions')
        )
        .addSubcommand(sub =>
            sub.setName('panel')
               .setDescription('Deploy a permanent application panel to a channel (Admins only)')
               .addChannelOption(opt =>
                   opt.setName('channel')
                      .setDescription('Channel to send the application panel card to')
                      .addChannelTypes(ChannelType.GuildText)
                      .setRequired(true)
               )
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const subcommand = interaction.options.getSubcommand(false) || 'start';

        try {
            // Handle Subcommand: panel (Deploy permanent panel to channel)
            if (subcommand === 'panel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
                    !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return interaction.reply({ content: '❌ You must have Administrator or Manage Server permissions to deploy application panels.', ephemeral: true });
                }

                const channel = interaction.options.getChannel('channel');
                const apps = await Application.findAll({ where: { guildId, isActive: true } });

                if (!apps || apps.length === 0) {
                    return interaction.reply({
                        content: '❌ No active applications found for this server. Please create an application position first in the Nora Dashboard.',
                        ephemeral: true
                    });
                }

                if (apps.length === 1) {
                    const app = apps[0];
                    const embed = new EmbedBuilder()
                        .setTitle(`📝 ${app.name}`)
                        .setDescription(app.description || 'Click the button below to submit your application form.')
                        .setColor(0x57acf2)
                        .setTimestamp()
                        .setFooter({ text: `${interaction.guild.name} Application Portal` });

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`app_start_${app.id}`)
                            .setLabel('Apply Now')
                            .setStyle(ButtonStyle.Primary)
                    );

                    await channel.send({ embeds: [embed], components: [row] });
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle(`📝 Server Application Portal`)
                        .setDescription('Select the position you wish to apply for from the dropdown menu below.')
                        .setColor(0x57acf2)
                        .setTimestamp()
                        .setFooter({ text: `${interaction.guild.name} Application Portal` });

                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('app_select')
                        .setPlaceholder('Choose a position to apply for...')
                        .addOptions(
                            apps.map(app => ({
                                label: app.name.slice(0, 100),
                                description: (app.description || 'Open position').slice(0, 100),
                                value: String(app.id)
                            }))
                        );

                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    await channel.send({ embeds: [embed], components: [row] });
                }

                return interaction.reply({
                    content: `✅ Successfully deployed the application panel to <#${channel.id}>!`,
                    ephemeral: true
                });
            }

            // Handle Subcommand: start (or default /apply)
            const apps = await Application.findAll({
                where: { guildId, isActive: true }
            });

            if (!apps || apps.length === 0) {
                return interaction.reply({
                    content: '❌ There are no active applications available in this server right now.',
                    ephemeral: true
                });
            }

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

            const embed = new EmbedBuilder()
                .setTitle('Server Application Portal')
                .setDescription('Please select the position you wish to apply for from the dropdown menu below.')
                .setColor(0x57acf2);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('app_select')
                .setPlaceholder('Choose a position...')
                .addOptions(
                    apps.map(app => ({
                        label: app.name.slice(0, 100),
                        description: (app.description || 'Open position').slice(0, 100),
                        value: String(app.id)
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
