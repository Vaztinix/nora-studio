const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const StatusFlag = require('../../database/models/StatusFlag');

module.exports = {
    category: 'utility',
    noAutoDefer: true,
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('View Nora\'s real-time core system status and performance telemetry.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        await interaction.deferReply().catch(() => {});
        const wsPing = interaction.client.ws.ping;
        const ping = (wsPing > 0) ? Math.round(wsPing) : 25;

        const totalServers = interaction.client.guilds.cache.size;
        const shardCount = interaction.client.shard ? interaction.client.shard.count : 1;

        // Calculate total community member reach across all servers
        const totalMembers = interaction.client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0) || interaction.client.users.cache.size;

        const memUsage = process.memoryUsage();
        const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
        const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(1);
        const memPercent = Math.min(100, Math.max(5, Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)));
        const pingPercent = Math.min(100, Math.max(5, Math.round((ping / 250) * 100)));

        // Dynamic status check from active flags and gateway latency
        let activeFlags = [];
        try {
            activeFlags = await StatusFlag.findAll({
                where: { isResolved: false }
            }).catch(() => []);
        } catch (e) {}

        let statusText = 'Operational';
        let statusColor = '#10b981';
        let healthPercent = 100;

        if (activeFlags.some(f => f.severity === 'outage')) {
            statusText = 'Partial Outage';
            statusColor = '#ef4444';
            healthPercent = 65;
        } else if (activeFlags.some(f => f.severity === 'degraded') || ping > 250) {
            statusText = 'Degraded';
            statusColor = '#f59e0b';
            healthPercent = 85;
        } else if (activeFlags.some(f => f.severity === 'maintenance')) {
            statusText = 'Maintenance';
            statusColor = '#8b5cf6';
            healthPercent = 90;
        }

        const uptimeSecs = Math.floor(process.uptime());
        const uptimeDays = Math.floor(uptimeSecs / 86400);
        const uptimeHours = Math.floor((uptimeSecs % 86400) / 3600);
        const uptimeMins = Math.floor((uptimeSecs % 3600) / 60);
        let uptimeStr = '';
        if (uptimeDays > 0) uptimeStr = `${uptimeDays}d ${uptimeHours}h`;
        else if (uptimeHours > 0) uptimeStr = `${uptimeHours}h ${uptimeMins}m`;
        else uptimeStr = `${uptimeMins}m`;

        const linkRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Nora Website')
                .setURL('https://vaztinix.dev')
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel('Add to Server')
                .setURL(`https://discord.com/oauth2/authorize?client_id=${interaction.client.user?.id || '1375943730951098549'}&permissions=1102464543799&integration_type=0&scope=bot+applications.commands`)
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel('Support')
                .setURL('https://discord.gg/Uxb2tNAxtp')
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel('Discord Store')
                .setURL('https://discord.com/application-directory/1375943730951098549/store/1490857354609168534')
                .setStyle(ButtonStyle.Link)
        );

        // Circular Gauge geometry (radius 48, circumference ~301.59)
        const radius = 48;
        const circ = 2 * Math.PI * radius;
        const healthOffset = circ - (healthPercent / 100) * circ;

        const pingBarWidth = Math.round((pingPercent / 100) * 222);
        const memBarWidth = Math.round((memPercent / 100) * 226);

        const svgCard = `
        <svg width="920" height="460" viewBox="0 0 920 460" xmlns="http://www.w3.org/2000/svg" text-rendering="geometricPrecision" shape-rendering="geometricPrecision">
            <defs>
                <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#0a0d14" />
                    <stop offset="50%" stop-color="#0e121d" />
                    <stop offset="100%" stop-color="#080a10" />
                </linearGradient>

                <linearGradient id="panelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="rgba(255,255,255,0.035)" />
                    <stop offset="100%" stop-color="rgba(255,255,255,0.01)" />
                </linearGradient>

                <linearGradient id="memBarGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#10b981" />
                    <stop offset="100%" stop-color="#34d399" />
                </linearGradient>

                <linearGradient id="circleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${statusColor}" />
                    <stop offset="100%" stop-color="#38bdf8" />
                </linearGradient>
            </defs>

            <!-- Base Canvas -->
            <rect width="920" height="460" rx="20" fill="url(#cardBg)" />
            <rect x="1" y="1" width="918" height="458" rx="19" fill="none" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1.2" />

            <!-- Top Header -->
            <text x="36" y="54" font-family="Segoe UI, Inter, -apple-system, sans-serif" font-size="20" font-weight="700" fill="#f8fafc" letter-spacing="-0.2">Nora Status</text>
            <rect x="160" y="37" width="62" height="22" rx="6" fill="rgba(88, 101, 242, 0.12)" stroke="rgba(88, 101, 242, 0.3)" stroke-width="1" />
            <text x="191" y="52" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="600" fill="#818cf8" text-anchor="middle">v1.0.0</text>

            <!-- Left Column: Circular System Status Gauge -->
            <g transform="translate(36, 84)">
                <rect width="264" height="340" rx="14" fill="url(#panelGrad)" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
                
                <text x="24" y="36" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="700" fill="#94a3b8" letter-spacing="0.6">SYSTEM STATUS</text>
                
                <!-- Radial Circular Progress Gauge -->
                <g transform="translate(132, 136)">
                    <!-- Background track circle -->
                    <circle cx="0" cy="0" r="${radius}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10" />
                    <!-- Progress Arc -->
                    <circle cx="0" cy="0" r="${radius}" fill="none" stroke="url(#circleGrad)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${healthOffset}" transform="rotate(-90)" />
                    
                    <!-- Center Health Metric -->
                    <text x="0" y="8" font-family="Segoe UI, Inter, sans-serif" font-size="26" font-weight="800" fill="#ffffff" text-anchor="middle">${healthPercent}%</text>
                </g>

                <text x="132" y="224" font-family="Segoe UI, Inter, sans-serif" font-size="14" font-weight="700" fill="#f8fafc" text-anchor="middle">${statusText === 'Operational' ? 'All Systems Normal' : statusText}</text>
                <text x="132" y="246" font-family="Segoe UI, Inter, sans-serif" font-size="12" font-weight="500" fill="#64748b" text-anchor="middle">Uptime: ${uptimeStr}</text>

                <!-- System specs list -->
                <line x1="24" y1="270" x2="240" y2="270" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
                
                <text x="24" y="296" font-family="Segoe UI, Inter, sans-serif" font-size="12" font-weight="500" fill="#64748b">Runtime Engine</text>
                <text x="240" y="296" font-family="Segoe UI, Inter, sans-serif" font-size="12" font-weight="600" fill="#94a3b8" text-anchor="end">Node.js ${process.version}</text>

                <text x="24" y="320" font-family="Segoe UI, Inter, sans-serif" font-size="12" font-weight="500" fill="#64748b">Environment</text>
                <text x="240" y="320" font-family="Segoe UI, Inter, sans-serif" font-size="12" font-weight="600" fill="#10b981" text-anchor="end">Production</text>
            </g>

            <!-- Right Top Tile 1: Latency & Gateway (with Bar Graph) -->
            <g transform="translate(320, 84)">
                <rect width="270" height="160" rx="14" fill="url(#panelGrad)" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
                <text x="24" y="32" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="700" fill="#94a3b8" letter-spacing="0.6">LATENCY</text>
                <text x="24" y="72" font-family="Segoe UI, Inter, sans-serif" font-size="28" font-weight="800" fill="#ffffff">${ping}<tspan font-size="16" font-weight="600" fill="#64748b"> ms</tspan></text>
                <text x="246" y="70" font-family="Segoe UI, Inter, sans-serif" font-size="12" font-weight="600" fill="#5865f2" text-anchor="end">Shard 0 / ${shardCount}</text>
                
                <!-- Latency Bar Track (Solid Blue) -->
                <rect x="24" y="94" width="222" height="8" rx="4" fill="rgba(255,255,255,0.06)" />
                <rect x="24" y="94" width="${pingBarWidth}" height="8" rx="4" fill="#5865f2" />
                
                <text x="24" y="128" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="500" fill="#64748b">Gateway roundtrip response</text>
            </g>

            <!-- Right Top Tile 2: Memory (with Bar Graph) -->
            <g transform="translate(610, 84)">
                <rect width="274" height="160" rx="14" fill="url(#panelGrad)" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
                <text x="24" y="32" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="700" fill="#94a3b8" letter-spacing="0.6">MEMORY</text>
                <text x="24" y="72" font-family="Segoe UI, Inter, sans-serif" font-size="28" font-weight="800" fill="#ffffff">${heapUsedMB}<tspan font-size="16" font-weight="600" fill="#64748b"> MB</tspan></text>
                <text x="250" y="70" font-family="Segoe UI, Inter, sans-serif" font-size="12" font-weight="600" fill="#34d399" text-anchor="end">${memPercent}% used</text>
                
                <!-- Memory Bar Track -->
                <rect x="24" y="94" width="226" height="8" rx="4" fill="rgba(255,255,255,0.06)" />
                <rect x="24" y="94" width="${memBarWidth}" height="8" rx="4" fill="url(#memBarGrad)" />
                
                <text x="24" y="128" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="500" fill="#64748b">Heap limit: ${heapTotalMB} MB</text>
            </g>

            <!-- Right Bottom Tile: Server Reach & Deployment Matrix -->
            <g transform="translate(320, 264)">
                <rect width="564" height="160" rx="14" fill="url(#panelGrad)" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
                
                <!-- Left sub-panel: Servers -->
                <text x="28" y="32" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="700" fill="#94a3b8" letter-spacing="0.6">SERVERS</text>
                <text x="28" y="74" font-family="Segoe UI, Inter, sans-serif" font-size="32" font-weight="800" fill="#ffffff">${totalServers}</text>
                <text x="28" y="102" font-family="Segoe UI, Inter, sans-serif" font-size="12" font-weight="500" fill="#64748b">Active server communities</text>
                <text x="28" y="132" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="600" fill="#5865f2">Discord.js v${require('discord.js').version}</text>

                <!-- Vertical divider line -->
                <line x1="270" y1="20" x2="270" y2="140" stroke="rgba(255,255,255,0.06)" stroke-width="1" />

                <!-- Right sub-panel: Members -->
                <text x="300" y="32" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="700" fill="#94a3b8" letter-spacing="0.6">MEMBERS</text>
                <text x="300" y="74" font-family="Segoe UI, Inter, sans-serif" font-size="32" font-weight="800" fill="#ffffff">${totalMembers.toLocaleString()}</text>
                <text x="300" y="102" font-family="Segoe UI, Inter, sans-serif" font-size="12" font-weight="500" fill="#64748b">Total community members</text>
                <text x="300" y="132" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="600" fill="#10b981">vaztinix.dev</text>
            </g>
        </svg>
        `;

        try {
            const basePng = await sharp(Buffer.from(svgCard)).png().toBuffer();
            const attachment = new AttachmentBuilder(basePng, { name: 'nora-status-report.png' });

            return await interaction.editReply({
                files: [attachment],
                components: [linkRow]
            });
        } catch (err) {
            console.warn('[Info Command] Image generation error, fallback embed used:', err.message);
            const { isPremium, getBenefits } = require('../../utils/premiumManager');
            const premium = isPremium(interaction);
            const benefits = getBenefits(premium);

            const statusEmbed = new EmbedBuilder()
                .setAuthor({ 
                    name: 'Nora Core System Status', 
                    iconURL: interaction.client.user.displayAvatarURL() 
                })
                .setTitle(`System Status: ${statusText.toUpperCase()}`)
                .setColor(statusKeyColor(statusColor, premium))
                .setDescription(
                    `Nora Core is synchronized and ${statusText.toLowerCase()}.\n` +
                    `Tier: \`${benefits.tierName}\` (${benefits.tierPrice})`
                )
                .addFields(
                    { name: 'Gateway Latency', value: `\`${ping}ms\` (Shard 0 / ${shardCount})`, inline: true },
                    { name: 'Server Reach', value: `\`${totalServers}\` Servers • \`${totalMembers.toLocaleString()}\` Unique Members`, inline: true },
                    { name: 'Uptime', value: `\`${uptimeStr}\` (${statusText})`, inline: true },
                    { name: 'Memory', value: `\`${heapUsedMB} MB\` / \`${heapTotalMB} MB\` (${memPercent}%)`, inline: true },
                    { name: 'Runtime', value: `Node.js \`${process.version}\` • Discord.js \`v${require('discord.js').version}\``, inline: true },
                    { name: 'Infrastructure', value: 'Nora Studio • vaztinix.dev', inline: true }
                )
                .setFooter({ text: 'Nora Assistant • Status & Diagnostics' })
                .setTimestamp();

            return await interaction.editReply({
                embeds: [statusEmbed],
                components: [linkRow]
            });
        }
    },
};

function statusKeyColor(hex, premium) {
    if (premium && hex === '#10b981') return 0xFFD700;
    if (hex === '#ef4444') return 0xED4245;
    if (hex === '#f59e0b') return 0xFEE75C;
    if (hex === '#8b5cf6') return 0x5865F2;
    return 0x57F287;
}
