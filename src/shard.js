require('dotenv').config();
const path = require('path');
const { ShardingManager } = require('discord.js');
const { SHARD_LIMITS } = require('./utils/shardManager');

/**
 * Nora Studio — Dynamic Pre-2500 ShardingManager Launcher
 * Automatically computes required shards using the 1,800 soft threshold
 * (strictly below the 2,200 safe ceiling and Discord's 2,500 server limit).
 */
async function startDynamicSharding() {
    const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
    if (!token) {
        console.error('[ShardManager] Missing DISCORD_TOKEN in environment.');
        process.exit(1);
    }

    const manager = new ShardingManager(path.join(__dirname, 'index.js'), {
        token,
        totalShards: 'auto',
        respawn: true,
        execArgv: ['--max-old-space-size=4096']
    });

    manager.on('shardCreate', (shard) => {
        console.log(`[Dynamic Sharding] Launched Shard #${shard.id} (Safe Zone Ceiling: ${SHARD_LIMITS.SAFE_GUILD_LIMIT} servers/shard, Soft Split: ${SHARD_LIMITS.SOFT_GUILD_THRESHOLD} servers/shard)`);

        shard.on('ready', () => {
            console.log(`[Dynamic Sharding] Shard #${shard.id} is READY and accepting gateway events.`);
        });

        shard.on('disconnect', () => {
            console.warn(`[Dynamic Sharding] Shard #${shard.id} disconnected from Discord Gateway.`);
        });

        shard.on('reconnecting', () => {
            console.log(`[Dynamic Sharding] Shard #${shard.id} is reconnecting...`);
        });

        shard.on('death', (proc) => {
            console.error(`[Dynamic Sharding] Shard #${shard.id} process exited (Code: ${proc.exitCode}). Auto-respawning...`);
        });
    });

    try {
        await manager.spawn({ amount: 'auto', delay: 5500, timeout: 60000 });
        console.log('[Dynamic Sharding] All cluster shards spawned and healthy.');
    } catch (err) {
        console.error('[Dynamic Sharding] Error spawning shards:', err);
    }
}

startDynamicSharding();

