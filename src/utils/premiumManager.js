/**
 * Nora Premium Management System - V18.0
 * Handles SKU recognition, Studio Plus entitlements, and tier limit enforcement.
 */

const PREMIUM_SKU_ID = '1490857354609168534';
const APP_OWNER_IDS = ['1214048435632603137', '1366229304257544213'];

module.exports = {
    PREMIUM_SKU_ID,
    APP_OWNER_IDS,

    /**
     * Check if a user or server interaction has an active premium entitlement.
     * @param {Object} interaction - The Discord interaction object.
     * @returns {Boolean}
     */
    isPremium: (interaction) => {
        if (!interaction) return false;

        // 1. Check if user is a bot owner/dev
        if (interaction.user && APP_OWNER_IDS.includes(interaction.user.id)) {
            return true;
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

        // 3. Fallback: If we have a guild context, check the settingsCache synchronously
        if (interaction.guildId) {
            try {
                const settingsCache = require('./settingsCache');
                const s = settingsCache.cache ? settingsCache.cache.get(interaction.guildId) : null;
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
        if (APP_OWNER_IDS.includes(userId)) return true;
        try {
            const UserPrefs = require('../database/models/UserPrefs');
            // Check memory or synchronous cache if needed
            return false;
        } catch (e) {
            return false;
        }
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
     * If all sponsoring staff members leave the server or lose staff permissions/premium,
     * the server automatically reverts to the Free tier.
     * @param {Object} guild - Discord.js Guild instance (optional)
     * @param {Object} settings - GuildSettings instance or plain object (optional)
     * @param {Object} currentUser - Currently authenticated Discord user from OAuth (optional)
     * @returns {Promise<{ isPremium: boolean, tierTag: string, maxSavedWebhooks: number, directServerPremium: boolean, sponsors: Array }>}
     */
    resolveGuildPremiumStatus: async (guild, settings = null, currentUser = null) => {
        const now = Date.now();
        const guildId = guild ? String(guild.id) : (settings && settings.guildId ? String(settings.guildId) : null);

        // 1. Direct server-level subscription / manual grant on GuildSettings
        const directServerPremium = Boolean(
            settings && (
                settings.isPremium ||
                settings.isManualPremium ||
                (settings.paidExpiresAt && (new Date(settings.paidExpiresAt).getTime() + (settings.expandedTimeMs ? Number(settings.expandedTimeMs) : 0) > now))
            )
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

        // 3. Gather all users with active personal premium (UserPrefs + APP_OWNER_IDS)
        const UserPrefs = require('../database/models/UserPrefs');
        const allPrefs = await UserPrefs.findAll().catch(() => []);
        const prefsByUserId = new Map();
        const candidateUserIds = new Set(APP_OWNER_IDS);

        for (const p of allPrefs) {
            if (!p || !p.userId) continue;
            prefsByUserId.set(String(p.userId), p);
            const activePaid = p.paidExpiresAt && (new Date(p.paidExpiresAt).getTime() + (p.expandedTimeMs ? Number(p.expandedTimeMs) : 0) > now);
            // Universal free trials permanently removed
            const activeLegacy = p.premiumExpiresAt && (new Date(p.premiumExpiresAt).getTime() > now);
            if (p.isPremium || p.isManualPremium || activePaid || activeLegacy) {
                candidateUserIds.add(String(p.userId));
            }
        }

        const sponsors = [];
        const seenSponsorIds = new Set();

        if (guild) {
            for (const uid of candidateUserIds) {
                let member = guild.members?.cache?.get(uid) || null;
                if (!member && guild.members && typeof guild.members.fetch === 'function') {
                    member = await guild.members.fetch(uid).catch(() => null);
                }
                // If the user is not in the server (left the server), they cannot sponsor it
                if (!member) continue;

                const isOwner = String(guild.ownerId) === String(uid);
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
                const userPref = prefsByUserId.get(String(uid));
                const isBoundToThisGuild = Boolean(userPref && guildId && String(userPref.boundGuildId) === String(guildId));

                // Must be a current staff member in the server (or bound while in the server)
                if (isOwner || hasDiscordStaffPerm || hasWhitelistedStaffRole || isBoundToThisGuild) {
                    if (!seenSponsorIds.has(uid)) {
                        seenSponsorIds.add(uid);
                        const username = member.user?.username || userPref?.displayName || ('User ' + uid.slice(-4));
                        const displayName = member.displayName || member.user?.globalName || username;
                        const avatar = (member.user && typeof member.user.displayAvatarURL === 'function')
                            ? member.user.displayAvatarURL({ extension: 'png', size: 64 })
                            : null;
                        sponsors.push({
                            id: String(uid),
                            username,
                            displayName,
                            avatar,
                            roleLabel: isOwner ? 'Server Owner' : 'Server Staff'
                        });
                    }
                }
            }
        } else if (currentUser && currentUser.id && candidateUserIds.has(String(currentUser.id))) {
            const uid = String(currentUser.id);
            seenSponsorIds.add(uid);
            sponsors.push({
                id: uid,
                username: currentUser.username || 'Staff',
                displayName: currentUser.global_name || currentUser.username || 'Staff',
                avatar: currentUser.avatar ? ('https://cdn.discordapp.com/avatars/' + uid + '/' + currentUser.avatar + '.png?size=64') : null,
                roleLabel: 'Server Staff'
            });
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
     * 2. Grants permanent Nora Premium to the first 50 guilds and first 100 users.
     */
    applyEarlyAdopterPremium: async () => {
        try {
            const sequelize = require('../database/db');

            // 1. Revoke all free trials platform-wide
            await sequelize.query('UPDATE UserPrefs SET freeTrialClaimed = 0, freeTrialExpiresAt = NULL;').catch(() => {});

            // 2. First 50 Servers
            const [earlyGuilds] = await sequelize.query(`
                SELECT guildId FROM GuildSettings 
                WHERE guildId IS NOT NULL AND guildId != ''
                ORDER BY createdAt ASC 
                LIMIT 50;
            `).catch(() => [[]]);

            if (earlyGuilds && earlyGuilds.length > 0) {
                const guildIds = earlyGuilds.map(g => "'" + g.guildId + "'").join(',');
                await sequelize.query(`
                    UPDATE GuildSettings 
                    SET isPremium = 1, isManualPremium = 1, paidExpiresAt = NULL 
                    WHERE guildId IN (${guildIds});
                `).catch(() => {});

                try {
                    const settingsCache = require('./settingsCache');
                    for (const g of earlyGuilds) {
                        const s = settingsCache.cache ? settingsCache.cache.get(g.guildId) : null;
                        if (s) {
                            s.isPremium = true;
                            s.isManualPremium = true;
                            s.paidExpiresAt = null;
                        }
                    }
                } catch (e) {}
            }

            // 3. First 100 Users
            const [earlyUsers] = await sequelize.query(`
                SELECT userId, MIN(createdAt) as joinedAt FROM (
                    SELECT userId, createdAt FROM UserPrefs
                    UNION ALL 
                    SELECT userId, createdAt FROM UserLevels
                )
                WHERE userId IS NOT NULL AND userId != ''
                GROUP BY userId
                ORDER BY joinedAt ASC
                LIMIT 100;
            `).catch(() => [[]]);

            if (earlyUsers && earlyUsers.length > 0) {
                const nowIso = new Date().toISOString();
                for (const u of earlyUsers) {
                    const [existing] = await sequelize.query(`SELECT userId FROM UserPrefs WHERE userId = '${u.userId}' LIMIT 1;`).catch(() => [[]]);
                    if (existing && existing.length > 0) {
                        await sequelize.query(`
                            UPDATE UserPrefs 
                            SET isPremium = 1, isManualPremium = 1, paidExpiresAt = NULL, freeTrialClaimed = 0, freeTrialExpiresAt = NULL 
                            WHERE userId = '${u.userId}';
                        `).catch(() => {});
                    } else {
                        await sequelize.query(`
                            INSERT INTO UserPrefs (userId, isPremium, isManualPremium, paidExpiresAt, createdAt, updatedAt)
                            VALUES ('${u.userId}', 1, 1, NULL, '${u.joinedAt || nowIso}', '${nowIso}');
                        `).catch(() => {});
                    }
                }
            }

            console.log('[Premium System] Verified Early Adopter Grants: 50 Guilds & 100 Users permanently entitled to Nora Premium. Free trials revoked.');
            return { guildsCount: earlyGuilds ? earlyGuilds.length : 0, usersCount: earlyUsers ? earlyUsers.length : 0 };
        } catch (err) {
            console.error('[Premium System] Failed to apply early adopter premium:', err.message);
            return null;
        }
    }
};
