const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Support Nora by voting on Top.gg!'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🗳️ Vote for Nora!')
            .setDescription('Support the development of Nora Bot by voting on Top.gg! Your votes help the bot grow and bring privacy-first safety to more servers.')
            .setColor(0x7289DA)
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Vote on Top.gg')
                .setURL('https://top.gg/bot/740998573237825536/vote')
                .setStyle(ButtonStyle.Link)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};
