const GuildSettings = require('../database/models/GuildSettings');

const cache = new Map();

/**
 * Get settings for a guild, from cache if present, otherwise from database
 * @param {string} guildId 
 * @returns {Promise<Object>}
 */
async function get(guildId) {
    if (!guildId) return null;
    
    if (cache.has(guildId)) {
        return cache.get(guildId);
    }
    
    let settings = await GuildSettings.findOne({ where: { guildId } });
    if (!settings) {
        settings = await GuildSettings.create({ guildId });
    }
    
    cache.set(guildId, settings);
    return settings;
}

/**
 * Update settings for a guild in both DB and cache
 * @param {string} guildId 
 * @param {Object} updates 
 * @returns {Promise<Object>}
 */
async function update(guildId, updates) {
    if (!guildId) return null;
    
    let settings = await GuildSettings.findOne({ where: { guildId } });
    if (!settings) {
        settings = await GuildSettings.create({ guildId, ...updates });
    } else {
        await settings.update(updates);
    }
    
    cache.set(guildId, settings);
    return settings;
}

/**
 * Invalidate settings in cache (force reload next time)
 * @param {string} guildId 
 */
function invalidate(guildId) {
    if (!guildId) return;
    cache.delete(guildId);
}

/**
 * Clear the entire cache
 */
function clear() {
    cache.clear();
}

module.exports = {
    get,
    update,
    invalidate,
    clear,
    cache
};
