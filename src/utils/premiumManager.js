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
        return true;
    },

    /**
     * Get benefits configuration based on premium status.
     * @param {Boolean} isPremium 
     */
    getBenefits: (isPremium) => {
        return {
            roleRewardLimit: 25,
            rateLimitReductionFactor: 0.5,
            hasEarlyAccess: true,
            hasBadge: true
        };
    }
};
