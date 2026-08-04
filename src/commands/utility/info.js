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
        await interaction.deferReply({ ephemeral: false });

        const ping = interaction.client.ws.ping;
        const totalServers = interaction.client.guilds.cache.size;
        const shardCount = interaction.client.shard ? interaction.client.shard.count : 1;
        const totalMembers = interaction.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);

        const memUsage = process.memoryUsage();
        const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);

        const uptimeHours = Math.floor(interaction.client.uptime / (1000 * 60 * 60));
        const uptimeMins = Math.floor((interaction.client.uptime % (1000 * 60 * 60)) / (1000 * 60));
        const uptimeStr = `${uptimeHours}h ${uptimeMins}m`;

        const svgCard = `
        <svg width="800" height="420" viewBox="0 0 800 420" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#0f172a" />
                    <stop offset="50%" stop-color="#1e1b4b" />
                    <stop offset="100%" stop-color="#020617" />
                </linearGradient>
                <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#6366f1" />
                    <stop offset="100%" stop-color="#3b82f6" />
                </linearGradient>
                <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
                    <feDropShadow dx="0" dy="10" stdDeviation="15" flood-color="#000000" flood-opacity="0.5"/>
                </filter>
            </defs>

            <rect width="800" height="420" rx="24" fill="url(#bgGrad)"/>
            <rect x="2" y="2" width="796" height="416" rx="22" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2"/>

            <rect x="40" y="40" width="8" height="44" rx="4" fill="url(#cardGrad)" />
            <text x="64" y="70" font-family="sans-serif" font-size="30" font-weight="800" fill="#ffffff">Nora Core Status</text>
            <text x="64" y="94" font-family="sans-serif" font-size="14" font-weight="600" fill="#94a3b8">REAL-TIME SYSTEM DIAGNOSTICS &amp; METRICS</text>

            <rect x="620" y="45" width="140" height="36" rx="18" fill="rgba(34, 197, 94, 0.15)" stroke="#22c55e" stroke-width="1.5" />
            <circle cx="642" cy="63" r="6" fill="#22c55e" />
            <text x="658" y="68" font-family="sans-serif" font-size="14" font-weight="700" fill="#4ade80">NOMINAL</text>

            <g transform="translate(40, 130)">
                <rect width="226" height="110" rx="16" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                <text x="20" y="36" font-family="sans-serif" font-size="13" font-weight="700" fill="#818cf8">LATENCY &amp; SHARDS</text>
                <text x="20" y="72" font-family="sans-serif" font-size="28" font-weight="800" fill="#ffffff">${ping}ms</text>
                <text x="20" y="92" font-family="sans-serif" font-size="12" font-weight="600" fill="#94a3b8">Active Shards: ${shardCount}</text>
            </g>

            <g transform="translate(286, 130)">
                <rect width="226" height="110" rx="16" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                <text x="20" y="36" font-family="sans-serif" font-size="13" font-weight="700" fill="#38bdf8">TOTAL SERVERS</text>
                <text x="20" y="72" font-family="sans-serif" font-size="28" font-weight="800" fill="#ffffff">${totalServers}</text>
                <text x="20" y="92" font-family="sans-serif" font-size="12" font-weight="600" fill="#94a3b8">Members: ${totalMembers.toLocaleString()}</text>
            </g>

            <g transform="translate(534, 130)">
                <rect width="226" height="110" rx="16" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                <text x="20" y="36" font-family="sans-serif" font-size="13" font-weight="700" fill="#a78bfa">SYSTEM UPTIME</text>
                <text x="20" y="72" font-family="sans-serif" font-size="28" font-weight="800" fill="#ffffff">${uptimeStr}</text>
                <text x="20" y="92" font-family="sans-serif" font-size="12" font-weight="600" fill="#94a3b8">Online &amp; Operational</text>
            </g>

            <g transform="translate(40, 260)">
                <rect width="720" height="120" rx="16" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
                
                <text x="24" y="40" font-family="sans-serif" font-size="14" font-weight="700" fill="#e2e8f0">RESOURCE ALLOCATION</text>
                <text x="24" y="74" font-family="sans-serif" font-size="22" font-weight="800" fill="#818cf8">${heapUsedMB} MB</text>
                <text x="24" y="96" font-family="sans-serif" font-size="12" font-weight="600" fill="#64748b">RAM / Memory Heap</text>

                <line x1="360" y1="20" x2="360" y2="100" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>

                <text x="390" y="40" font-family="sans-serif" font-size="14" font-weight="700" fill="#e2e8f0">PLATFORM ENVIRONMENT</text>
                <text x="390" y="74" font-family="sans-serif" font-size="22" font-weight="800" fill="#38bdf8">Node.js ${process.version}</text>
                <text x="390" y="96" font-family="sans-serif" font-size="12" font-weight="600" fill="#64748b">Discord.js v${require('discord.js').version}</text>
            </g>
        </svg>
        `;

        try {
            const imageBuffer = await Promise.race([
                sharp(Buffer.from(svgCard)).png().toBuffer(),
                new Promise((_, r) => setTimeout(() => r(new Error('Image render timed out')), 5000))
            ]);
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'nora-status-report.png' });
            await interaction.editReply({ files: [attachment] });
        } catch (err) {
            console.warn('[Info Command] Image rendering failed, sending fallback embed:', err.message);
            const { EmbedBuilder } = require('discord.js');
            const fallbackEmbed = new EmbedBuilder()
                .setTitle('⚡ Nora Core Status')
                .setDescription('REAL-TIME SYSTEM DIAGNOSTICS & METRICS')
                .setColor(0x57acf2)
                .addFields(
                    { name: '⚡ Latency', value: `\`${ping}ms\``, inline: true },
                    { name: '🌐 Total Servers', value: `\`${totalServers}\``, inline: true },
                    { name: '👥 Total Members', value: `\`${totalMembers.toLocaleString()}\``, inline: true },
                    { name: '⏱️ System Uptime', value: `\`${uptimeStr}\``, inline: true },
                    { name: '💾 Memory Heap', value: `\`${heapUsedMB} MB\``, inline: true },
                    { name: '⚙️ Environment', value: `Node.js \`${process.version}\` | Discord.js \`v${require('discord.js').version}\``, inline: true }
                );
            await interaction.editReply({ embeds: [fallbackEmbed] }).catch(() => {});
        }
    },
};

