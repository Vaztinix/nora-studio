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
            hasBadge: !!isPremium
        };
    }
};
