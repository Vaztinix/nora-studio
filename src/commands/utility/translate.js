const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('translate')
        .setDescription('Translate text into a chosen language.')
        .setDMPermission(false)
        .addStringOption(option => 
            option.setName('text')
                .setDescription('The text you want to translate')
                .setRequired(true)
        )
        .addStringOption(option => 
            option.setName('language')
                .setDescription('The target language')
                .setRequired(true)
                .addChoices(
                    { name: 'English', value: 'en' },
                    { name: 'Spanish', value: 'es' },
                    { name: 'French', value: 'fr' },
                    { name: 'German', value: 'de' },
                    { name: 'Japanese', value: 'ja' },
                    { name: 'Chinese', value: 'zh' },
                    { name: 'Russian', value: 'ru' },
                    { name: 'Italian', value: 'it' },
                    { name: 'Portuguese', value: 'pt' },
                    { name: 'Arabic', value: 'ar' }
                )
        ),

    async execute(interaction) {
        await interaction.deferReply();
        const text = interaction.options.getString('text');
        const targetLang = interaction.options.getString('language');

        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
            const response = await axios.get(url);
            
            if (!response.data || !response.data[0]) {
                throw new Error('Invalid translation API response.');
            }

            const translatedText = response.data[0].map(x => x[0]).join('');
            const detectedLang = response.data[2] || 'unknown';

            const langNames = {
                en: 'English', es: 'Spanish', fr: 'French', de: 'German',
                ja: 'Japanese', zh: 'Chinese', ru: 'Russian', it: 'Italian',
                pt: 'Portuguese', ar: 'Arabic'
            };

            const embed = new EmbedBuilder()
                .setTitle('🌐 Translation Complete')
                .addFields(
                    { name: `Original Text (${detectedLang.toUpperCase()})`, value: text.substring(0, 1024) },
                    { name: `Translated Text (${(langNames[targetLang] || targetLang).toUpperCase()})`, value: translatedText.substring(0, 1024) }
                )
                .setColor('#57acf2')
                .setTimestamp()
                .setFooter({
                    text: `Translated for ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL()
                });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[Translate Command Error]:', error);
            await interaction.editReply({
                content: '❌ An error occurred while translating your text. Please try again later.'
            });
        }
    },
};
