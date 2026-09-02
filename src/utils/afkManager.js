const AfkUser = require('../database/models/AfkUser');

/**
 * In-Memory AFK Cache
 * Key: `${guildId}:${userId}` -> { userId, guildId, status, timestamp, originalNickname, autoNicknameChanged }
 */
const afkCache = new Map();

/**
 * Cooldown Cache for Mention Alerts
 * Key: `${guildId}:${userId}:${channelId}` -> lastAlertTimestamp (ms)
 */
const mentionCooldowns = new Map();

let isLoaded = false;
let loadPromise = null;

/**
 * Load all active AFK records from SQLite on startup
 */
async function loadAll() {
    if (isLoaded) return afkCache;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const records = await AfkUser.findAll();
            afkCache.clear();
            for (const r of records) {
                const data = r.toJSON ? r.toJSON() : r;
                afkCache.set(`${data.guildId}:${data.userId}`, {
                    userId: data.userId,
                    guildId: data.guildId,
                    status: data.status || 'AFK',
                    timestamp: Number(data.timestamp) || Date.now(),
                    originalNickname: data.originalNickname || null,
                    autoNicknameChanged: !!data.autoNicknameChanged
                });
            }
            isLoaded = true;
            console.log(`[AFK Manager] Loaded ${afkCache.size} active AFK states into cache.`);
        } catch (err) {
            console.error('[AFK Manager] Error loading AFK records from database:', err.message);
        } finally {
            loadPromise = null;
        }
        return afkCache;
    })();

    return loadPromise;
}

/**
 * Set a user as AFK in a guild
 * @param {string} guildId 
 * @param {string} userId 
 * @param {string} status 
 * @param {string|null} originalNickname 
 * @param {boolean} autoNicknameChanged 
 * @returns {Promise<Object>}
 */
async function setAfk(guildId, userId, status = 'AFK', originalNickname = null, autoNicknameChanged = false) {
    await loadAll();
    const cleanStatus = (status && typeof status === 'string' && status.trim()) 
        ? status.trim().substring(0, 500) 
        : 'AFK';
    const timestamp = Date.now();

    const recordData = {
        guildId,
        userId,
        status: cleanStatus,
        timestamp,
        originalNickname: originalNickname || null,
        autoNicknameChanged: !!autoNicknameChanged
    };

    try {
        const [record] = await AfkUser.findOrCreate({
            where: { guildId, userId },
            defaults: recordData
        });
        if (record) {
            await record.update(recordData);
        }
    } catch (e) {
        console.error('[AFK Manager] DB Error setting AFK:', e.message);
    }

    const key = `${guildId}:${userId}`;
    afkCache.set(key, recordData);
    return recordData;
}

/**
 * Get AFK state for a user in a guild
 * @param {string} guildId 
 * @param {string} userId 
 * @returns {Object|null}
 */
function getAfk(guildId, userId) {
    return afkCache.get(`${guildId}:${userId}`) || null;
}

/**
 * Check if a user is currently AFK in a guild
 * @param {string} guildId 
 * @param {string} userId 
 * @returns {boolean}
 */
function isAfk(guildId, userId) {
    return afkCache.has(`${guildId}:${userId}`);
}

/**
 * Remove AFK status for a user in a guild
 * @param {string} guildId 
 * @param {string} userId 
 * @returns {Promise<Object|null>} Returns the removed AFK data if existed
 */
async function removeAfk(guildId, userId) {
    await loadAll();
    const key = `${guildId}:${userId}`;
    const existing = afkCache.get(key) || null;

    if (existing) {
        afkCache.delete(key);
        try {
            await AfkUser.destroy({ where: { guildId, userId } });
        } catch (e) {
            console.error('[AFK Manager] DB Error removing AFK:', e.message);
        }
    }

    return existing;
}

/**
 * List all active AFK users in a guild
 * @param {string} guildId 
 * @returns {Array<Object>}
 */
function listAfk(guildId) {
    const list = [];
    for (const [key, val] of afkCache.entries()) {
        if (key.startsWith(`${guildId}:`)) {
            list.push(val);
        }
    }
    return list;
}

/**
 * Mention notification rate limit check (10s cooldown per user per channel)
 * @param {string} guildId 
 * @param {string} userId 
 * @param {string} channelId 
 * @returns {boolean} true if alert should be sent, false if on cooldown
 */
function checkMentionCooldown(guildId, userId, channelId) {
    const key = `${guildId}:${userId}:${channelId}`;
    const now = Date.now();
    const lastAlert = mentionCooldowns.get(key) || 0;

    if (now - lastAlert < 10000) {
        return false; // On cooldown
    }

    mentionCooldowns.set(key, now);
    // Cleanup old keys periodically
    if (mentionCooldowns.size > 1000) {
        for (const [k, time] of mentionCooldowns.entries()) {
            if (now - time > 60000) {
                mentionCooldowns.delete(k);
            }
        }
    }
    return true;
}

module.exports = {
    loadAll,
    setAfk,
    getAfk,
    isAfk,
    removeAfk,
    listAfk,
    checkMentionCooldown,
    afkCache
};
