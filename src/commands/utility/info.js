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

        let statusText = 'Operational';
        let statusColor = '#10b981';
        let statusFill = 'rgba(16, 185, 129, 0.10)';
        let statusBorder = 'rgba(16, 185, 129, 0.25)';
        let statusEmoji = '🟢';

        if (activeFlags.some(f => f.severity === 'outage')) {
            statusText = 'Partial Outage';
            statusColor = '#ef4444';
            statusFill = 'rgba(239, 68, 68, 0.10)';
            statusBorder = 'rgba(239, 68, 68, 0.25)';
            statusEmoji = '🔴';
        } else if (activeFlags.some(f => f.severity === 'degraded') || ping > 250) {
            statusText = 'Degraded';
            statusColor = '#f59e0b';
            statusFill = 'rgba(245, 158, 11, 0.10)';
            statusBorder = 'rgba(245, 158, 11, 0.25)';
            statusEmoji = '🟡';
        } else if (activeFlags.some(f => f.severity === 'maintenance')) {
            statusText = 'Maintenance';
            statusColor = '#8b5cf6';
            statusFill = 'rgba(139, 92, 246, 0.10)';
            statusBorder = 'rgba(139, 92, 246, 0.25)';
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
        const pillWidth = Math.max(120, statusText.length * 8 + 38);
        const pillX = 880 - 36 - pillWidth;

        const svgCard = `
        <svg width="880" height="420" viewBox="0 0 880 420" xmlns="http://www.w3.org/2000/svg" text-rendering="geometricPrecision" shape-rendering="geometricPrecision">
            <defs>
                <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#0b0e17" />
                    <stop offset="50%" stop-color="#0f1322" />
                    <stop offset="100%" stop-color="#090c15" />
                </linearGradient>

                <linearGradient id="tileGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="rgba(255,255,255,0.03)" />
                    <stop offset="100%" stop-color="rgba(255,255,255,0.01)" />
                </linearGradient>
            </defs>

            <!-- Main Card Canvas -->
            <rect width="880" height="420" rx="20" fill="url(#bgGrad)"/>
            <rect x="1" y="1" width="878" height="418" rx="19" fill="none" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1.2"/>

            <!-- Header: Clean Title (No bar, No generic subtitle) -->
            <text x="36" y="58" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="24" font-weight="800" fill="#f8fafc" letter-spacing="-0.3">Nora Status</text>

            <!-- Status Pill: Minimalist & Clean -->
            <g transform="translate(${pillX}, 34)">
                <rect width="${pillWidth}" height="34" rx="8" fill="${statusFill}" stroke="${statusBorder}" stroke-width="1"/>
                <circle cx="18" cy="17" r="4" fill="${statusColor}"/>
                <text x="30" y="22" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="${statusColor}">${statusText}</text>
            </g>

            <!-- Top Metric Tiles -->
            <!-- Tile 1: Ping & Shards -->
            <g transform="translate(36, 96)">
                <rect width="254" height="136" rx="14" fill="url(#tileGrad)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                <text x="24" y="38" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="#94a3b8" letter-spacing="0.5">PING</text>
                <text x="24" y="86" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="32" font-weight="800" fill="#ffffff">${ping}<tspan font-size="18" font-weight="600" fill="#64748b"> ms</tspan></text>
                <text x="24" y="114" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="500" fill="#64748b">Shard <tspan fill="#94a3b8" font-weight="600">0 / ${shardCount}</tspan></text>
            </g>

            <!-- Tile 2: Servers & Members -->
            <g transform="translate(313, 96)">
                <rect width="254" height="136" rx="14" fill="url(#tileGrad)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                <text x="24" y="38" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="#94a3b8" letter-spacing="0.5">SERVERS</text>
                <text x="24" y="86" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="32" font-weight="800" fill="#ffffff">${totalServers}</text>
                <text x="24" y="114" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="500" fill="#64748b"><tspan fill="#94a3b8" font-weight="600">${totalMembers.toLocaleString()}</tspan> members</text>
            </g>

            <!-- Tile 3: Uptime -->
            <g transform="translate(590, 96)">
                <rect width="254" height="136" rx="14" fill="url(#tileGrad)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                <text x="24" y="38" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="#94a3b8" letter-spacing="0.5">UPTIME</text>
                <text x="24" y="86" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="32" font-weight="800" fill="#ffffff">${uptimeStr}</text>
                <text x="24" y="114" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="500" fill="#64748b">Health: <tspan fill="${statusColor}" font-weight="600">${statusText}</tspan></text>
            </g>

            <!-- Bottom Platform Bar -->
            <g transform="translate(36, 252)">
                <rect width="808" height="132" rx="14" fill="url(#tileGrad)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                
                <!-- Left: Memory -->
                <text x="28" y="38" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="#94a3b8" letter-spacing="0.5">MEMORY USAGE</text>
                <text x="28" y="80" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="28" font-weight="800" fill="#ffffff">${heapUsedMB} <tspan font-size="16" font-weight="600" fill="#64748b">MB</tspan></text>
                <text x="28" y="108" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="500" fill="#64748b">Active Node.js heap memory</text>

                <!-- Divider -->
                <line x1="404" y1="20" x2="404" y2="112" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>

                <!-- Right: System Info -->
                <text x="432" y="38" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="#94a3b8" letter-spacing="0.5">SYSTEM INFO</text>
                <text x="432" y="80" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="22" font-weight="800" fill="#ffffff">Node.js ${process.version}</text>
                <text x="432" y="108" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="12" font-weight="500" fill="#64748b">Discord.js v${require('discord.js').version} • vaztinix.dev</text>
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


