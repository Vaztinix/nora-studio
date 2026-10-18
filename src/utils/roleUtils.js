/**
 * 🛠️ Nora Role Utilities
 * Universal snowflake extraction, sanitization, validation and role hierarchy helpers.
 */

/**
 * Extracts and sanitizes valid Discord snowflake role IDs from any representation
 * (JSON arrays, comma-delimited strings, raw arrays, dirty strings with quotes/brackets).
 * @param {any} raw
 * @returns {string[]} Array of clean 17-20 digit snowflake ID strings
 */
function parseRoleIds(raw) {
    if (!raw) return [];

    let candidateList = [];

    if (Array.isArray(raw)) {
        candidateList = raw;
    } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed || trimmed === '[]' || trimmed === '""' || trimmed === "''") {
            return [];
        }

        // Try parsing JSON array format
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    candidateList = parsed;
                }
            } catch (_) {}
        }

        // If not parsed as JSON array or parsing failed, extract via snowflake regex
        if (candidateList.length === 0) {
            const matches = trimmed.match(/\b\d{17,20}\b/g);
            if (matches && matches.length > 0) {
                return [...new Set(matches)];
            }
            candidateList = trimmed.split(',');
        }
    } else if (typeof raw === 'number' || typeof raw === 'bigint') {
        candidateList = [String(raw)];
    }

    const cleanSnowflakes = [];
    for (const item of candidateList) {
        if (!item) continue;
        const clean = String(item).replace(/[^0-9]/g, '');
        // Discord snowflakes are 17 to 20 digits long
        if (clean.length >= 17 && clean.length <= 20) {
            if (!cleanSnowflakes.includes(clean)) {
                cleanSnowflakes.push(clean);
            }
        }
    }

    return cleanSnowflakes;
}

/**
 * Normalizes any role input into a clean comma-separated string or null if empty
 * @param {any} raw
 * @param {number|null} maxLimit
 * @returns {string|null}
 */
function normalizeRoleIds(raw, maxLimit = null) {
    const list = parseRoleIds(raw);
    if (!list.length) return null;
    const final = (typeof maxLimit === 'number' && maxLimit > 0) ? list.slice(0, maxLimit) : list;
    return final.join(',');
}

/**
 * Helper to check if the bot can assign a role based on guild permissions & hierarchy
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 * @returns {{ canAssign: boolean, reason?: string }}
 */
function canBotAssignRole(guild, role) {
    if (!guild || !role) {
        return { canAssign: false, reason: 'Invalid guild or role provided.' };
    }

    const me = guild.members.me;
    if (!me) {
        return { canAssign: false, reason: 'Could not resolve bot member profile.' };
    }

    const { PermissionFlagsBits } = require('discord.js');
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return { canAssign: false, reason: 'Nora lacks the **Manage Roles** permission.' };
    }

    if (role.position >= me.roles.highest.position) {
        return { 
            canAssign: false, 
            reason: `Role <@&${role.id}> (${role.name}) is higher than or equal to Nora's highest role in Server Settings > Roles.` 
        };
    }

    if (role.managed) {
        return { canAssign: false, reason: `Role <@&${role.id}> (${role.name}) is managed by an integration or bot and cannot be assigned manually.` };
    }

    return { canAssign: true };
}

module.exports = {
    parseRoleIds,
    normalizeRoleIds,
    canBotAssignRole
};
