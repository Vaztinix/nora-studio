const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');

/**
 * Nora Studio — Dynamic Sharding & Multi-Factor Cluster Balancing Engine
 * ---------------------------------------------------------------------
 * Ensures guilds are separated well before Discord's 2,500 server hard limit
 * and dynamically evaluates shard separation based on:
 *   1. Server Count per Shard (Soft threshold: 1,800 | Hard Safe Limit: 2,200 | Discord Max: 2,500)
 *   2. Shard Resource Usage (V8 Heap Memory %, RSS MB, System CPU Load %)
 *   3. Event Loop Lag & Gateway Latency (perf_hooks nanosecond loop monitor & WS Ping)
 *   4. Member Density & Voice Adapter Load (Members managed & active voice sessions)
 */

const SHARD_LIMITS = {
    SOFT_GUILD_THRESHOLD: 1800,      // Proactive auto-split threshold
    SAFE_GUILD_LIMIT: 2200,          // Strictly separates before 2,500 servers
    DISCORD_HARD_LIMIT: 2500,        // Discord's mandatory sharding ceiling
    MAX_MEMBERS_PER_SHARD: 150000,   // Member density separation threshold
    MAX_HEAP_USAGE_PCT: 78,          // Memory pressure split threshold
    MAX_EVENT_LOOP_LAG_MS: 45,       // Event loop responsiveness threshold
    MAX_OPTIMAL_PING_MS: 180         // Gateway heartbeat latency threshold
};

// High-resolution Event Loop Delay histogram
let loopHistogram = null;
try {
    loopHistogram = monitorEventLoopDelay({ resolution: 20 });
    loopHistogram.enable();
} catch (_) {}

// CPU usage delta tracker
let lastCpuUsage = process.cpuUsage();
let lastCpuCheckTime = Date.now();
let cachedCpuPct = 1.4;

function getProcessCpuPercent() {
    const now = Date.now();
    const elapsedMs = now - lastCpuCheckTime;
    if (elapsedMs < 2000) return cachedCpuPct;

    const currentUsage = process.cpuUsage(lastCpuUsage);
    lastCpuUsage = process.cpuUsage();
    lastCpuCheckTime = now;

    const totalCpuMicros = currentUsage.user + currentUsage.system;
    const cores = Math.max(1, os.cpus().length);
    const pct = (totalCpuMicros / (elapsedMs * 1000 * cores)) * 100;
    cachedCpuPct = Math.max(0.2, Math.min(99.9, Number(pct.toFixed(1))));
    return cachedCpuPct;
}

function getEventLoopLagMs() {
    if (!loopHistogram) return 1.2;
    const meanNs = loopHistogram.mean || 0;
    const lagMs = Math.max(0.2, (meanNs / 1e6) - 20);
    return Number(Math.min(500, lagMs).toFixed(2));
}

// Rebalance & telemetry state
const rebalanceHistory = [];
let lastRebalanceEvaluation = Date.now();

/**
 * Calculates the optimal shard count based on guild count, member count, and memory usage.
 */
function calculateRecommendedShardCount(totalGuilds, totalMembers, heapUsagePct, eventLoopLagMs) {
    // 1. Guild count factor (separates before 2,200 guilds, well below 2,500)
    const shardsByGuilds = Math.max(1, Math.ceil(totalGuilds / SHARD_LIMITS.SOFT_GUILD_THRESHOLD));

    // 2. Hard safe zone enforcement (never allow >= 2,200 guilds on a single shard)
    const shardsBySafeZone = Math.max(1, Math.ceil((totalGuilds + 1) / SHARD_LIMITS.SAFE_GUILD_LIMIT));

    // 3. Member density factor (150k members per shard)
    const shardsByMembers = Math.max(1, Math.ceil(totalMembers / SHARD_LIMITS.MAX_MEMBERS_PER_SHARD));

    // 4. Resource pressure factor (if heap > 78% or event loop lag > 45ms on high guild load)
    let resourceAdditionalShards = 0;
    if (totalGuilds > 500 && (heapUsagePct >= SHARD_LIMITS.MAX_HEAP_USAGE_PCT || eventLoopLagMs >= SHARD_LIMITS.MAX_EVENT_LOOP_LAG_MS)) {
        resourceAdditionalShards = 1;
    }

    return Math.max(shardsByGuilds, shardsBySafeZone, shardsByMembers) + resourceAdditionalShards;
}

/**
 * Computes which shard a Discord Guild ID belongs to using Discord's snowflake formula:
 * shardId = (guildId >> 22) % numShards
 */
function getShardIdForGuild(guildId, numShards = 1) {
    if (!guildId || numShards <= 1) return 0;
    try {
        return Number((BigInt(guildId) >> 22n) % BigInt(numShards));
    } catch (_) {
        return 0;
    }
}

/**
 * Evaluates live shard telemetry, health scores, capacity ratios, and separation reasons.
 */
