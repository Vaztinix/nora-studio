const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Support Nora on Top.gg and receive voter perks.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setAuthor({ 
                name: 'Nora Support & Voting', 
                iconURL: interaction.client.user.displayAvatarURL() 
            })
            .setTitle('Vote for Nora on Top.gg')
            .setColor(0x5865F2)
            .setDescription(
                'Voting helps Nora reach more communities and grants voter perks in supported servers.\n\n' +
                'You can vote once every **12 hours** on Top.gg (with 2x XP multipliers on weekends).'
            )
            .addFields(
                {
                    name: 'Voter Perks',
                    value: '• **Bonus Leveling XP**: Earn bonus XP across enabled servers.\n• **Profile Badge**: Displayed on your `/mycard` profile.\n• **Priority Limits**: Fast-pass command execution.'
                }
            )
            .setFooter({ text: 'Nora Assistant • Top.gg' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Vote on Top.gg')
                .setURL('https://top.gg/bot/740998573237825536/vote')
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel('Website')
                .setURL('https://vaztinix.dev')
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel('Support Server')
                .setURL('https://discord.gg/Uxb2tNAxtp')
                .setStyle(ButtonStyle.Link)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};
