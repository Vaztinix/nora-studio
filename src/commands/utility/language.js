const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserPrefs = require('../../database/models/UserPrefs');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleSuccess, handleError } = require('../../utils/embeds');
const I18n = require('../../utils/i18n');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('language')
        .setDescription('Set your preferred language for Nora\'s responses and sync with dashboard.')
        .addStringOption(option =>
            option.setName('lang')
            .setDescription('Select your preferred language')
            .setRequired(true)
            .addChoices(
                { name: 'English 🇺🇸', value: 'en' },
                { name: 'Español 🇪🇸', value: 'es' },
                { name: 'Français 🇫🇷', value: 'fr' },
                { name: 'Deutsch 🇩🇪', value: 'de' },
                { name: 'Português 🇵🇹', value: 'pt' },
                { name: 'Italiano 🇮🇹', value: 'it' },
                { name: 'Русский 🇷🇺', value: 'ru' },
                { name: 'हिन्दी 🇮🇳', value: 'hi' },
                { name: '日本語 🇯🇵', value: 'ja' },
                { name: '한국어 🇰🇷', value: 'ko' },
                { name: '中文 🇨🇳', value: 'zh' }
            )
        )
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const selectedLang = interaction.options.getString('lang');
        const userId = interaction.user.id;

        try {
            // Find or create UserPrefs entry
            const [prefs] = await UserPrefs.findOrCreate({ where: { userId } });
            
            // Save preferred language
            prefs.language = selectedLang;
            await prefs.save();

            // Load new language pack
            const isDM = !interaction.guild;
            const settings = isDM ? null : await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });
            const lang = I18n.getLanguage(settings, prefs, interaction);

            // Construct beautiful confirmation embed
            const embed = new EmbedBuilder()
                .setColor('#26f7af')
                .setAuthor({ name: 'Nora Localization', iconURL: interaction.client.user.displayAvatarURL() })
                .setTitle(I18n.t(selectedLang, 'lang_saved_title'))
                .setDescription(I18n.t(selectedLang, 'lang_saved_desc'))
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: 64 });
        } catch (e) {
            console.error('[Language Command Error]', e);
            await interaction.reply({ content: '❌ Failed to save your language preference. Please try again later.', flags: 64 });
        }
    }
};