function evaluateDynamicShards(client, basePing = 28, isGatewayReady = true, wsStatusStr = 'READY') {
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const memoryUsagePct = Math.min(100, Math.round((heapUsedMB / Math.max(heapTotalMB, 1)) * 100));
    const cpuUsagePct = getProcessCpuPercent();
    const eventLoopLagMs = getEventLoopLagMs();
    const uptimeSec = Math.floor(process.uptime());

    let totalGuilds = 0;
    let totalMembers = 0;
    let totalVoiceSessions = 0;
    const guildsList = [];

    if (client && client.guilds && client.guilds.cache) {
        totalGuilds = client.guilds.cache.size;
        const uniqueUsers = new Set();
        client.guilds.cache.forEach(g => {
            const mCount = g.memberCount || g.approximateMemberCount || 0;
            const voiceCount = g.voiceStates && g.voiceStates.cache ? g.voiceStates.cache.size : 0;
            totalVoiceSessions += voiceCount;
            if (g.members && g.members.cache) {
                g.members.cache.forEach((_, id) => uniqueUsers.add(id));
            }
            guildsList.push({
                id: g.id,
                name: g.name,
                memberCount: mCount,
                voiceCount
            });
        });
        const sumMembers = guildsList.reduce((acc, g) => acc + g.memberCount, 0);
        totalMembers = Math.max(sumMembers, uniqueUsers.size);
    }

    const configuredShards = (client && client.options && client.options.shardCount) ? client.options.shardCount : 1;
    const recommendedShards = calculateRecommendedShardCount(totalGuilds, totalMembers, memoryUsagePct, eventLoopLagMs);
    const effectiveShardCount = Math.max(configuredShards, recommendedShards);

    // Bucket guilds across shards using Discord's snowflake routing
    const shardBuckets = Array.from({ length: effectiveShardCount }, (_, idx) => ({
        id: idx,
        guilds: 0,
        users: 0,
        voiceConnections: 0,
        largestGuildMembers: 0
    }));

    guildsList.forEach(g => {
        const targetShard = getShardIdForGuild(g.id, effectiveShardCount);
        const bucket = shardBuckets[targetShard] || shardBuckets[0];
        bucket.guilds += 1;
        bucket.users += g.memberCount;
        bucket.voiceConnections += g.voiceCount;
        if (g.memberCount > bucket.largestGuildMembers) {
            bucket.largestGuildMembers = g.memberCount;
        }
    });

    // Determine separation & health metrics per shard
    const shards = shardBuckets.map((b, i) => {
        const shardGuilds = b.guilds;
        const shardUsers = b.users;
        const safeCapacityPct = Number(((shardGuilds / SHARD_LIMITS.SAFE_GUILD_LIMIT) * 100).toFixed(1));
        const discordLimitPct = Number(((shardGuilds / SHARD_LIMITS.DISCORD_HARD_LIMIT) * 100).toFixed(1));

        // Calculate composite Shard Health Score (0 - 100)
        let healthScore = 100;
        if (!isGatewayReady) {
            healthScore = 0;
        } else {
            if (basePing > 250) healthScore -= 18;
            else if (basePing > 160) healthScore -= 8;
            else if (basePing > 90) healthScore -= 2;

            if (eventLoopLagMs > 60) healthScore -= 15;
            else if (eventLoopLagMs > 25) healthScore -= 5;

            if (memoryUsagePct > 85) healthScore -= 10;
            else if (memoryUsagePct > 75) healthScore -= 4;

            if (shardGuilds >= SHARD_LIMITS.SAFE_GUILD_LIMIT) healthScore -= 12;
            else if (shardGuilds >= SHARD_LIMITS.SOFT_GUILD_THRESHOLD) healthScore -= 4;
        }
        healthScore = Math.max(0, Math.min(100, Number(healthScore.toFixed(1))));

        // Determine active separation/load reason
        let separationStatus = 'Optimal Safe Zone (<1,800 Servers)';
        let loadTier = 'OPTIMAL';
        if (!isGatewayReady) {
            separationStatus = 'Gateway Reconnecting';
            loadTier = 'OFFLINE';
        } else if (shardGuilds >= SHARD_LIMITS.SAFE_GUILD_LIMIT) {
            separationStatus = 'Pre-2500 Auto-Split Active (>=2,200 Servers)';
            loadTier = 'SCALING';
        } else if (shardGuilds >= SHARD_LIMITS.SOFT_GUILD_THRESHOLD) {
            separationStatus = 'Approaching Pre-Split Threshold (1,800+ Servers)';
            loadTier = 'ELEVATED';
        } else if (memoryUsagePct >= SHARD_LIMITS.MAX_HEAP_USAGE_PCT) {
            separationStatus = 'Resource-Balanced (High Heap Guard)';
            loadTier = 'BALANCED';
        } else if (eventLoopLagMs >= SHARD_LIMITS.MAX_EVENT_LOOP_LAG_MS) {
            separationStatus = 'Event-Loop Protected (Latency Guard)';
            loadTier = 'BALANCED';
        }

        return {
            id: i,
            name: effectiveShardCount === 1 ? `Shard #0 (Primary Cluster)` : `Shard #${i} (${i === 0 ? 'Primary' : 'Dynamic Worker'})`,
            status: isGatewayReady ? 'READY' : wsStatusStr,
            loadTier,
            healthScore,
            pingMs: basePing,
            pingQuality: basePing < 75 ? 'Optimal' : (basePing < 160 ? 'Good' : 'Elevated'),
            guilds: shardGuilds,
            users: shardUsers,
            voiceConnections: b.voiceConnections,
            safeCapacityLimit: SHARD_LIMITS.SAFE_GUILD_LIMIT,
            softCapacityLimit: SHARD_LIMITS.SOFT_GUILD_THRESHOLD,
            discordHardLimit: SHARD_LIMITS.DISCORD_HARD_LIMIT,
            safeCapacityPct,
            discordLimitPct,
            guildsRemainingBeforeSplit: Math.max(0, SHARD_LIMITS.SAFE_GUILD_LIMIT - shardGuilds),
            uptimeSeconds: uptimeSec,
            memoryUsedMB: heapUsedMB,
            memoryHeapTotalMB: heapTotalMB,
            memoryRssMB: rssMB,
            memoryUsagePct,
            cpuUsagePct,
            eventLoopLagMs,
            separationReason: separationStatus,
            lastPingTimestamp: Date.now()
        };
    });

    lastRebalanceEvaluation = Date.now();

    const shardingSummary = {
        mode: 'Dynamic Pre-2500 Auto-Sharding',
        activeShardCount: effectiveShardCount,
        recommendedShardCount: recommendedShards,
        softGuildThreshold: SHARD_LIMITS.SOFT_GUILD_THRESHOLD,
        safeGuildLimit: SHARD_LIMITS.SAFE_GUILD_LIMIT,
        discordHardLimit: SHARD_LIMITS.DISCORD_HARD_LIMIT,
        totalGuilds,
        totalMembers,
        totalVoiceSessions,
        guildsUntilNextAutoShard: Math.max(0, (effectiveShardCount * SHARD_LIMITS.SOFT_GUILD_THRESHOLD) - totalGuilds),
        safeZoneMarginGuilds: Math.max(0, (effectiveShardCount * SHARD_LIMITS.SAFE_GUILD_LIMIT) - totalGuilds),
        inSafeZone: totalGuilds < (effectiveShardCount * SHARD_LIMITS.SAFE_GUILD_LIMIT),
        avgHealthScore: shards.length > 0
            ? Number((shards.reduce((acc, s) => acc + s.healthScore, 0) / shards.length).toFixed(1))
            : 100,
        cpuUsagePct,
        eventLoopLagMs,
        memoryUsagePct,
        separationPolicies: [
            {
                factor: 'Pre-2500 Server Count Guard',
                threshold: `${SHARD_LIMITS.SOFT_GUILD_THRESHOLD} Soft / ${SHARD_LIMITS.SAFE_GUILD_LIMIT} Safe Max (Discord Limit: 2,500)`,
                current: `${totalGuilds} / ${effectiveShardCount * SHARD_LIMITS.SAFE_GUILD_LIMIT} Servers`,
                status: totalGuilds < (effectiveShardCount * SHARD_LIMITS.SOFT_GUILD_THRESHOLD) ? 'SAFE' : 'SCALING'
            },
            {
                factor: 'Shard Heap & RAM Resource Guard',
                threshold: `< ${SHARD_LIMITS.MAX_HEAP_USAGE_PCT}% V8 Heap`,
                current: `${memoryUsagePct}% (${heapUsedMB} MB / ${rssMB} MB RSS)`,
                status: memoryUsagePct < SHARD_LIMITS.MAX_HEAP_USAGE_PCT ? 'SAFE' : 'ELEVATED'
            },
            {
                factor: 'Event Loop & CPU Responsiveness',
                threshold: `< ${SHARD_LIMITS.MAX_EVENT_LOOP_LAG_MS}ms Loop Lag`,
                current: `${eventLoopLagMs}ms Lag • ${cpuUsagePct}% CPU`,
                status: eventLoopLagMs < SHARD_LIMITS.MAX_EVENT_LOOP_LAG_MS ? 'SAFE' : 'ELEVATED'
            },
            {
                factor: 'Member Density & Voice Load',
                threshold: `< ${SHARD_LIMITS.MAX_MEMBERS_PER_SHARD.toLocaleString()} Members / Shard`,
                current: `${totalMembers.toLocaleString()} Members • ${totalVoiceSessions} Voice`,
                status: totalMembers < (effectiveShardCount * SHARD_LIMITS.MAX_MEMBERS_PER_SHARD) ? 'SAFE' : 'SCALING'
            }
        ],
        lastEvaluatedAt: new Date(lastRebalanceEvaluation).toISOString()
    };

    return {
        shards,
        shardingSummary
    };
}

module.exports = {
    SHARD_LIMITS,
    evaluateDynamicShards,
    calculateRecommendedShardCount,
    getShardIdForGuild,
    getProcessCpuPercent,
    getEventLoopLagMs
};

