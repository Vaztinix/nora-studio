const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('See all the ways Nora can help your server.'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Nora Help Center')
            .setDescription('Nora is a simple, all-in-one assistant for your Discord server. Here is what she can do:')
            .setColor(0x57acf2)
            .addFields(
                { name: '👤 Profiles & XP', value: '`/rank` - View your level.\n`/leaderboard` - See top members.\n`/mycard` - Manage your data.' },
                { name: '🛡️ Safety & Setup', value: '`/configure` - Change bot settings.\n`/info` - See how Nora is doing.' },
                { name: '🔨 Moderation', value: '`/ban`, `/kick`, `/warn` - Keep the server safe.\n`/purge` - Delete many messages at once.' },
                { name: '🤖 Intelligence', value: '`/ask` - Ask Nora a question (AI).' }
            )
            .setFooter({ text: 'Simple. Transparent. Powerful.' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
