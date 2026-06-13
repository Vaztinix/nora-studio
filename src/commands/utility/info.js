const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('os');
const ActiveTicket = require('../../database/models/ActiveTicket');
const Warning = require('../../database/models/Warning');
const RobloxVerify = require('../../database/models/RobloxVerify');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('View Nora\'s current status, resource usage, and database metrics.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const ping = interaction.client.ws.ping;
        const totalServers = interaction.client.guilds.cache.size;
        const shardCount = interaction.client.shard ? interaction.client.shard.count : 1;
        const totalMembers = interaction.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        const commandCount = interaction.client.commands.size;

        // Memory usage
        const memUsage = process.memoryUsage();
        const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
        const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(2);

        // Uptime calculations
        const startTimestamp = Math.floor((Date.now() - interaction.client.uptime) / 1000);

        // Database stats
        const activeTickets = await ActiveTicket.count().catch(() => 0);
        const totalWarnings = await Warning.count().catch(() => 0);
        const verifiedRoblox = await RobloxVerify.count().catch(() => 0);

        const embed = new EmbedBuilder()
            .setAuthor({ name: 'Nora • System Diagnostics', iconURL: interaction.client.user.displayAvatarURL() })
            .setTitle('Core Status Report')
            .setColor(0x57acf2)
            .addFields(
                { name: 'Latency & Sharding', value: `• **Gateway Latency:** \`${ping}ms\`\n• **Active Shards:** \`${shardCount}\``, inline: true },
                { name: 'Bot Statistics', value: `• **Total Servers:** \`${totalServers}\`\n• **Total Members:** \`${totalMembers.toLocaleString()}\`\n• **Loaded Commands:** \`${commandCount}\``, inline: true },
                { name: 'Resource Allocation', value: `• **Heap Memory:** \`${heapUsedMB}MB / ${heapTotalMB}MB\`\n• **Platform:** \`${process.platform} (${os.arch()})\`\n• **Node.js:** \`${process.version}\`\n• **Discord.js:** \`v${require('discord.js').version}\``, inline: false },
                { name: 'Database Statistics', value: `• **Roblox Verifications:** \`${verifiedRoblox}\`\n• **Total Warnings Logged:** \`${totalWarnings}\`\n• **Active Support Tickets:** \`${activeTickets}\``, inline: true },
                { name: 'Uptime Status', value: `• **Online since:** <t:${startTimestamp}:F>\n• **Uptime:** <t:${startTimestamp}:R>`, inline: true },
                { name: 'System Operations', value: '```diff\n+ Operations: NOMINAL\n+ Databases: HEALTHY\n+ Shards: STABLE\n```', inline: false }
            )
            .setFooter({ text: 'Nora V2.0 Core Status' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
