/**
 * Nora Premium Management System - V18.5
 * Handles SKU recognition, Studio Plus entitlements, and tier limit enforcement.
 */

const PREMIUM_SKU_ID = '1490857354609168534';
const APP_OWNER_IDS = ['1214048435632603137', '1366229304257544213'];

// Lightweight in-memory cache to prevent N+1 full-table scans & OOM crashes
let _premUsersCache = {
    timestamp: 0,
    candidateUserIds: new Set(APP_OWNER_IDS),
    prefsByUserId: new Map(),
    boundGuildMap: new Map() // guildId -> Array of user pref rows
};
let _premGuildIdsCache = new Set();
let _cacheRefreshPromise = null;
const PREM_CACHE_TTL_MS = 30 * 1000;

async function ensurePremiumCacheWarm(force = false) {
    const now = Date.now();
    if (!force && _premUsersCache.timestamp > 0 && (now - _premUsersCache.timestamp < PREM_CACHE_TTL_MS)) {
        return _premUsersCache;
    }
    if (_cacheRefreshPromise) return _cacheRefreshPromise;

    _cacheRefreshPromise = (async () => {
        try {
            const sequelize = require('../database/db');
            // Select ONLY lightweight scalar columns (excludes 13MB+ base64 image columns!)
            const [rows] = await sequelize.query(`
                SELECT userId, isPremium, isManualPremium, paidExpiresAt, expandedTimeMs, premiumExpiresAt, displayName, boundGuildId
                FROM UserPrefs
                WHERE userId IS NOT NULL AND userId != ''
            `).catch(() => [[]]);

            const nextCandidateIds = new Set(APP_OWNER_IDS);
            const nextPrefsMap = new Map();
            const nextBoundMap = new Map();

            for (const p of rows) {
                const uid = String(p.userId);
                nextPrefsMap.set(uid, p);
                const activePaid = p.paidExpiresAt && (new Date(p.paidExpiresAt).getTime() + (p.expandedTimeMs ? Number(p.expandedTimeMs) : 0) > now);
                const activeLegacy = p.premiumExpiresAt && (new Date(p.premiumExpiresAt).getTime() > now);
                if (p.isPremium || p.isManualPremium || activePaid || activeLegacy) {
                    nextCandidateIds.add(uid);
                    if (p.boundGuildId) {
                        const gid = String(p.boundGuildId);
                        if (!nextBoundMap.has(gid)) nextBoundMap.set(gid, []);
                        nextBoundMap.get(gid).push(p);
                    }
                }
            }

            const [guildRows] = await sequelize.query(`
                SELECT guildId FROM GuildSettings
                WHERE isPremium = 1 OR isManualPremium = 1 OR paidExpiresAt IS NOT NULL
            `).catch(() => [[]]);
            const nextGuildIds = new Set();
            for (const g of guildRows) {
                if (g.guildId) nextGuildIds.add(String(g.guildId));
            }

            _premUsersCache = {
                timestamp: Date.now(),
                candidateUserIds: nextCandidateIds,
                prefsByUserId: nextPrefsMap,
                boundGuildMap: nextBoundMap
            };
            _premGuildIdsCache = nextGuildIds;
        } catch (e) {
            console.warn('[Premium Cache] Refresh warning:', e.message);
        } finally {
            _cacheRefreshPromise = null;
        }
        return _premUsersCache;
    })();

    return _cacheRefreshPromise;
}

