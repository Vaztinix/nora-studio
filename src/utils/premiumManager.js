/**
 * Nora Premium Management System - V18.0
 * Handles SKU recognition and entitlement verification for Discord App Subscriptions.
 */

const PREMIUM_SKU_ID = '1490857354609168534';

module.exports = {
    PREMIUM_SKU_ID,

    /**
     * Check if a user or server has an active premium entitlement.
     * @param {Object} interaction - The Discord interaction object.
     * @returns {Boolean}
     */
    isPremium: (interaction) => {
        if (!interaction || !interaction.entitlements) return false;

        // Check if the user has an active entitlement for our specific SKU
        return interaction.entitlements.some(entitlement => 
            entitlement.skuId === PREMIUM_SKU_ID
        );
    },

    /**
     * Get benefits configuration based on premium status.
     * @param {Boolean} isPremium 
     */
    getBenefits: (isPremium) => {
        return {
            roleRewardLimit: isPremium ? 15 : 10,
            rateLimitReductionFactor: isPremium ? 0.5 : 1.0,
            hasEarlyAccess: isPremium,
            hasBadge: isPremium
        };
    }
};
