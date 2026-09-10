const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const LANG_NAMES = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    ja: 'Japanese',
    zh: 'Chinese',
    ru: 'Russian',
    it: 'Italian',
    pt: 'Portuguese',
    ar: 'Arabic',
    ko: 'Korean',
    hi: 'Hindi',
    nl: 'Dutch',
    tr: 'Turkish',
    pl: 'Polish',
    vi: 'Vietnamese'
};

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('translate')
        .setDescription('Translate text into various global languages.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true)
        .addStringOption(option => 
            option.setName('text')
                .setDescription('The source text to translate')
                .setRequired(true)
        )
        .addStringOption(option => 
            option.setName('language')
                .setDescription('Target language')
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
                    { name: 'Arabic', value: 'ar' },
                    { name: 'Korean', value: 'ko' },
                    { name: 'Hindi', value: 'hi' },
                    { name: 'Dutch', value: 'nl' },
                    { name: 'Turkish', value: 'tr' },
                    { name: 'Polish', value: 'pl' },
                    { name: 'Vietnamese', value: 'vi' }
                )
        ),

    async execute(interaction) {
        await interaction.deferReply().catch(() => {});
        const text = interaction.options.getString('text');
        const targetLang = interaction.options.getString('language');

        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
            const response = await axios.get(url, { timeout: 8000 });
            
            if (!response.data || !response.data[0]) {
                throw new Error('Invalid translation response.');
            }

            const translatedText = response.data[0].map(x => x[0]).join('');
            const detectedCode = (response.data[2] || 'auto').toLowerCase();
            const sourceName = LANG_NAMES[detectedCode] || detectedCode.toUpperCase();
            const targetName = LANG_NAMES[targetLang] || targetLang.toUpperCase();

            const charCount = text.length;
            const wordCount = text.trim().split(/\s+/).length;

            const embed = new EmbedBuilder()
                .setTitle(`Translation (${sourceName} → ${targetName})`)
                .setColor(0x5865F2)
                .addFields(
                    { 
                        name: `Original (${sourceName})`, 
                        value: text.length > 1020 ? text.substring(0, 1017) + '...' : text, 
                        inline: false 
                    },
                    { 
                        name: `Translation (${targetName})`, 
                        value: translatedText.length > 1020 ? translatedText.substring(0, 1017) + '...' : translatedText, 
                        inline: false 
                    },
                    {
                        name: 'Text Length',
                        value: `${wordCount} words • ${charCount} characters`,
                        inline: false
                    }
                )
                .setFooter({
                    text: `Requested by ${interaction.user.tag}`
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[Translate Command Error]:', error);
            await interaction.editReply({
                content: 'Failed to translate your text. Please try again later.'
            });
        }
    },
};