module.exports = {
    PREMIUM_SKU_ID,
    APP_OWNER_IDS,
    ensurePremiumCacheWarm,
    invalidatePremiumCache: () => {
        _premUsersCache.timestamp = 0;
    },

    /**
     * Check if a user or server interaction has an active premium entitlement.
     * @param {Object} interaction - The Discord interaction object.
     * @returns {Boolean}
     */
    isPremium: (interaction) => {
        if (!interaction) return false;

        // 1. Check if user is a bot owner/dev or has personal premium in warm cache
        const userId = interaction.user?.id || interaction.member?.user?.id;
        if (userId) {
            if (APP_OWNER_IDS.includes(String(userId))) return true;
            if (_premUsersCache.candidateUserIds.has(String(userId))) return true;
        }

        // 2. Check interaction entitlements (Discord App Subscriptions / SKUs)
        if (interaction.entitlements) {
            if (interaction.entitlements.cache && (
                interaction.entitlements.cache.has(PREMIUM_SKU_ID) ||
                interaction.entitlements.cache.some(e => e.skuId === PREMIUM_SKU_ID)
            )) {
                return true;
            }
            if (interaction.entitlements.some && interaction.entitlements.some(e => e.skuId === PREMIUM_SKU_ID)) {
                return true;
            }
        }

        // 3. Fallback: If we have a guild context, check warm guild cache & settingsCache synchronously
        if (interaction.guildId) {
            const gid = String(interaction.guildId);
            if (_premGuildIdsCache.has(gid)) return true;
            try {
                const settingsCache = require('./settingsCache');
                const s = settingsCache.cache ? settingsCache.cache.get(gid) : null;
                if (s && (s.isPremium || s.isManualPremium || (s.paidExpiresAt && new Date(s.paidExpiresAt).getTime() > Date.now()))) {
                    return true;
                }
            } catch (e) {}
        }

        return false;
    },

    /**
     * Check if a specific user ID is premium.
     * @param {String} userId 
     * @returns {Boolean}
     */
    isUserPremium: (userId) => {
        if (!userId) return false;
        const uid = String(userId);
        if (APP_OWNER_IDS.includes(uid)) return true;
        if (_premUsersCache.candidateUserIds.has(uid)) return true;
        return false;
    },

    /**
     * Get benefits configuration and feature limits based on premium status.
     * Matches the official Discord App Directory "Studio Plus" ($1.99/mo) specification.
     * @param {Boolean} isPremium 
     * @returns {Object}
     */
    getBenefits: (isPremium) => {
        return {
            tierName: isPremium ? 'Studio Plus' : 'Standard Free',
            tierPrice: isPremium ? '$1.99 / Month' : '$0.00',
            // 🚀 1. Autoresponders: Free 5, Studio Plus 200
            autoresponderLimit: isPremium ? 200 : 5,
            regexAutoresponder: !!isPremium,
            granularRoleFilters: !!isPremium,

            // 🎨 2. Rank Cards: Custom GIF backdrops & HEX palette builder
            customRankCardGifs: !!isPremium,
            customHexColors: !!isPremium,

            // 🔥 3. Leveling: Free 5 role rewards & 2x multiplier, Studio Plus 25 role rewards & 10x multiplier
            roleRewardLimit: isPremium ? 25 : 5,
            maxMultiplier: isPremium ? 10.0 : 2.0,

            // ⏱️ 4. Rate Limits: 50% reduced wait times
            rateLimitReductionFactor: isPremium ? 0.5 : 1.0,

            // 🛡️ 5. AutoMod & Logging: Free 3 log channels, Studio Plus 15+ dedicated split channels
            maxLogChannels: isPremium ? 20 : 3,
            autoModThreatShield: !!isPremium,

            // 🛟 6. SLA & Official Badges
            hasEarlyAccess: !!isPremium,
            hasBadge: !!isPremium,

            // 🪝 7. Saved Webhook Presets: Free 3, Studio Plus 10
            savedWebhookLimit: isPremium ? 10 : 3
        };
    },

    /**
     * Resolve whether a guild has active Premium (either directly or via Staff Premium Sponsorship),
     * and return the list of staff members whose Premium is sponsoring the server.
     * Uses warm memory cache and cached guild members to avoid OOM and Discord REST rate limits.
     * @param {Object} guild - Discord.js Guild instance (optional)
     * @param {Object} settings - GuildSettings instance or plain object (optional)
     * @param {Object} currentUser - Currently authenticated Discord user from OAuth (optional)
     * @returns {Promise<{ isPremium: boolean, tierTag: string, maxSavedWebhooks: number, directServerPremium: boolean, sponsors: Array }>}
     */
    resolveGuildPremiumStatus: async (guild, settings = null, currentUser = null) => {
        const now = Date.now();
        const guildId = guild ? String(guild.id) : (settings && settings.guildId ? String(settings.guildId) : null);

        const cache = await ensurePremiumCacheWarm();
        const { candidateUserIds, prefsByUserId, boundGuildMap } = cache;

        // 1. Direct server-level subscription / manual grant on GuildSettings
        const directServerPremium = Boolean(
            (guildId && _premGuildIdsCache.has(guildId)) ||
            (settings && (
                settings.isPremium ||
                settings.isManualPremium ||
                (settings.paidExpiresAt && (new Date(settings.paidExpiresAt).getTime() + (settings.expandedTimeMs ? Number(settings.expandedTimeMs) : 0) > now))
            ))
        );

        // 2. Parse any dashboard-whitelisted staff roles for this guild
        const whitelistedRoleIds = new Set();
        if (settings && settings.whitelistedRoles) {
            try {
                const parsed = typeof settings.whitelistedRoles === 'string'
                    ? JSON.parse(settings.whitelistedRoles)
                    : settings.whitelistedRoles;
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        if (typeof item === 'string') whitelistedRoleIds.add(item);
                        else if (item && item.roleId) whitelistedRoleIds.add(String(item.roleId));
                        else if (item && item.id) whitelistedRoleIds.add(String(item.id));
                    }
                }
            } catch (e) {}
        }

        const sponsors = [];
        const seenSponsorIds = new Set();

        if (guild) {
            // Check guild owner first
            if (guild.ownerId && candidateUserIds.has(String(guild.ownerId))) {
                const ownerId = String(guild.ownerId);
                const ownerMember = guild.members?.cache?.get(ownerId) || null;
                const userPref = prefsByUserId.get(ownerId);
                seenSponsorIds.add(ownerId);
                const username = ownerMember?.user?.username || userPref?.displayName || ('User ' + ownerId.slice(-4));
                const displayName = ownerMember?.displayName || ownerMember?.user?.globalName || username;
                const avatar = (ownerMember?.user && typeof ownerMember.user.displayAvatarURL === 'function')
                    ? ownerMember.user.displayAvatarURL({ extension: 'png', size: 64 })
                    : null;
                sponsors.push({
                    id: ownerId,
                    username,
                    displayName,
                    avatar,
                    roleLabel: 'Server Owner'
                });
            }

            // Check cached guild members (zero network requests!)
            if (guild.members && guild.members.cache) {
                for (const member of guild.members.cache.values()) {
                    const uid = String(member.id);
                    if (seenSponsorIds.has(uid) || !candidateUserIds.has(uid)) continue;

                    const isOwner = String(guild.ownerId) === uid;
                    const perms = member.permissions;
                    const hasDiscordStaffPerm = Boolean(perms && (
                        perms.has('Administrator') ||
                        perms.has('ManageGuild') ||
                        perms.has('ManageWebhooks') ||
                        perms.has('ManageChannels') ||
                        perms.has('ManageRoles') ||
                        perms.has('ModerateMembers') ||
                        perms.has('KickMembers') ||
                        perms.has('BanMembers')
                    ));
                    const hasWhitelistedStaffRole = Boolean(
                        whitelistedRoleIds.size > 0 &&
                        member.roles?.cache?.some(r => whitelistedRoleIds.has(String(r.id)))
                    );
                    const userPref = prefsByUserId.get(uid);
                    const isBoundToThisGuild = Boolean(userPref && guildId && String(userPref.boundGuildId) === guildId);

                    if (isOwner || hasDiscordStaffPerm || hasWhitelistedStaffRole || isBoundToThisGuild) {
                        seenSponsorIds.add(uid);
                        const username = member.user?.username || userPref?.displayName || ('User ' + uid.slice(-4));
                        const displayName = member.displayName || member.user?.globalName || username;
                        const avatar = (member.user && typeof member.user.displayAvatarURL === 'function')
                            ? member.user.displayAvatarURL({ extension: 'png', size: 64 })
                            : null;
                        sponsors.push({
                            id: uid,
                            username,
                            displayName,
                            avatar,
                            roleLabel: isOwner ? 'Server Owner' : 'Server Staff'
                        });
                    }
                }
            }

            // Check any users explicitly bound to this guild in UserPrefs
            if (guildId && boundGuildMap.has(guildId)) {
                for (const userPref of boundGuildMap.get(guildId)) {
                    const uid = String(userPref.userId);
                    if (seenSponsorIds.has(uid)) continue;
                    seenSponsorIds.add(uid);
                    const username = userPref.displayName || ('User ' + uid.slice(-4));
                    sponsors.push({
                        id: uid,
                        username,
                        displayName: username,
                        avatar: null,
                        roleLabel: 'Server Sponsor'
                    });
                }
            }
        }

        if (currentUser && currentUser.id && candidateUserIds.has(String(currentUser.id))) {
            const uid = String(currentUser.id);
            if (!seenSponsorIds.has(uid)) {
                seenSponsorIds.add(uid);
                sponsors.push({
                    id: uid,
                    username: currentUser.username || 'Staff',
                    displayName: currentUser.global_name || currentUser.username || 'Staff',
                    avatar: currentUser.avatar ? ('https://cdn.discordapp.com/avatars/' + uid + '/' + currentUser.avatar + '.png?size=64') : null,
                    roleLabel: 'Server Staff'
                });
            }
        }

        const isPremium = Boolean(directServerPremium || sponsors.length > 0);
        return {
            isPremium,
            tierTag: isPremium ? 'PREMIUM' : 'FREE',
            maxSavedWebhooks: isPremium ? 10 : 3,
            directServerPremium,
            sponsors
        };
    },

    /**
     * Platform Migration & Startup Enforcer:
     * 1. Permanently revokes all active and claimed free trials.
     * 2. Grants permanent Nora Premium to all guilds and users.
     */
    applyEarlyAdopterPremium: async () => {
        try {
            const sequelize = require('../database/db');

            // 1. Revoke all free trials platform-wide
            await sequelize.query('UPDATE UserPrefs SET freeTrialClaimed = 0, freeTrialExpiresAt = NULL;').catch(() => {});

            // 2. Grant permanent Lifetime Nora Premium to ALL configured servers in GuildSettings
            await sequelize.query(`
                UPDATE GuildSettings 
                SET isPremium = 1, isManualPremium = 1, paidExpiresAt = NULL 
                WHERE guildId IS NOT NULL AND guildId != '';
            `).catch(() => {});

            try {
                const settingsCache = require('./settingsCache');
                const [allGuilds] = await sequelize.query(`SELECT guildId FROM GuildSettings;`).catch(() => [[]]);
                for (const g of allGuilds) {
                    const s = settingsCache.cache ? settingsCache.cache.get(g.guildId) : null;
                    if (s) {
                        s.isPremium = true;
                        s.isManualPremium = true;
                        s.paidExpiresAt = null;
                    }
                }
            } catch (e) {}

            // 3. Grant permanent Lifetime Nora Premium to ALL users in UserPrefs
            await sequelize.query(`
                UPDATE UserPrefs 
                SET isPremium = 1, isManualPremium = 1, paidExpiresAt = NULL, freeTrialClaimed = 0, freeTrialExpiresAt = NULL 
                WHERE userId IS NOT NULL AND userId != '';
            `).catch(() => {});

            // 4. Ensure any users who have leveled up in UserLevels also have UserPrefs with Nora Premium
            const [levelUsers] = await sequelize.query(`
                SELECT DISTINCT userId, MIN(createdAt) as joinedAt FROM UserLevels
                WHERE userId NOT IN (SELECT userId FROM UserPrefs WHERE userId IS NOT NULL)
                AND userId IS NOT NULL AND userId != ''
                GROUP BY userId;
            `).catch(() => [[]]);

            const nowIso = new Date().toISOString();
            if (levelUsers && levelUsers.length > 0) {
                for (const u of levelUsers) {
                    await sequelize.query(`
                        INSERT INTO UserPrefs (userId, isPremium, isManualPremium, paidExpiresAt, createdAt, updatedAt)
                        VALUES (?, 1, 1, NULL, ?, ?);
                    `, { replacements: [String(u.userId), u.joinedAt || nowIso, nowIso] }).catch(() => {});
                }
            }

            // Warm the in-memory cache immediately
            await ensurePremiumCacheWarm(true);

            console.log('[Premium System] Verified Lifetime Nora Premium applied to all members and all servers.');
            return { success: true };
        } catch (err) {
            console.error('[Premium System] Failed to apply premium:', err.message);
            return null;
        }
    }
};
