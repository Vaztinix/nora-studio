const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const StatusFlag = require('../../database/models/StatusFlag');

module.exports = {
    category: 'utility',
    noAutoDefer: true,
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('View Nora\'s official core status report card.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        await interaction.deferReply().catch(() => {});
        const wsPing = interaction.client.ws.ping;
        const ping = (wsPing > 0) ? wsPing : 25;

        const totalServers = interaction.client.guilds.cache.size;
        const shardCount = interaction.client.shard ? interaction.client.shard.count : 1;
        const totalMembers = interaction.client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);

        const memUsage = process.memoryUsage();
        const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);

        // Dynamic status check from active flags and gateway latency
        let activeFlags = [];
        try {
            activeFlags = await StatusFlag.findAll({
                where: { isResolved: false }
            }).catch(() => []);
        } catch (e) {}

        let statusText = 'Online';
        let statusLabel = 'ONLINE';
        let statusColor = '#10b981';
        let statusFill = 'rgba(16, 185, 129, 0.15)';
        let statusStroke = '#10b981';
        let statusEmoji = '🟢';

        if (activeFlags.some(f => f.severity === 'outage')) {
            statusText = 'Partial Outage';
            statusLabel = 'PARTIAL OUTAGE';
            statusColor = '#ef4444';
            statusFill = 'rgba(239, 68, 68, 0.18)';
            statusStroke = '#ef4444';
            statusEmoji = '🔴';
        } else if (activeFlags.some(f => f.severity === 'degraded') || ping > 250) {
            statusText = 'Degraded Performance';
            statusLabel = 'DEGRADED PERFORMANCE';
            statusColor = '#f59e0b';
            statusFill = 'rgba(245, 158, 11, 0.18)';
            statusStroke = '#f59e0b';
            statusEmoji = '🟡';
        } else if (activeFlags.some(f => f.severity === 'maintenance')) {
            statusText = 'Scheduled Maintenance';
            statusLabel = 'MAINTENANCE';
            statusColor = '#8b5cf6';
            statusFill = 'rgba(139, 92, 246, 0.18)';
            statusStroke = '#8b5cf6';
            statusEmoji = '🔧';
        }

        // process.uptime() is always accurate from Node process start
        const uptimeSecs = Math.floor(process.uptime());
        const uptimeHours = Math.floor(uptimeSecs / 3600);
        const uptimeMins = Math.floor((uptimeSecs % 3600) / 60);
        const uptimeStr = uptimeHours > 0 ? `${uptimeHours}h ${uptimeMins}m` : `${uptimeMins}m`;

        const linkRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Nora Studio Website')
                .setURL('https://vaztinix.dev')
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel('Add to Server')
                .setURL(`https://discord.com/oauth2/authorize?client_id=${interaction.client.user.id}&permissions=1102464543799&integration_type=0&scope=bot+applications.commands`)
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

        // Status pill width calculation
        const pillWidth = Math.max(130, statusLabel.length * 10 + 44);
        const pillX = 840 - pillWidth - 40;

        const svgCard = `
        <svg width="880" height="460" viewBox="0 0 880 460" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="obsidianBg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#090a0f" />
                    <stop offset="50%" stop-color="#11131f" />
                    <stop offset="100%" stop-color="#07080d" />
                </linearGradient>

                <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#6366f1" />
                    <stop offset="50%" stop-color="#8b5cf6" />
                    <stop offset="100%" stop-color="#38bdf8" />
                </linearGradient>

                <linearGradient id="cardGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="rgba(99, 102, 241, 0.15)" />
                    <stop offset="100%" stop-color="rgba(56, 189, 248, 0.05)" />
                </linearGradient>

                <radialGradient id="ambientGlow1" cx="15%" cy="15%" r="65%">
                    <stop offset="0%" stop-color="rgba(99, 102, 241, 0.22)" />
                    <stop offset="100%" stop-color="transparent" />
                </radialGradient>

                <radialGradient id="ambientGlow2" cx="85%" cy="85%" r="65%">
                    <stop offset="0%" stop-color="rgba(56, 189, 248, 0.14)" />
                    <stop offset="100%" stop-color="transparent" />
                </radialGradient>
            </defs>

            <!-- Outer Canvas -->
            <rect width="880" height="460" rx="28" fill="url(#obsidianBg)"/>
            <rect width="880" height="460" rx="28" fill="url(#ambientGlow1)"/>
            <rect width="880" height="460" rx="28" fill="url(#ambientGlow2)"/>

            <!-- Subtle Grid Mesh -->
            <path d="M 0 80 L 880 80 M 0 160 L 880 160 M 0 240 L 880 240 M 0 320 L 880 320 M 0 400 L 880 400" stroke="rgba(255,255,255,0.02)" stroke-width="1"/>
            <path d="M 176 0 L 176 460 M 352 0 L 352 460 M 528 0 L 528 460 M 704 0 L 704 460" stroke="rgba(255,255,255,0.02)" stroke-width="1"/>

            <!-- Outer Glass Border -->
            <rect x="1.5" y="1.5" width="877" height="457" rx="26.5" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>

            <!-- Brand Header -->
            <rect x="40" y="38" width="6" height="48" rx="3" fill="url(#brandGrad)" />
            <text x="58" y="66" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="28" font-weight="900" fill="#ffffff" letter-spacing="-0.5">Nora Core Status</text>
            <text x="58" y="90" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="#94a3b8" letter-spacing="1">REAL-TIME SYSTEM DIAGNOSTICS &amp; TELEMETRY</text>

            <!-- Dynamic Live Status Badge -->
            <rect x="${pillX}" y="42" width="${pillWidth}" height="38" rx="19" fill="${statusFill}" stroke="${statusStroke}" stroke-width="1.5" />
            <circle cx="${pillX + 20}" cy="61" r="5.5" fill="${statusColor}" />
            <text x="${pillX + 34}" y="66" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="800" fill="${statusColor}" letter-spacing="0.5">${statusLabel}</text>

            <!-- Top Metric Tiles -->
            <!-- Tile 1: Latency & Shards -->
            <g transform="translate(40, 126)">
                <rect width="254" height="130" rx="18" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
                <rect x="20" y="20" width="32" height="32" rx="10" fill="rgba(99,102,241,0.15)" stroke="rgba(99,102,241,0.3)" stroke-width="1"/>
                <text x="36" y="41" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="900" fill="#818cf8" text-anchor="middle">⚡</text>
                
                <text x="62" y="40" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="800" fill="#818cf8" letter-spacing="1">LATENCY &amp; SHARDS</text>
                <text x="20" y="88" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="30" font-weight="900" fill="#ffffff">${ping}<tspan font-size="18" font-weight="700" fill="#94a3b8">ms</tspan></text>
                <text x="20" y="112" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="600" fill="#94a3b8">Active Shards: <tspan fill="#e2e8f0" font-weight="700">${shardCount}</tspan></text>
            </g>

            <!-- Tile 2: Total Servers & Reach -->
            <g transform="translate(313, 126)">
                <rect width="254" height="130" rx="18" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
                <rect x="20" y="20" width="32" height="32" rx="10" fill="rgba(56,189,248,0.15)" stroke="rgba(56,189,248,0.3)" stroke-width="1"/>
                <text x="36" y="41" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="900" fill="#38bdf8" text-anchor="middle">🌐</text>
                
                <text x="62" y="40" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="800" fill="#38bdf8" letter-spacing="1">SERVER NETWORK</text>
                <text x="20" y="88" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="30" font-weight="900" fill="#ffffff">${totalServers}</text>
                <text x="20" y="112" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="600" fill="#94a3b8">Members: <tspan fill="#e2e8f0" font-weight="700">${totalMembers.toLocaleString()}</tspan></text>
            </g>

            <!-- Tile 3: System Uptime -->
            <g transform="translate(586, 126)">
                <rect width="254" height="130" rx="18" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
                <rect x="20" y="20" width="32" height="32" rx="10" fill="rgba(168,85,247,0.15)" stroke="rgba(168,85,247,0.3)" stroke-width="1"/>
                <text x="36" y="41" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="900" fill="#c084fc" text-anchor="middle">⏱️</text>

                <text x="62" y="40" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="11" font-weight="800" fill="#c084fc" letter-spacing="1">SYSTEM UPTIME</text>
                <text x="20" y="88" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="30" font-weight="900" fill="#ffffff">${uptimeStr}</text>
                <text x="20" y="112" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="600" fill="#94a3b8">Status: <tspan fill="${statusColor}" font-weight="700">${statusText}</tspan></text>
            </g>

            <!-- Bottom Wide Platform Diagnostics Bar -->
            <g transform="translate(40, 276)">
                <rect width="800" height="142" rx="20" fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                
                <!-- Left: Memory & Heap -->
                <text x="30" y="42" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="800" fill="#818cf8" letter-spacing="1">RESOURCE ALLOCATION</text>
                <text x="30" y="80" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="26" font-weight="900" fill="#ffffff">${heapUsedMB} <tspan font-size="16" font-weight="700" fill="#94a3b8">MB</tspan></text>
                <text x="30" y="106" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="600" fill="#64748b">Heap RAM Active Usage</text>

                <!-- Center Divider -->
                <line x1="400" y1="20" x2="400" y2="122" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>

                <!-- Right: Node & Discord Environment -->
                <text x="430" y="42" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="800" fill="#38bdf8" letter-spacing="1">PLATFORM ENVIRONMENT</text>
                <text x="430" y="80" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="24" font-weight="900" fill="#ffffff">Node.js ${process.version}</text>
                <text x="430" y="106" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="600" fill="#64748b">Discord.js v${require('discord.js').version} • vaztinix.dev</text>
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
                    name: 'Nora Core System Status • Real-Time Diagnostics', 
                    iconURL: interaction.client.user.displayAvatarURL() 
                })
                .setTitle(`${statusEmoji} SYSTEM STATUS: ${statusLabel}`)
                .setColor(statusKeyColor(statusColor, premium))
                .setDescription(
                    `Nora Mainframe is fully synchronized and ${statusText.toLowerCase()}.\n` +
                    `**Tier Status**: \`${benefits.tierName}\` (${benefits.tierPrice})\n` +
                    (premium 
                        ? `✨ **Active Studio Plus Perks**: 200 Autoresponder Slots • 10x Leveling Multipliers • 50% Cooldown Reduction • Pro Threat Shield • Custom Animated Rank Cards`
                        : `⭐ **Upgrade to Studio Plus ($1.99/mo)** to unlock **200 Autoresponders**, **10x XP Multipliers**, and **50% faster cooldowns** in the Discord App Store!`)
                )
                .addFields(
                    { name: '⚡ Latency & Shards', value: `\`${ping}ms\` • **Shard 0** / ${shardCount}`, inline: true },
                    { name: '🌐 Server Reach', value: `\`${totalServers}\` Servers • \`${totalMembers.toLocaleString()}\` Members`, inline: true },
                    { name: '⏱️ System Uptime', value: `\`${uptimeStr}\` (${statusText})`, inline: true },
                    { name: '💾 Memory Allocation', value: `\`${heapUsedMB} MB\` Heap RAM`, inline: true },
                    { name: '⚙️ Platform Runtime', value: `Node.js \`${process.version}\` • Discord.js \`v${require('discord.js').version}\``, inline: true },
                    { name: '🤖 Verified Studio', value: `\`Nora Studio • vaztinix.dev\``, inline: true }
                )
                .setFooter({ text: 'Nora Assistant • Privacy-First Discord Automation', iconURL: interaction.client.user.displayAvatarURL() })
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
    if (hex === '#ef4444') return 0xEF4444;
    if (hex === '#f59e0b') return 0xF59E0B;
    if (hex === '#8b5cf6') return 0x8B5CF6;
    return 0x10B981;
}


