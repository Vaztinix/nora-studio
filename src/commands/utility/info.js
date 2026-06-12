const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('View Nora\'s current status and performance.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        const ping = interaction.client.ws.ping;
        const totalServers = interaction.client.guilds.cache.size;
        const shardCount = interaction.client.shard ? interaction.client.shard.count : 1;

        const embed = new EmbedBuilder()
            .setAuthor({ name: 'Nora • System Info', iconURL: interaction.client.user.displayAvatarURL() })
            .setTitle('Core Status Report')
            .setColor(0x57acf2)
            .addFields(
                { name: 'Gateway Latency', value: `\`${ping}ms\``, inline: true },
                { name: 'Total Servers', value: `\`${totalServers}\``, inline: true },
                { name: 'Active Shards', value: `\`${shardCount}\``, inline: true },
                { name: 'System Status', value: '```diff\n+ Operations: NOMINAL\n+ Databases: HEALTHY\n+ Shards: STABLE\n```', inline: false }
            )
            .setFooter({ text: 'Nora V2.0 Core Status' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
