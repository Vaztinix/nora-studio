/**
 * 💳 Nora AI Credit & Rate Limiting Engine
 * Enforces per-server rate limits (protecting Gemini API quotas and credits from spam),
 * manages server credit balances, and defines credit costs according to Google Cloud Gemini Terms.
 */

const AI_MODEL_CREDIT_COSTS = {
    'gemini-flash-lite-latest': 1, // Google Terms: Ultra-low latency, lightest compute tier ($0.075 / 1M input)
    'gemini-3.5-flash-lite': 1,    // Google Terms: Ultra-lightweight compute tier
    'gemini-3.5-flash': 2,         // Google Terms: Balanced multimodal standard ($0.15 - $0.30 / 1M input)
    'gemini-flash-latest': 2,      // Google Terms: Production standard
    'gemini-2.5-flash': 2,         // Google Terms: Standard flash
    'gemini-3.7-flash': 3,         // Google Terms: Advanced reasoning
    'gemini-3.8-flash': 3          // Google Terms: Next-gen high-speed reasoning & deep context ($0.35 - $0.70 / 1M input)
};

const DEFAULT_CREDIT_COST = 2;
const DEFAULT_DAILY_ALLOWANCE = 1000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 6;

class AICreditManager {
    constructor() {
        // guildId -> Array of millisecond timestamps in sliding 60s window
        this.guildRequestTimestamps = new Map();
        // In-memory cache for fast atomic credit balance updates
        this.guildCreditCache = new Map();
    }

    /**
     * Resolves the credit cost for a given model based on Google Gemini Terms
     * @param {string} modelName 
     * @returns {number} credits
     */
    getModelCreditCost(modelName) {
        if (!modelName || typeof modelName !== 'string') return DEFAULT_CREDIT_COST;
        const normalized = modelName.trim().toLowerCase();
        return AI_MODEL_CREDIT_COSTS[normalized] || DEFAULT_CREDIT_COST;
    }

    /**
     * Get the breakdown dictionary of all models and their costs
     */
    getModelCostBreakdown() {
        return {
            'gemini-flash-lite-latest': {
                credits: 1,
                name: 'Gemini Flash Lite',
                tier: 'Ultra-Low Latency Throughput',
                googleTerms: 'Tier 1 Compute (~$0.075/1M input) • Lowest credit cost'
            },
            'gemini-3.5-flash': {
                credits: 2,
                name: 'Gemini 3.5 Flash',
                tier: 'Balanced Multimodal Standard',
                googleTerms: 'Tier 2 Compute (~$0.15/1M input) • Balanced reasoning'
            },
            'gemini-flash-latest': {
                credits: 2,
                name: 'Gemini Flash Latest',
                tier: 'Continuously Updated Production Standard',
                googleTerms: 'Tier 2 Compute • Dynamic stable production model'
            },
            'gemini-3.8-flash': {
                credits: 3,
                name: 'Gemini 3.8 Flash',
                tier: 'Next-Gen Reasoning & Thinking',
                googleTerms: 'Tier 3 Compute (~$0.35/1M input) • Ultra-fast multi-step inference'
            }
        };
    }

    /**
     * Check if a guild is exceeding its per-minute rate limit
     * @param {string} guildId 
     * @param {number} maxPerMinute 
     * @returns {{ allowed: boolean, waitSeconds: number, current: number, max: number }}
     */
    checkRateLimit(guildId, maxPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE) {
        const now = Date.now();
        const windowMs = 60 * 1000;
        const limit = Math.max(1, parseInt(maxPerMinute, 10) || DEFAULT_RATE_LIMIT_PER_MINUTE);

        let timestamps = this.guildRequestTimestamps.get(guildId) || [];
        timestamps = timestamps.filter(t => now - t < windowMs);
        this.guildRequestTimestamps.set(guildId, timestamps);

        if (timestamps.length >= limit) {
            const oldestInWindow = timestamps[0];
            const waitMs = Math.max(1000, oldestInWindow + windowMs - now);
            const waitSeconds = Math.ceil(waitMs / 1000);
            return {
                allowed: false,
                waitSeconds,
                current: timestamps.length,
                max: limit
            };
        }

        return {
            allowed: true,
            waitSeconds: 0,
            current: timestamps.length,
            max: limit
        };
    }

    /**
     * Record a successful request in the rate limit sliding window
     * @param {string} guildId 
     */
    recordRequest(guildId) {
        const now = Date.now();
        const timestamps = this.guildRequestTimestamps.get(guildId) || [];
        timestamps.push(now);
        this.guildRequestTimestamps.set(guildId, timestamps);
    }

