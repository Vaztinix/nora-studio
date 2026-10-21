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
                let mentions = [];
                try {
                    mentions = data.mentions ? JSON.parse(data.mentions) : [];
                } catch (_) { mentions = []; }

                afkCache.set(`${data.guildId}:${data.userId}`, {
                    userId: data.userId,
                    guildId: data.guildId,
                    status: data.status || 'AFK',
                    timestamp: Number(data.timestamp) || Date.now(),
                    expiresAt: data.expiresAt ? Number(data.expiresAt) : null,
                    originalNickname: data.originalNickname || null,
                    autoNicknameChanged: !!data.autoNicknameChanged,
                    gifUrl: data.gifUrl || null,
                    mentions: Array.isArray(mentions) ? mentions : []
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
 * @param {number|null} expiresAt
 * @param {string|null} gifUrl
 * @returns {Promise<Object>}
 */
async function setAfk(guildId, userId, status = 'AFK', originalNickname = null, autoNicknameChanged = false, expiresAt = null, gifUrl = null) {
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
        expiresAt: expiresAt ? Number(expiresAt) : null,
        originalNickname: originalNickname || null,
        autoNicknameChanged: !!autoNicknameChanged,
        gifUrl: gifUrl || null,
        mentions: '[]'
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
    const cacheData = {
        ...recordData,
        mentions: []
    };
    afkCache.set(key, cacheData);
    return cacheData;
}

/**
 * Records a mention and message sent to an AFK user for the return AI briefing.
 * @param {string} guildId 
 * @param {string} userId 
 * @param {Object} mentionData 
 * @returns {Promise<boolean>}
 */
async function addMention(guildId, userId, mentionData) {
    const key = `${guildId}:${userId}`;
    const afkData = afkCache.get(key);
    if (!afkData) return false;

    if (!Array.isArray(afkData.mentions)) {
        afkData.mentions = [];
    }

    afkData.mentions.push(mentionData);
    if (afkData.mentions.length > 15) {
        afkData.mentions.shift();
    }

    try {
        await AfkUser.update(
            { mentions: JSON.stringify(afkData.mentions) },
            { where: { guildId, userId } }
        );
    } catch (e) {
        console.error('[AFK Manager] DB Error recording mention:', e.message);
    }

    return true;
}

/**
 * Gets all recorded mentions for an AFK user.
 * @param {string} guildId 
 * @param {string} userId 
 * @returns {Array<Object>}
 */
function getMentions(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const afkData = afkCache.get(key);
    return afkData?.mentions || [];
}

/**
 * Applies the server's configured AFK role to a member if available
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').GuildMember} member 
 * @returns {Promise<boolean>}
 */
async function applyAfkRole(guild, member) {
    if (!guild || !member) return false;
    try {
        const settingsCache = require('./settingsCache');
        const settings = await settingsCache.get(guild.id);
        if (!settings?.afkRoleId) return false;

        const roleId = String(settings.afkRoleId).replace(/[^0-9]/g, '');
        if (!roleId || member.roles.cache.has(roleId)) return false;

        const me = guild.members.me;
        const { PermissionFlagsBits } = require('discord.js');
        if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) return false;

        const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
        if (!role || role.position >= me.roles.highest.position || role.managed) return false;

        await member.roles.add(role, 'User is now AFK').catch(() => {});
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Safely clears a user's AFK status: removes from DB/cache, restores nickname, and strips AFK role.
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').GuildMember|string} memberOrId 
 * @param {Object} options 
 * @returns {Promise<{ wasAfk: boolean, afkData: Object|null, member: Object|null }>}
 */
async function clearUserAfk(guild, memberOrId, options = {}) {
    if (!guild || !memberOrId) return { wasAfk: false, afkData: null, member: null };
    const userId = typeof memberOrId === 'string' ? memberOrId : memberOrId.id;
    const afkData = getAfk(guild.id, userId);

    if (!afkData) {
        return { wasAfk: false, afkData: null, member: null };
    }

    // 1. Remove record from cache and SQLite
    await removeAfk(guild.id, userId);

    // 2. Fetch member if needed
    let member = (typeof memberOrId === 'object' && memberOrId?.guild) ? memberOrId : null;
    if (!member) {
        member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    }

    if (member) {
        // 3. Restore nickname if it was altered or prefixed
        try {
            if (member.manageable) {
                const currentNick = member.displayName;
                if (currentNick.startsWith('[AFK]') || currentNick.startsWith('{AFK]') || currentNick.startsWith('{AFK}')) {
                    const targetRestore = (afkData.originalNickname !== undefined && afkData.originalNickname !== null)
                        ? afkData.originalNickname
                        : currentNick.replace(/^(\[AFK\]|\{AFK\]|\{AFK\})\s*/i, '');
                    await member.setNickname(targetRestore).catch(() => {});
                }
            }
        } catch (_) {}

        // 4. Remove AFK Role if configured and assigned
        try {
            const settingsCache = require('./settingsCache');
            const settings = await settingsCache.get(guild.id);
            if (settings?.afkRoleId) {
                const roleId = String(settings.afkRoleId).replace(/[^0-9]/g, '');
                if (roleId && member.roles.cache.has(roleId)) {
                    const me = guild.members.me;
                    const { PermissionFlagsBits } = require('discord.js');
                    if (me && me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                        const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
                        if (role && role.position < me.roles.highest.position && !role.managed) {
                            await member.roles.remove(role, options.reason || 'User is no longer AFK').catch(() => {});
                        }
                    }
                }
            }
        } catch (_) {}
    }

    return { wasAfk: true, afkData, member };
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
    applyAfkRole,
    clearUserAfk,
    getAfk,
    isAfk,
    removeAfk,
    listAfk,
    checkMentionCooldown,
    addMention,
    getMentions,
    afkCache
};
