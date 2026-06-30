const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('poll-create')
        .setDescription('Create a new poll and configure a question and choices')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('The question for the poll')
                .setRequired(true))
        .addStringOption(option => option.setName('choice1').setDescription('First choice').setRequired(true))
        .addStringOption(option => option.setName('choice2').setDescription('Second choice').setRequired(true))
        .addStringOption(option => option.setName('choice3').setDescription('Third choice'))
        .addStringOption(option => option.setName('choice4').setDescription('Fourth choice'))
        .addStringOption(option => option.setName('choice5').setDescription('Fifth choice'))
        .addStringOption(option => option.setName('choice6').setDescription('Sixth choice'))
        .addStringOption(option => option.setName('choice7').setDescription('Seventh choice'))
        .addStringOption(option => option.setName('choice8').setDescription('Eighth choice'))
        .addStringOption(option => option.setName('choice9').setDescription('Ninth choice'))
        .addStringOption(option => option.setName('choice10').setDescription('Tenth choice')),

    async execute(interaction) {
        const question = interaction.options.getString('question');
        const choices = [];
        for (let i = 1; i <= 10; i++) {
            const choice = interaction.options.getString(`choice${i}`);
            if (choice) choices.push(choice);
        }

        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

        let description = '';
        for (let i = 0; i < choices.length; i++) {
            description += `${emojis[i]} ${choices[i]}\n\n`;
        }

        const embed = new EmbedBuilder()
            .setTitle(question)
            .setDescription(description)
            .setColor(0x57acf2)
            .setFooter({ text: `Poll created by ${interaction.user.tag}` })
            .setTimestamp();

        const message = await interaction.reply({ embeds: [embed], fetchReply: true });

        for (let i = 0; i < choices.length; i++) {
            await message.react(emojis[i]);
        }
    }
};
