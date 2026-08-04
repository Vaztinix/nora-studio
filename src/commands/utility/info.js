const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const os = require('os');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('View Nora\'s official core status report card.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        const ping = interaction.client.ws.ping;
        const totalServers = interaction.client.guilds.cache.size;
        const totalMembers = interaction.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);

        const memUsage = process.memoryUsage();
        const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);

        const uptimeHours = Math.floor(interaction.client.uptime / (1000 * 60 * 60));
        const uptimeMins = Math.floor((interaction.client.uptime % (1000 * 60 * 60)) / (1000 * 60));
        const uptimeStr = `${uptimeHours}h ${uptimeMins}m`;

        const { handleInfo } = require('../../utils/embeds');
        await handleInfo(interaction, 'Nora Core Status', 'REAL-TIME SYSTEM DIAGNOSTICS & METRICS', [
            { name: '⚡ Latency', value: `\`${ping}ms\``, inline: true },
            { name: '🌐 Total Servers', value: `\`${totalServers}\``, inline: true },
            { name: '👥 Total Members', value: `\`${totalMembers.toLocaleString()}\``, inline: true },
            { name: '⏱️ System Uptime', value: `\`${uptimeStr}\``, inline: true },
            { name: '💾 Memory Heap', value: `\`${heapUsedMB} MB\``, inline: true },
            { name: '⚙️ Environment', value: `Node.js \`${process.version}\` | Discord.js \`v${require('discord.js').version}\``, inline: true }
        ]);
    },
};

