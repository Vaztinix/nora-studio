/**
 * Nora Premium Management System - V18.0
 * Handles SKU recognition and entitlement verification for Discord App Subscriptions.
 */

const PREMIUM_SKU_ID = '1490857354609168534';
const APP_OWNER_IDS = ['1214048435632603137', '1366229304257544213'];

module.exports = {
    PREMIUM_SKU_ID,

    /**
     * Check if a user or server has an active premium entitlement.
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
            // Check in cache
            if (interaction.entitlements.cache && (
                interaction.entitlements.cache.has(PREMIUM_SKU_ID) ||
                interaction.entitlements.cache.some(e => e.skuId === PREMIUM_SKU_ID)
            )) {
                return true;
            }
            // Check direct array/collection if cache isn't used
            if (interaction.entitlements.some && interaction.entitlements.some(e => e.skuId === PREMIUM_SKU_ID)) {
                return true;
            }
        }

        // 3. Fallback: If we have a guild context, check the settingsCache synchronously
        if (interaction.guildId) {
            try {
                const settingsCache = require('./settingsCache');
                const s = settingsCache.cache ? settingsCache.cache.get(interaction.guildId) : null;
                if (s && (s.isPremium || s.isManualPremium)) {
                    return true;
                }
            } catch (e) {}
        }

        return false;
    },

    /**
     * Get benefits configuration based on premium status.
     * @param {Boolean} isPremium 
     */
    getBenefits: (isPremium) => {
        return {
            roleRewardLimit: isPremium ? 25 : 5,
            rateLimitReductionFactor: isPremium ? 0.5 : 1.0,
            hasEarlyAccess: !!isPremium,
            hasBadge: !!isPremium
        };
    }
};
