const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserPrefs = require('../../database/models/UserPrefs');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('levelupdms')
        .setDescription('Toggle receiving direct message notifications whenever you level up.')
        .addBooleanOption(option => 
            option.setName('enabled')
                .setDescription('Whether you want to receive level-up DMs (True = On, False = Off)')
                .setRequired(true))
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        const enabled = interaction.options.getBoolean('enabled');
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: interaction.user.id } });
        
        prefs.dmNotificationsEnabled = enabled;
        prefs.dmNotifLevels = enabled;
        await prefs.save();

        const statusText = enabled ? 'Enabled' : 'Disabled';
        const statusColor = enabled ? 0x57F287 : 0x4F545C;

        const embed = new EmbedBuilder()
            .setTitle(`Level-Up DM Notifications: ${statusText}`)
            .setColor(statusColor)
            .setDescription(
                enabled 
                    ? 'You will receive private DMs whenever you level up in servers where Nora is active, including any newly unlocked role rewards.'
                    : 'Level-up DMs are now muted. Level-up announcements will only appear in designated server channels.'
            )
            .setFooter({ text: 'You can change this setting at any time using /levelupdms' })
            .setTimestamp();

        return interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
    }
};
