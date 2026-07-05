const { SlashCommandBuilder } = require('discord.js');
const UserPrefs = require('../../database/models/UserPrefs');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('levelupdms')
        .setDescription('Toggle receiving level-up notifications in your Direct Messages (DMs).')
        .addBooleanOption(option => 
            option.setName('enabled')
                .setDescription('Whether you want to receive level-up DMs.')
                .setRequired(true)),

    async execute(interaction) {
        const enabled = interaction.options.getBoolean('enabled');
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: interaction.user.id } });
        
        prefs.dmNotificationsEnabled = enabled;
        prefs.dmNotifLevels = enabled;
        await prefs.save();

        const status = enabled ? 'enabled' : 'disabled';
        return interaction.reply({
            content: `✨ Level-up DM notifications have been **${status}** for your account.`,
            ephemeral: true
        });
    }
};