    /**
     * Get or initialize guild credit state
     */
    getOrInitGuildCredits(guildId, settings) {
        const now = Date.now();
        let cached = this.guildCreditCache.get(guildId);

        const dailyAllowance = settings?.aiDailyCreditLimit || DEFAULT_DAILY_ALLOWANCE;
        const lastReset = settings?.aiLastCreditReset ? new Date(settings.aiLastCreditReset).getTime() : now;

        // Check if 24 hours have passed or if we entered a new UTC day
        const isNewDay = (now - lastReset >= 24 * 60 * 60 * 1000) || 
            (new Date(now).getUTCDate() !== new Date(lastReset).getUTCDate());

        if (!cached || isNewDay) {
            const remaining = isNewDay ? dailyAllowance : (settings?.aiCreditsRemaining !== undefined ? settings.aiCreditsRemaining : dailyAllowance);
            const used = isNewDay ? 0 : (settings?.aiCreditsUsed || 0);

            cached = {
                remaining: Math.max(0, remaining),
                used: Math.max(0, used),
                dailyAllowance,
                lastReset: isNewDay ? now : lastReset,
                rateLimitPerMinute: settings?.aiRateLimitPerMinute || DEFAULT_RATE_LIMIT_PER_MINUTE
            };

            this.guildCreditCache.set(guildId, cached);

            if (isNewDay && settings && typeof settings.save === 'function') {
                settings.aiCreditsRemaining = cached.remaining;
                settings.aiCreditsUsed = 0;
                settings.aiLastCreditReset = new Date(now);
                settings.save().catch(e => console.error('[AICreditManager] Failed to persist reset:', e.message));
            }
        }

        return cached;
    }

    /**
     * Atomically check rate limit and consume AI credits for a request
     * @param {string} guildId 
     * @param {object} settings GuildSettings instance or plain object
     * @param {string} modelName 
     * @returns {Promise<{ allowed: boolean, reason?: string, cost: number, remaining: number, waitSeconds?: number, resetInHours?: number }>}
     */
    async checkAndConsume(guildId, settings, modelName) {
        const creditState = this.getOrInitGuildCredits(guildId, settings);
        const maxPerMin = settings?.aiRateLimitPerMinute || creditState.rateLimitPerMinute || DEFAULT_RATE_LIMIT_PER_MINUTE;

        // 1. Rate Limit Check (Sliding 60s Window)
        const rateCheck = this.checkRateLimit(guildId, maxPerMin);
        if (!rateCheck.allowed) {
            return {
                allowed: false,
                reason: 'RATE_LIMIT',
                cost: 0,
                remaining: creditState.remaining,
                waitSeconds: rateCheck.waitSeconds,
                maxPerMinute: rateCheck.max
            };
        }

        // 2. Credit Balance Check
        const cost = this.getModelCreditCost(modelName);
        if (creditState.remaining < cost) {
            const now = Date.now();
            const tomorrowUtc = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1, 0, 0, 0));
            const hoursUntilReset = Math.max(1, Math.round((tomorrowUtc.getTime() - now) / (60 * 60 * 1000)));

            return {
                allowed: false,
                reason: 'OUT_OF_CREDITS',
                cost,
                remaining: creditState.remaining,
                resetInHours: hoursUntilReset
            };
        }

        // 3. Deduct credits & register rate timestamp
        creditState.remaining = Math.max(0, creditState.remaining - cost);
        creditState.used = (creditState.used || 0) + cost;
        this.recordRequest(guildId);

        // Asynchronously sync to database
        if (settings && typeof settings.save === 'function') {
            settings.aiCreditsRemaining = creditState.remaining;
            settings.aiCreditsUsed = creditState.used;
            settings.save().catch(err => {
                console.error('[AICreditManager] DB sync error:', err.message);
            });
        } else {
            try {
                const GuildSettings = require('../database/models/GuildSettings');
                await GuildSettings.update(
                    {
                        aiCreditsRemaining: creditState.remaining,
                        aiCreditsUsed: creditState.used
                    },
                    { where: { guildId } }
                ).catch(() => {});
            } catch (_) {}
        }

        return {
            allowed: true,
            cost,
            remaining: creditState.remaining,
            used: creditState.used
        };
    }

    /**
     * Get credit telemetry summary for guild dashboard
     */
    getGuildCreditInfo(guildId, settings) {
        const creditState = this.getOrInitGuildCredits(guildId, settings);
        const rateCheck = this.checkRateLimit(guildId, settings?.aiRateLimitPerMinute || creditState.rateLimitPerMinute);
        const modelName = settings?.aiModel || 'gemini-3.8-flash';
        const cost = this.getModelCreditCost(modelName);

        return {
            remaining: creditState.remaining,
            creditsRemaining: creditState.remaining,
            used: creditState.used,
            creditsUsedToday: creditState.used,
            dailyAllowance: creditState.dailyAllowance,
            dailyLimit: creditState.dailyAllowance,
            rateLimitPerMinute: settings?.aiRateLimitPerMinute || creditState.rateLimitPerMinute || DEFAULT_RATE_LIMIT_PER_MINUTE,
            requestsThisMinute: rateCheck.current,
            activeModel: modelName,
            activeModelCost: cost,
            modelCosts: this.getModelCostBreakdown()
        };
    }

    /**
     * Alias for getGuildCreditInfo consumed by /api/guilds/:guildId/analytics route
     */
    getGuildTelemetry(guildId, settings) {
        return this.getGuildCreditInfo(guildId, settings);
    }
}

module.exports = new AICreditManager();
