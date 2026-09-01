const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check Nora\'s response latency and connection speed.')
        .setDMPermission(true),

    async execute(interaction) {
        const start = Date.now();
        const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
        
        const roundTrip = Math.max(1, Date.now() - start);
        const wsPing = Math.max(1, Math.round(interaction.client.ws.ping));

        const responseText = `🏓 **Pong!** Latency is **${wsPing}ms** *(API Roundtrip: **${roundTrip}ms**)*`;

        if (interaction.isMessage) {
            await sent.edit({ content: responseText });
        } else {
            await interaction.editReply({ content: responseText });
        }
    }
};
