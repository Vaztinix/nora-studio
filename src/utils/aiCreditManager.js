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
        this._schedulerStarted = false;
        this.startDailyResetScheduler();
    }

    /**
     * Start automatic periodic rollover check (every 5 minutes)
     */
    startDailyResetScheduler() {
        if (this._schedulerStarted) return;
        this._schedulerStarted = true;

        const runCheck = async () => {
            try {
                await this.performDailyRolloverCheck();
            } catch (err) {
                console.error('[AICreditManager] Scheduled rollover error:', err.message);
            }
        };

        // Run initial check shortly after startup
        setTimeout(runCheck, 3000);
        this._schedulerInterval = setInterval(runCheck, 5 * 60 * 1000);
    }

    /**
     * Scan database and perform 00:00 UTC daily replenishment for all guilds
     */
    async performDailyRolloverCheck() {
        try {
            const GuildSettings = require('../database/models/GuildSettings');
            const settingsCache = require('./settingsCache');
            const { Op } = require('sequelize');

            const now = new Date();
            const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

            const outdatedGuilds = await GuildSettings.findAll({
                where: {
                    [Op.or]: [
                        { aiLastCreditReset: null },
                        { aiLastCreditReset: { [Op.lt]: startOfTodayUtc } }
                    ]
                }
            });

            if (!outdatedGuilds || outdatedGuilds.length === 0) return 0;

            let resetCount = 0;
            for (const gs of outdatedGuilds) {
                const allowance = gs.aiDailyCreditLimit || DEFAULT_DAILY_ALLOWANCE;
                const currentRemaining = gs.aiCreditsRemaining !== undefined && gs.aiCreditsRemaining !== null 
                    ? gs.aiCreditsRemaining 
                    : allowance;
                // If guild has less than daily allowance, restore to allowance.
                // If owner gifted bonus credits (> allowance), preserve their bonus!
                const newRemaining = Math.max(allowance, currentRemaining);

                await GuildSettings.update(
                    {
                        aiCreditsRemaining: newRemaining,
                        aiCreditsUsed: 0,
                        aiLastCreditReset: now
                    },
                    { where: { guildId: gs.guildId } }
                ).catch(err => console.error(`[AICreditManager] Failed to rollover guild ${gs.guildId}:`, err.message));

                if (this.guildCreditCache.has(gs.guildId)) {
                    const cached = this.guildCreditCache.get(gs.guildId);
                    cached.remaining = newRemaining;
                    cached.used = 0;
                    cached.dailyAllowance = allowance;
                    cached.lastReset = now.getTime();
                }

                settingsCache.invalidate(gs.guildId);
                resetCount++;
            }

            console.log(`[AICreditManager] Daily credit rollover synchronized for ${resetCount} guild(s).`);
            return resetCount;
        } catch (e) {
            console.error('[AICreditManager] Rollover query failed:', e.message);
            return 0;
        }
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

        // Determine if 24h passed or a new UTC day has dawned
        let isNewDay = false;
        let lastResetTime = 0;

        if (!settings?.aiLastCreditReset) {
            // Null in database -> trigger reset immediately!
            isNewDay = true;
        } else {
            const parsed = new Date(settings.aiLastCreditReset).getTime();
            if (isNaN(parsed) || parsed <= 0) {
                isNewDay = true;
            } else {
                lastResetTime = parsed;
                const lastDate = new Date(parsed);
                const nowDate = new Date(now);
                isNewDay = (now - parsed >= 24 * 60 * 60 * 1000) || 
                    (nowDate.getUTCFullYear() !== lastDate.getUTCFullYear()) ||
                    (nowDate.getUTCMonth() !== lastDate.getUTCMonth()) ||
                    (nowDate.getUTCDate() !== lastDate.getUTCDate());
            }
        }

        if (!cached || isNewDay) {
            const currentBalance = cached?.remaining !== undefined 
                ? cached.remaining 
                : (settings?.aiCreditsRemaining !== undefined ? settings.aiCreditsRemaining : dailyAllowance);
            
            // On daily reset, replenish up to dailyAllowance. Preserve bonus credits if balance > dailyAllowance.
            const remaining = isNewDay ? Math.max(dailyAllowance, currentBalance) : currentBalance;
            const used = isNewDay ? 0 : (settings?.aiCreditsUsed || 0);

            cached = {
                remaining: Math.max(0, remaining),
                used: Math.max(0, used),
                dailyAllowance,
                lastReset: isNewDay ? now : lastResetTime,
                rateLimitPerMinute: settings?.aiRateLimitPerMinute || DEFAULT_RATE_LIMIT_PER_MINUTE
            };

            this.guildCreditCache.set(guildId, cached);

            if (isNewDay) {
                try {
                    const GuildSettings = require('../database/models/GuildSettings');
                    const settingsCache = require('./settingsCache');
                    GuildSettings.update(
                        {
                            aiCreditsRemaining: cached.remaining,
                            aiCreditsUsed: 0,
                            aiLastCreditReset: new Date(now)
                        },
                        { where: { guildId } }
                    ).catch(e => console.error('[AICreditManager] Failed to persist reset:', e.message));

                    if (settings) {
                        settings.aiCreditsRemaining = cached.remaining;
                        settings.aiCreditsUsed = 0;
                        settings.aiLastCreditReset = new Date(now);
                    }
                    settingsCache.invalidate(guildId);
                } catch (err) {
                    console.error('[AICreditManager] Reset persistence exception:', err.message);
                }
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
     * Add bonus credits directly to a guild's remaining balance.
     * Does NOT update the daily limit; only adds credits and allows it to go over the 1k limit.
     * @param {string} guildId 
     * @param {number} amount 
     */
    async addCredits(guildId, amount) {
        const parsed = parseInt(amount, 10);
        if (isNaN(parsed) || parsed <= 0) {
            throw new Error('Credit amount must be a positive number.');
        }

        const GuildSettings = require('../database/models/GuildSettings');
        const settingsCache = require('./settingsCache');

        let settings = await settingsCache.get(guildId);
        const currentRemaining = settings?.aiCreditsRemaining !== undefined ? settings.aiCreditsRemaining : DEFAULT_DAILY_ALLOWANCE;
        const newRemaining = Math.max(0, currentRemaining + parsed);

        await GuildSettings.update(
            { aiCreditsRemaining: newRemaining },
            { where: { guildId } }
        );

        if (this.guildCreditCache.has(guildId)) {
            const cached = this.guildCreditCache.get(guildId);
            cached.remaining = newRemaining;
        }

        settingsCache.invalidate(guildId);

        return {
            guildId,
            previousRemaining: currentRemaining,
            newRemaining,
            added: parsed,
            dailyLimit: settings?.aiDailyCreditLimit || DEFAULT_DAILY_ALLOWANCE
        };
    }

    /**
     * Manually expand or adjust a guild's daily credit limit.
     * @param {string} guildId 
     * @param {number} newLimit 
     */
    async setDailyLimit(guildId, newLimit) {
        const parsed = parseInt(newLimit, 10);
        if (isNaN(parsed) || parsed < 0) {
            throw new Error('Daily limit must be a non-negative number.');
        }

        const GuildSettings = require('../database/models/GuildSettings');
        const settingsCache = require('./settingsCache');

        let settings = await settingsCache.get(guildId);
        const currentRemaining = settings?.aiCreditsRemaining !== undefined ? settings.aiCreditsRemaining : DEFAULT_DAILY_ALLOWANCE;
        // If current credits are lower than the new expanded limit, replenish immediately
        const updatedRemaining = Math.max(currentRemaining, parsed);

        await GuildSettings.update(
            { 
                aiDailyCreditLimit: parsed,
                aiCreditsRemaining: updatedRemaining
            },
            { where: { guildId } }
        );

        if (this.guildCreditCache.has(guildId)) {
            const cached = this.guildCreditCache.get(guildId);
            cached.dailyAllowance = parsed;
            cached.remaining = updatedRemaining;
        }

        settingsCache.invalidate(guildId);

        return {
            guildId,
            previousLimit: settings?.aiDailyCreditLimit || DEFAULT_DAILY_ALLOWANCE,
            newLimit: parsed,
            creditsRemaining: updatedRemaining
        };
    }

    /**
     * Force disable or enable AI usage for a guild.
     * @param {string} guildId 
     * @param {boolean} enabled 
     */
    async setAiEnabled(guildId, enabled) {
        const GuildSettings = require('../database/models/GuildSettings');
        const settingsCache = require('./settingsCache');

        const isEnabled = Boolean(enabled);

        await GuildSettings.update(
            { noraAiEnabled: isEnabled },
            { where: { guildId } }
        );

        settingsCache.invalidate(guildId);

        return {
            guildId,
            noraAiEnabled: isEnabled
        };
    }

    /**
     * Manually reset a guild's credits back to full daily allowance immediately.
     * @param {string} guildId 
     */
    async resetGuildCredits(guildId) {
        const GuildSettings = require('../database/models/GuildSettings');
        const settingsCache = require('./settingsCache');

        const settings = await settingsCache.get(guildId);
        const dailyAllowance = settings?.aiDailyCreditLimit || DEFAULT_DAILY_ALLOWANCE;
        const now = new Date();

        await GuildSettings.update(
            {
                aiCreditsRemaining: dailyAllowance,
                aiCreditsUsed: 0,
                aiLastCreditReset: now
            },
            { where: { guildId } }
        );

        if (this.guildCreditCache.has(guildId)) {
            const cached = this.guildCreditCache.get(guildId);
            cached.remaining = dailyAllowance;
            cached.used = 0;
            cached.dailyAllowance = dailyAllowance;
            cached.lastReset = now.getTime();
        }

        settingsCache.invalidate(guildId);

        return {
            guildId,
            remaining: dailyAllowance,
            used: 0,
            dailyLimit: dailyAllowance,
            lastReset: now
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
