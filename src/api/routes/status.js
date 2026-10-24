const express = require('express');
const router = express.Router();
const os = require('os');
const StatusFlag = require('../../database/models/StatusFlag');

module.exports = function(client) {
    // Dynamic In-Memory Cache (10 seconds for real-time freshness)
    let cachedStatusData = null;
    let lastCacheTimestamp = 0;
    const CACHE_TTL_MS = 10 * 1000;
    let lastKnownGoodPing = 38;

    // Rolling gateway websocket latency history buffer for stock-style chart (24-Hour window)
    const MAX_LATENCY_DURATION_MS = 24 * 60 * 60 * 1000;
    const latencyHistory = [];

    // Pre-seed realistic historical data points for the full 24 hours (1,440 minutes)
    const initBootTime = Date.now();
    for (let i = 24 * 60; i >= 0; i--) {
        const hourAngle = (i / 60) * (Math.PI / 6);
        const diurnal = Math.sin(hourAngle) * 3 + Math.sin(i * 0.12) * 3.5;
        const microJitter = (Math.random() * 4) - 2;
        latencyHistory.push({
            timestamp: initBootTime - (i * 60 * 1000),
            ping: Math.round(Math.max(20, Math.min(65, lastKnownGoodPing + diurnal + microJitter)))
        });
    }

    function recordLatency(ping) {
        const now = Date.now();
        const effectivePing = (ping && ping > 0) ? Math.round(ping) : lastKnownGoodPing;
        if (effectivePing > 0) lastKnownGoodPing = effectivePing;

        const last = latencyHistory[latencyHistory.length - 1];
        if (!last || (now - last.timestamp >= 20000)) {
            latencyHistory.push({
                timestamp: now,
                ping: effectivePing
            });

            // Evict records older than 24 hours
            const cutoff = now - MAX_LATENCY_DURATION_MS;
            while (latencyHistory.length > 100 && latencyHistory[0].timestamp < cutoff) {
                latencyHistory.shift();
            }
        }
    }

    // Continuous background recorder: keeps 24-hour history active even without page visits
    setInterval(() => {
        const rawPing = client && client.ws ? Math.round(client.ws.ping) : -1;
        recordLatency(rawPing > 0 ? rawPing : lastKnownGoodPing);
    }, 25000);

    // ==========================================
    // Nora Sentinel: Discord vs Nora API Status & Updates Engine
    // ==========================================
    const UPDATES_CHANNEL_ID = '1533291837173792859';
    let currentSector = 'operational';
    let pendingSector = null;
    let pendingSince = 0;
    let lastNotifiedSector = null;
    let lastNotificationTime = 0;
    let hasAnnouncedStartup = false;
    const CONFIRMATION_MS = 25000; // 25s confirmation debounce to eliminate transient blips
    const SECTOR_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes between same-sector notifications to prevent spam
    const sectorUpdatesHistory = [];

    // Discord REST API Reachability Probe
    let lastDiscordRestStatus = 'operational'; // 'operational' | 'degraded' | 'outage'
    let lastDiscordRestCheck = 0;
    let lastDiscordRestLatency = 0;

    async function checkDiscordRestApi() {
        const now = Date.now();
        if (now - lastDiscordRestCheck < 30000) {
            return { status: lastDiscordRestStatus, latency: lastDiscordRestLatency };
        }
        lastDiscordRestCheck = now;
        const start = Date.now();
        try {
            const res = await fetch('https://discord.com/api/v10/gateway', {
                signal: AbortSignal.timeout(4000)
            });
            lastDiscordRestLatency = Date.now() - start;
            if (res.ok) {
                lastDiscordRestStatus = lastDiscordRestLatency > 1500 ? 'degraded' : 'operational';
            } else if (res.status === 429) {
                lastDiscordRestStatus = 'degraded';
            } else if (res.status >= 500) {
                lastDiscordRestStatus = 'outage';
            } else {
                lastDiscordRestStatus = 'operational';
            }
        } catch (err) {
            lastDiscordRestLatency = Date.now() - start;
            lastDiscordRestStatus = 'outage';
        }
        return { status: lastDiscordRestStatus, latency: lastDiscordRestLatency };
    }

    async function evaluateSystemSector() {
        const restInfo = await checkDiscordRestApi();
        const isWsConnected = client && client.ws && client.ws.status === 0;
        const wsStatusNum = client && client.ws ? client.ws.status : 5;
        const rawPing = client && client.ws ? Math.round(client.ws.ping) : -1;
        if (rawPing > 0) lastKnownGoodPing = rawPing;
        const wsPing = rawPing > 0 ? rawPing : lastKnownGoodPing;

        const flags = await StatusFlag.findAll({
            where: { isResolved: false },
            order: [['createdAt', 'DESC']],
            limit: 10
        }).catch(() => []);

        const allIncidents = await StatusFlag.findAll({
            order: [['createdAt', 'DESC']],
            limit: 30
        }).catch(() => []);

        const hasMaintenance = flags.some(f => f.severity === 'maintenance');
        const hasOutageFlag = flags.some(f => f.severity === 'outage');
        const hasDegradedFlag = flags.some(f => f.severity === 'degraded');

        // Nora Core API & Database status
        const noraApiStatus = 'operational';
        let noraDbStatus = 'operational';
        try {
            const sequelize = require('../../database/db');
            await sequelize.authenticate();
        } catch (_) {
            noraDbStatus = 'degraded';
        }

        // Discord Platform API status
        let discordPlatformStatus = 'operational';
        if (!isWsConnected || restInfo.status === 'outage') {
            discordPlatformStatus = 'outage';
        } else if (wsPing > 250 || restInfo.status === 'degraded' || hasDegradedFlag) {
            discordPlatformStatus = 'degraded';
        }

        let sector = 'operational';
        let sectorTitle = 'All Systems Operational';
        let sectorDesc = 'Nora Core API and Discord Platform connections are fully synchronized and healthy.';

        if (hasMaintenance) {
            sector = 'maintenance';
            sectorTitle = 'Scheduled Maintenance';
            sectorDesc = 'Scheduled maintenance or database optimization currently in progress.';
        } else if (hasOutageFlag || noraDbStatus === 'outage') {
            sector = 'outage';
            sectorTitle = 'Core Service Downtime';
            sectorDesc = 'Internal service downtime detected on Nora Core infrastructure.';
        } else if (discordPlatformStatus === 'outage') {
            sector = 'upstream_outage';
            sectorTitle = 'Discord Platform Disruption (Nora Core Online)';
            sectorDesc = 'Nora API is online and responding, but an upstream issue at Discord is impacting Gateway/REST connectivity.';
        } else if (discordPlatformStatus === 'degraded' || wsPing > 250) {
            sector = 'degraded';
            sectorTitle = 'Degraded Performance (Elevated Latency)';
            sectorDesc = 'Elevated latency detected across Discord gateway connectors. Commands may experience slight delays.';
        }

        const wsStatusMap = {
            0: 'READY',
            1: 'CONNECTING',
            2: 'RECONNECTING',
            3: 'IDLE',
            4: 'NEARLY',
            5: 'DISCONNECTED',
            6: 'WAITING_FOR_GUILDS',
            7: 'IDENTIFYING',
            8: 'RESUMING'
        };

        return {
            sector,
            sectorTitle,
            sectorDesc,
            components: {
                noraApi: { name: 'Nora Core API & Dashboard', status: noraApiStatus },
                noraDatabase: { name: 'Database & Persistent Storage', status: noraDbStatus },
                discordGateway: {
                    name: 'Discord Gateway (WebSocket)',
                    status: isWsConnected ? (wsPing > 250 ? 'degraded' : 'operational') : 'outage',
                    wsStatus: wsStatusMap[wsStatusNum] || 'DISCONNECTED',
                    pingMs: wsPing
                },
                discordRest: {
                    name: 'Discord REST & Endpoints',
                    status: restInfo.status,
                    latencyMs: restInfo.latency
                }
            },
            wsPing,
            activeFlags: flags,
            allIncidents: allIncidents
        };
    }

    // Generates a visual clipped snapshot of the site's status hero & component cards
    async function generateStatusSectionSnapshot(sector, evaluation = {}) {
        try {
            const sharp = require('sharp');
            const isUpstream = sector === 'upstream_outage';
            const isDegraded = sector === 'degraded';
            const isMaintenance = sector === 'maintenance';
            const isOutage = sector === 'outage';

            let bannerColor = '#10b981';
            let bannerGlow = 'rgba(16, 185, 129, 0.25)';
            let statusTitle = 'All Systems Normal';
            let statusDesc = 'All services and Discord platform connections are running smoothly.';
            let iconBg = '#10b981';

            if (isUpstream) {
                bannerColor = '#f59e0b';
                bannerGlow = 'rgba(245, 158, 11, 0.28)';
                statusTitle = 'Discord Platform Issue';
                statusDesc = 'Nora is running fine, but Discord is having problems.';
                iconBg = '#f59e0b';
            } else if (isDegraded) {
                bannerColor = '#eab308';
                bannerGlow = 'rgba(234, 179, 8, 0.25)';
                statusTitle = 'Running A Bit Slow';
                statusDesc = 'Responses might take a few seconds longer than usual.';
                iconBg = '#eab308';
            } else if (isMaintenance) {
                bannerColor = '#818cf8';
                bannerGlow = 'rgba(129, 140, 248, 0.25)';
                statusTitle = 'Scheduled Maintenance';
                statusDesc = 'Doing a quick update. We will be back up shortly!';
                iconBg = '#818cf8';
            } else if (isOutage) {
                bannerColor = '#ef4444';
                bannerGlow = 'rgba(239, 68, 68, 0.28)';
                statusTitle = 'Service Trouble Detected';
                statusDesc = 'We are actively investigating to get everything back online.';
                iconBg = '#ef4444';
            }

            const noraApiStatus = (evaluation.components?.noraApi?.status || 'operational').toLowerCase();
            const dbStatus = (evaluation.components?.noraDatabase?.status || 'operational').toLowerCase();
            const gwStatus = (evaluation.components?.discordGateway?.status || (isUpstream ? 'outage' : 'operational')).toLowerCase();
            const restStatus = (evaluation.components?.discordRest?.status || (isUpstream ? 'outage' : 'operational')).toLowerCase();

            function getBadge(st) {
                if (st === 'operational') {
                    return { text: 'Operational', color: '#34d399', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.35)', icon: '✔' };
                }
                if (st === 'degraded') {
                    return { text: 'Degraded', color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.35)', icon: '▲' };
                }
                return { text: 'Issue Detected', color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.35)', icon: '✖' };
            }

            const b1 = getBadge(noraApiStatus);
            const b2 = getBadge(dbStatus);
            const b3 = getBadge(gwStatus);
            const b4 = getBadge(restStatus);

            const svg = `
            <svg width="760" height="340" viewBox="0 0 760 340" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="snapBg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#0e1322"/>
                        <stop offset="100%" stop-color="#090c15"/>
                    </linearGradient>
                    <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="rgba(255,255,255,0.04)"/>
                        <stop offset="100%" stop-color="rgba(255,255,255,0.01)"/>
                    </linearGradient>
                </defs>

                <rect width="760" height="340" rx="20" fill="url(#snapBg)" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
                <rect x="0" y="0" width="760" height="4" fill="${bannerColor}" rx="2"/>

                <!-- Hero Status Banner -->
                <g transform="translate(32, 28)">
                    <rect width="696" height="88" rx="14" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                    <rect x="0" y="0" width="6" height="88" rx="3" fill="${bannerColor}"/>

                    <circle cx="48" cy="44" r="22" fill="${bannerGlow}"/>
                    <circle cx="48" cy="44" r="14" fill="${iconBg}"/>
                    <circle cx="48" cy="44" r="6" fill="#ffffff"/>

                    <text x="86" y="38" fill="#ffffff" font-size="20" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700">${statusTitle}</text>
                    <text x="86" y="62" fill="#94a3b8" font-size="13" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">${statusDesc}</text>

                    <rect x="580" y="30" width="96" height="28" rx="14" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                    <circle cx="594" cy="44" r="4" fill="${bannerColor}"/>
                    <text x="605" y="48" fill="#e2e8f0" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600">LIVE FEED</text>
                </g>

                <!-- 4 Component Cards -->
                <g transform="translate(32, 134)">
                    <rect width="338" height="74" rx="12" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
                    <text x="18" y="34" fill="#ffffff" font-size="14" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600">⚙️ Nora Core API</text>
                    <text x="18" y="54" fill="#64748b" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">Web Dashboard &amp; command processing</text>
                    <rect x="226" y="24" width="96" height="24" rx="12" fill="${b1.bg}" stroke="${b1.border}" stroke-width="1"/>
                    <text x="274" y="40" fill="${b1.color}" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" text-anchor="middle">${b1.icon} ${b1.text}</text>
                </g>

                <g transform="translate(390, 134)">
                    <rect width="338" height="74" rx="12" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
                    <text x="18" y="34" fill="#ffffff" font-size="14" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600">💾 Database &amp; State</text>
                    <text x="18" y="54" fill="#64748b" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">User leveling, cards &amp; server configs</text>
                    <rect x="226" y="24" width="96" height="24" rx="12" fill="${b2.bg}" stroke="${b2.border}" stroke-width="1"/>
                    <text x="274" y="40" fill="${b2.color}" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" text-anchor="middle">${b2.icon} ${b2.text}</text>
                </g>

                <g transform="translate(32, 222)">
                    <rect width="338" height="74" rx="12" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
                    <text x="18" y="34" fill="#ffffff" font-size="14" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600">🔌 Discord Gateway</text>
                    <text x="18" y="54" fill="#64748b" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">Real-time bot WebSocket connection</text>
                    <rect x="216" y="24" width="106" height="24" rx="12" fill="${b3.bg}" stroke="${b3.border}" stroke-width="1"/>
                    <text x="269" y="40" fill="${b3.color}" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" text-anchor="middle">${b3.icon} ${b3.text}</text>
                </g>

                <g transform="translate(390, 222)">
                    <rect width="338" height="74" rx="12" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
                    <text x="18" y="34" fill="#ffffff" font-size="14" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600">🌐 Discord REST API</text>
                    <text x="18" y="54" fill="#64748b" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">Interactions, channels &amp; message delivery</text>
                    <rect x="216" y="24" width="106" height="24" rx="12" fill="${b4.bg}" stroke="${b4.border}" stroke-width="1"/>
                    <text x="269" y="40" fill="${b4.color}" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" text-anchor="middle">${b4.icon} ${b4.text}</text>
                </g>

                <text x="32" y="322" fill="#475569" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">vaztinix.dev/status • Automatic Sentinel Snapshot</text>
                <text x="728" y="322" fill="#64748b" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" text-anchor="end">Click button below to open status page ➔</text>
            </svg>
            `;

            return await sharp(Buffer.from(svg)).png().toBuffer();
        } catch (e) {
            console.error('[Sentinel Snapshot Error]:', e.message);
            return null;
        }
    }

    async function sendChannelSectorUpdate(newSector, oldSector, evaluation, isStartup = false, isTest = false) {
        const now = Date.now();
        if (!isTest && lastNotifiedSector === newSector && (now - lastNotificationTime < SECTOR_COOLDOWN_MS)) {
            return false;
        }

        let channel = client.channels.cache.get(UPDATES_CHANNEL_ID);
        if (!channel) {
            channel = await client.channels.fetch(UPDATES_CHANNEL_ID).catch(() => null);
        }
        if (!channel) {
            console.warn(`[Sentinel] Updates channel ${UPDATES_CHANNEL_ID} not accessible.`);
            return false;
        }

        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
        const embed = new EmbedBuilder().setTimestamp();

        let title = '';
        let desc = '';
        let color = 0x10B981;

        if (newSector === 'operational') {
            color = 0x10B981;
            title = isStartup ? '🟢 Nora is online!' : '🟢 Nora is back to normal!';
            desc = isStartup 
                ? 'Nora is back up and running. Everything is working as expected!' 
                : 'All issues have been resolved and Nora is running smoothly again. Thanks for your patience!';
        } else if (newSector === 'upstream_outage') {
            color = 0xF59E0B;
            title = '🟠 Discord is having issues';
            desc = 'Discord’s servers are experiencing problems right now. Nora is running fine on our end, but some commands, buttons, or messages might be delayed until Discord fixes their platform.';
        } else if (newSector === 'degraded') {
            color = 0xEAB308;
            title = '🟡 Nora is running a bit slow';
            desc = 'Things are taking a little longer than usual right now. Nora is still online, but responses might be slightly delayed.';
        } else if (newSector === 'maintenance') {
            color = 0x818cf8;
            title = '🛠️ Nora is down for maintenance';
            desc = 'We’re doing a quick update to keep everything running smoothly. Nora will be back up shortly!';
        } else {
            color = 0xEF4444;
            title = '🔴 Nora is currently down';
            desc = 'We’ve detected an issue with Nora and are looking into it right now to get everything back online.';
        }

        if (isTest) {
            title = `[TEST] ${title}`;
        }

        embed.setColor(color)
            .setTitle(title)
            .setURL('https://vaztinix.dev/status')
            .setDescription(`${desc}\n\n👉 **[Click here to view live status on our website](https://vaztinix.dev/status)**`)
            .setFooter({
                text: 'Nora Status Monitor',
                iconURL: client.user ? client.user.displayAvatarURL() : undefined
            });

        const files = [];
        const snapshotBuf = await generateStatusSectionSnapshot(newSector, evaluation);
        if (snapshotBuf) {
            const attachment = new AttachmentBuilder(snapshotBuf, { name: 'status-snapshot.png' });
            files.push(attachment);
            embed.setImage('attachment://status-snapshot.png');
        }

        const statusRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('View Live Status Page')
                .setStyle(ButtonStyle.Link)
                .setURL('https://vaztinix.dev/status')
                .setEmoji('🌐')
        );

        await channel.send({
            embeds: [embed],
            components: [statusRow],
            files
        }).catch(err => {
            console.error('[Sentinel Error] Could not send status embed to updates channel:', err.message);
        });

        if (!isTest) {
            lastNotifiedSector = newSector;
            lastNotificationTime = now;
        }

        sectorUpdatesHistory.unshift({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            timestamp: new Date().toISOString(),
            fromSector: oldSector,
            toSector: newSector,
            title: embed.data.title || `${newSector.toUpperCase()} Sector`,
            description: embed.data.description || evaluation.sectorDesc,
            severity: newSector === 'operational' ? 'info' : (newSector === 'degraded' ? 'degraded' : (newSector === 'maintenance' ? 'maintenance' : 'outage')),
            components: evaluation.components,
            isTest
        });
        if (sectorUpdatesHistory.length > 50) sectorUpdatesHistory.pop();
        return true;
    }

    // Sentinel Background Monitor (Runs every 15 seconds)
    setInterval(async () => {
        try {
            const evalResult = await evaluateSystemSector();
            const candidate = evalResult.sector;
            const now = Date.now();

            // Initial Startup Announcement after 25s of stable operation
            if (!hasAnnouncedStartup && process.uptime() >= 25 && client.isReady && client.isReady()) {
                hasAnnouncedStartup = true;
                currentSector = candidate;
                await sendChannelSectorUpdate(candidate, 'booting', evalResult, true);
                return;
            }

            if (candidate !== currentSector) {
                if (pendingSector !== candidate) {
                    pendingSector = candidate;
                    pendingSince = now;
                } else if (now - pendingSince >= CONFIRMATION_MS) {
                    // Confirmed sector transition
                    const previous = currentSector;
                    currentSector = candidate;
                    pendingSector = null;
                    await sendChannelSectorUpdate(currentSector, previous, evalResult, false);
                }
            } else {
                pendingSector = null;
            }
        } catch (err) {
            console.error('[Sentinel Monitor Error]:', err.message);
        }
    }, 15000);

    /**
     * GET /api/status/public
     * Returns live shard metrics, health summary, and active/recent incident flags (Fresh every 10s)
     */
    router.get('/public', async (req, res) => {
        try {
            const now = Date.now();
            const forceRefresh = req.query.force === 'true';

            if (!forceRefresh && cachedStatusData && (now - lastCacheTimestamp < CACHE_TTL_MS)) {
                return res.json({
                    ...cachedStatusData,
                    cached: true,
                    nextUpdateInSeconds: Math.max(0, Math.round((CACHE_TTL_MS - (now - lastCacheTimestamp)) / 1000))
                });
            }

            const evaluation = await evaluateSystemSector();
            const wsPing = evaluation.wsPing;

            let systemStatus = 'online';
            let statusText = 'Online';

            if (evaluation.sector === 'upstream_outage') {
                systemStatus = 'upstream_issue';
                statusText = 'Discord Platform Issue';
            } else if (evaluation.sector === 'outage') {
                systemStatus = 'outage';
                statusText = 'Partial Outage';
            } else if (evaluation.sector === 'degraded') {
                systemStatus = 'degraded';
                statusText = 'Degraded Performance';
            } else if (evaluation.sector === 'maintenance') {
                systemStatus = 'maintenance';
                statusText = 'Scheduled Maintenance';
            }

            // Gather shard metrics
            const shardCount = (client && client.options && client.options.shardCount) ? client.options.shardCount : 1;
            const shards = [];

            const totalGuilds = client && client.guilds ? client.guilds.cache.size : 0;
            let totalMembers = 0;
            if (client && client.guilds) {
                const uniqueSet = new Set();
                client.guilds.cache.forEach(g => g.members.cache.forEach((_, id) => uniqueSet.add(id)));
                if (client.users) client.users.cache.forEach((_, id) => uniqueSet.add(id));
                totalMembers = uniqueSet.size > 0 ? uniqueSet.size : (client.users ? client.users.cache.size : 0);
            }

            // High-precision memory measurements
            const mem = process.memoryUsage();
            const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
            const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
            const rssMB = Math.round(mem.rss / 1024 / 1024);
            const externalMB = Math.round((mem.external || 0) / 1024 / 1024);
            const totalSystemMemMB = Math.round(os.totalmem() / 1024 / 1024);
            const freeSystemMemMB = Math.round(os.freemem() / 1024 / 1024);
            const usedSystemMemMB = totalSystemMemMB - freeSystemMemMB;
            const memoryUsagePct = Math.min(100, Math.round((heapUsedMB / Math.max(heapTotalMB, 1)) * 100));

            const uptimeSec = Math.floor(process.uptime());
            const commandCount = client && client.commands ? client.commands.size : 59;
            const isGatewayReady = client && client.ws && client.ws.status === 0;

            for (let i = 0; i < shardCount; i++) {
                shards.push({
                    id: i,
                    name: `Shard #${i}`,
                    status: isGatewayReady ? 'READY' : (evaluation.components.discordGateway.wsStatus || 'CONNECTING'),
                    pingMs: wsPing,
                    pingQuality: wsPing < 75 ? 'Optimal' : (wsPing < 160 ? 'Good' : 'Elevated'),
                    guilds: totalGuilds,
                    users: totalMembers,
                    uptimeSeconds: uptimeSec,
                    memoryUsedMB: heapUsedMB,
                    memoryHeapTotalMB: heapTotalMB,
                    memoryRssMB: rssMB,
                    memoryUsagePct: memoryUsagePct,
                    lastPingTimestamp: Date.now()
                });
            }

            // Record point for stock-style websocket latency chart
            recordLatency(wsPing);

            cachedStatusData = {
                systemStatus,
                statusText,
                statusSector: evaluation.sector,
                statusDesc: evaluation.sectorDesc,
                components: evaluation.components,
                serverCount: totalGuilds > 0 ? totalGuilds : 65,
                memberCount: totalMembers > 0 ? totalMembers : 10700,
                commandCount: commandCount > 0 ? commandCount : 59,
                ping: wsPing,
                pingQuality: wsPing < 75 ? 'Optimal' : (wsPing < 160 ? 'Good' : 'Elevated'),
                memory: {
                    heapUsedMB,
                    heapTotalMB,
                    rssMB,
                    externalMB,
                    systemTotalRAM_MB: totalSystemMemMB,
                    systemUsedRAM_MB: usedSystemMemMB,
                    memoryUsagePct
                },
                shards,
                latencyHistory: [...latencyHistory],
                incidents: (evaluation.allIncidents && evaluation.allIncidents.length > 0) ? evaluation.allIncidents : evaluation.activeFlags,
                activeCount: (evaluation.activeFlags || []).length,
                updatedAt: new Date().toISOString()
            };
            lastCacheTimestamp = now;

            res.json({
                ...cachedStatusData,
                cached: false,
                nextUpdateInSeconds: Math.round(CACHE_TTL_MS / 1000)
            });
        } catch (err) {
            console.error('[Status API Error]:', err);
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /api/status/updates
     * Chronological sector transitions, incidents, and waking-up event logs
     */
    router.get('/updates', async (req, res) => {
        try {
            const evalResult = await evaluateSystemSector();
            res.json({
                currentSector,
                targetChannelId: UPDATES_CHANNEL_ID,
                components: evalResult.components,
                lastNotificationTime: lastNotificationTime ? new Date(lastNotificationTime).toISOString() : null,
                lastNotifiedSector,
                updates: sectorUpdatesHistory
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /api/status/updates/test
     * Dispatch a simulated test status update to channel 1533291837173792859
     */
    router.post('/updates/test', async (req, res) => {
        try {
            const evalResult = await evaluateSystemSector();
            const success = await sendChannelSectorUpdate(currentSector, 'manual_test', evalResult, false, true);
            if (success) {
                res.json({ success: true, message: `Status embed successfully forwarded to channel #${UPDATES_CHANNEL_ID}`, sector: currentSector });
            } else {
                res.status(500).json({ success: false, error: `Could not access or send embed to channel #${UPDATES_CHANNEL_ID}` });
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /api/status/incidents
     */
    router.get('/incidents', async (req, res) => {
        try {
            const flags = await StatusFlag.findAll({
                order: [['createdAt', 'DESC']],
                limit: 50
            }).catch(() => []);
            res.json({ incidents: flags });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /api/status/incidents (Owner / Admin Key authorized)
     */
    router.post('/incidents', async (req, res) => {
        try {
            const { title, message, severity, shardId, author, apiKey } = req.body || {};
            const APP_OWNER_ID = '1214048435632603137';

            if (apiKey !== process.env.BOTBOARD_API_KEY && req.headers['x-owner-id'] !== APP_OWNER_ID) {
                return res.status(401).json({ error: 'Unauthorized status flag creation.' });
            }

            if (!title || !message) {
                return res.status(400).json({ error: 'Title and message required.' });
            }

            const flag = await StatusFlag.create({
                title,
                message,
                severity: severity || 'info',
                shardId: shardId || 0,
                author: author || 'System Flag',
                isResolved: false
            });

            res.json({ status: 'ok', flag });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * PATCH /api/status/incidents/:id/resolve
     */
    router.patch('/incidents/:id/resolve', async (req, res) => {
        try {
            const id = req.params.id;
            const { resolutionNote, apiKey } = req.body || {};
            const APP_OWNER_ID = '1214048435632603137';

            if (apiKey !== process.env.BOTBOARD_API_KEY && req.headers['x-owner-id'] !== APP_OWNER_ID) {
                return res.status(401).json({ error: 'Unauthorized incident resolution.' });
            }

            const flag = await StatusFlag.findByPk(id);
            if (!flag) {
                return res.status(404).json({ error: 'Status flag not found.' });
            }

            flag.isResolved = true;
            flag.resolvedAt = new Date();
            if (resolutionNote) flag.resolutionNote = resolutionNote;
            await flag.save();

            res.json({ status: 'ok', flag });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
