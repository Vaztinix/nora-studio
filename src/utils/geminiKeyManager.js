const { EmbedBuilder } = require('discord.js');

/**
 * 🔑 Gemini API Key & Multi-Pool Quota Manager
 * Automatically distributes requests, rotates keys, tracks rate/daily quotas,
 * provides accurate word-count headroom estimates, and generates live quota embeds.
 */

class GeminiKeyManager {
    constructor() {
        this.keys = [];
        this.currentIndex = 0;
        this.cooldowns = new Map(); // key -> cooldown expiry timestamp (ms)
        this.strikes = new Map();   // key -> consecutive quota strike count
        this.isDailyQuota = new Map(); // key -> boolean whether hit daily quota
        this.requestTimestamps = []; // sliding window of request timestamps
        this.totalRequestsServed = 0;
        this.totalWordsGenerated = 0;
        this.lastGlobalQuotaHit = 0;
        this.loadKeys();
    }

    loadKeys() {
        const found = new Set();

        // 1. Check GEMINI_API_KEY
        if (process.env.GEMINI_API_KEY) {
            found.add(process.env.GEMINI_API_KEY.trim());
        }

        // 2. Check numbered keys (GEMINI_API_KEY_1 to GEMINI_API_KEY_10)
        for (let i = 1; i <= 10; i++) {
            const k = process.env[`GEMINI_API_KEY_${i}`];
            if (k && k.trim()) {
                found.add(k.trim());
            }
        }

        // 3. Check comma-separated GEMINI_API_KEYS
        if (process.env.GEMINI_API_KEYS) {
            const list = process.env.GEMINI_API_KEYS.split(',').map(s => s.trim()).filter(Boolean);
            list.forEach(k => found.add(k));
        }

        this.keys = Array.from(found);
        if (this.keys.length > 1) {
            console.log(`[GeminiKeyManager] Loaded ${this.keys.length} distinct Gemini API keys in pool for quota balancing.`);
        }
    }

    /**
     * Checks if all registered keys are currently on cooldown
     * @returns {boolean}
     */
    areAllKeysOnCooldown() {
        if (this.keys.length === 0) return true;
        const now = Date.now();
        return this.keys.every(k => (this.cooldowns.get(k) || 0) > now);
    }

    /**
     * Gets the earliest timestamp when at least one key will be available again
     * @returns {number}
     */
    getEarliestResetTimestamp() {
        const now = Date.now();
        let earliest = Infinity;

        for (const k of this.keys) {
            const exp = this.cooldowns.get(k) || 0;
            if (exp > now && exp < earliest) {
                earliest = exp;
            }
        }

        if (earliest === Infinity) {
            if (this.keys.length === 0) {
                return now + 60000;
            }
            return now;
        }
        return earliest;
    }

    /**
     * Calculates time until next Pacific Time / UTC Midnight
     * @returns {number} ms until daily reset
     */
    getMsUntilDailyReset() {
        const now = new Date();
        const tomorrowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
        const diff = tomorrowUtc.getTime() - now.getTime();
        return Math.max(diff, 60000);
    }

    /**
     * Get live telemetry and quota metrics
     */
    getQuotaStats() {
        const now = Date.now();
        const totalKeys = this.keys.length;
        const available = this.getAvailableKeys();
        const activeKeys = available.length;
        const coolingDownKeys = totalKeys - activeKeys;

        // Clean rolling window requests (past 60 seconds)
        this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60000);
        const recentRequests = this.requestTimestamps.length;

        // Gemini Free Tier: 15 Requests Per Minute per project
        const maxRpmCapacity = totalKeys * 15;
        const activeRpmCapacity = activeKeys * 15;
        const requestsRemainingInWindow = Math.max(0, activeRpmCapacity - recentRequests);

        // Average output token capacity: ~300 tokens per response ≈ ~225-250 words
        const estimatedWordsAvailable = Math.max(0, requestsRemainingInWindow * 240);

        const earliestResetMs = this.getEarliestResetTimestamp();
        const earliestResetUnix = Math.floor(earliestResetMs / 1000);
        const dailyResetUnix = Math.floor((now + this.getMsUntilDailyReset()) / 1000);

        const isLowQuota = activeKeys <= 1 || coolingDownKeys > 0 || (requestsRemainingInWindow <= 5 && totalKeys > 0);

        return {
            totalKeys,
            activeKeys,
            coolingDownKeys,
            recentRequests,
            maxRpmCapacity,
            activeRpmCapacity,
            estimatedRequestsRemaining: requestsRemainingInWindow,
            estimatedWordsAvailable,
            isLowQuota,
            earliestResetMs,
            earliestResetUnix,
            dailyResetUnix,
            totalRequestsServed: this.totalRequestsServed,
            totalWordsGenerated: this.totalWordsGenerated
        };
    }

    /**
     * Generates a user-friendly message with Discord dynamic timestamp countdown
     * @returns {string}
     */
    getQuotaNotice() {
        const resetMs = this.getEarliestResetTimestamp();
        const resetUnix = Math.floor(resetMs / 1000);
        const secondsRemaining = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));

        let formattedTime;
        if (secondsRemaining > 3600) {
            const hrs = Math.floor(secondsRemaining / 3600);
            const mins = Math.floor((secondsRemaining % 3600) / 60);
            formattedTime = `${hrs}h ${mins}m`;
        } else if (secondsRemaining > 60) {
            const mins = Math.floor(secondsRemaining / 60);
            const secs = secondsRemaining % 60;
            formattedTime = `${mins}m ${secs}s`;
        } else {
            formattedTime = `${secondsRemaining}s`;
        }

        const isAnyDaily = Array.from(this.isDailyQuota.values()).some(Boolean);

        return `⏳ **Nora AI Quota Limit Reached**: My AI processing quota is currently cooling down.\n` +
               `⏱️ **Ready Again:** <t:${resetUnix}:R> (<t:${resetUnix}:t> • \`${formattedTime}\`)\n` +
               (isAnyDaily 
                   ? `📅 *Note: Daily request limit reached on upstream Gemini API. Quotas refresh at next midnight UTC window (<t:${Math.floor((Date.now() + this.getMsUntilDailyReset()) / 1000)}:R>).*` 
                   : `💡 *Keys automatically rotate and cooldowns adjust dynamically.*`);
    }

    /**
     * Generates a detailed, rich Discord Embed displaying real-time quota status, word limits, and reset times
     * @returns {EmbedBuilder}
     */
    getQuotaStatusEmbed() {
        const stats = this.getQuotaStats();

        const embed = new EmbedBuilder()
            .setTitle('✨ Nora AI Engine • Live Quota & Credit Status')
            .setColor(stats.isLowQuota ? (stats.activeKeys === 0 ? 0xEF4444 : 0xF59E0B) : 0x10B981)
            .setDescription(
                stats.activeKeys === 0
                    ? `❌ **All AI Keys Currently On Cooldown**\nNora is currently waiting for API rate limits to clear before holding new conversations.`
                    : stats.isLowQuota
                        ? `⚠️ **Low Credit / Quota Warning**: Some project keys are cooling down. Total generation headroom is restricted.`
                        : `✅ **AI Engines Fully Operational**: High-speed multi-project quota pool is healthy with full conversational capacity.`
            )
            .addFields(
                {
                    name: '🔋 Active Key Pool',
                    value: `**${stats.activeKeys} / ${stats.totalKeys}** Projects Online\n(${stats.coolingDownKeys} cooling down)`,
                    inline: true
                },
                {
                    name: '📝 Generation Headroom',
                    value: `**~${stats.estimatedWordsAvailable.toLocaleString()}** words\n(\`~${stats.estimatedRequestsRemaining}\` responses in window)`,
                    inline: true
                },
                {
                    name: '⚡ Rate Limit Capacity',
                    value: `**${stats.activeRpmCapacity}** RPM Active\n(\`${stats.recentRequests}\` used in last 60s)`,
                    inline: true
                },
                {
                    name: '⏱️ Cooldown & Recovery',
                    value: stats.coolingDownKeys > 0
                        ? `Earliest Key Ready: <t:${stats.earliestResetUnix}:R> (<t:${stats.earliestResetUnix}:t>)`
                        : `All projects ready with 0 cooldown delay.`,
                    inline: false
                },
                {
                    name: '📅 Daily Quota Window',
                    value: `Daily reset in <t:${stats.dailyResetUnix}:R> (<t:${stats.dailyResetUnix}:t>)`,
                    inline: false
                }
            )
            .setFooter({ text: 'Nora Multi-Project AI Engine • Automatic Quota Failover' })
            .setTimestamp();

        return embed;
    }

    /**
     * Get all available keys currently not in cooldown
     * @returns {string[]}
     */
    getAvailableKeys() {
        const now = Date.now();
        const available = this.keys.filter(k => {
            const expiry = this.cooldowns.get(k) || 0;
            return now >= expiry;
        });

        return available;
    }

    /**
     * Get available keys rotated in round-robin order to balance API usage across multiple projects
     * @returns {string[]}
     */
    getRotatedAvailableKeys() {
        const available = this.getAvailableKeys();
        if (available.length <= 1) return available;

        this.currentIndex = (this.currentIndex + 1) % available.length;
        return [
            ...available.slice(this.currentIndex),
            ...available.slice(0, this.currentIndex)
        ];
    }

    /**
     * Clears strikes and cooldown for a successful key and logs usage telemetry
     * @param {string} key 
     * @param {string} [generatedText]
     */
    reportSuccess(key, generatedText = '') {
        if (!key) return;
        this.strikes.set(key, 0);
        this.cooldowns.delete(key);
        this.isDailyQuota.delete(key);
        this.requestTimestamps.push(Date.now());
        this.totalRequestsServed++;

        if (generatedText) {
            const wordCount = generatedText.trim().split(/\s+/).length;
            this.totalWordsGenerated += wordCount;
        }
    }

    /**
     * Mark a key as exhausted with dynamic intelligent cooldown based on error details and consecutive strikes
     * @param {string} key 
     * @param {Error|string|number} [errorOrMs]
     */
    reportQuotaLimit(key, errorOrMs) {
        if (!key) return;

        let cooldownMs = 60000;
        let isDaily = false;

        if (typeof errorOrMs === 'number') {
            cooldownMs = errorOrMs;
        } else if (errorOrMs) {
            const errStr = typeof errorOrMs === 'string' 
                ? errorOrMs 
                : (errorOrMs.message || '') + ' ' + JSON.stringify(errorOrMs.errorDetails || errorOrMs.status || '');
            const errLower = errStr.toLowerCase();

            // 1. Check for explicit retry-after / retryDelay in seconds
            const retryMatch = errStr.match(/retry(?:Delay|After)?["':\s]+(\d+)/i) || 
                               errStr.match(/retry in (\d+)\s*s/i) || 
                               errStr.match(/after (\d+)\s*seconds/i);
            if (retryMatch) {
                const parsedSecs = parseInt(retryMatch[1], 10);
                if (!isNaN(parsedSecs) && parsedSecs > 0) {
                    cooldownMs = (parsedSecs + 2) * 1000;
                }
            } else if (errLower.includes('per day') || errLower.includes('daily') || errLower.includes('requests per day') || errLower.includes('check your plan and quota')) {
                isDaily = true;
                cooldownMs = this.getMsUntilDailyReset();
            } else {
                const curStrikes = (this.strikes.get(key) || 0) + 1;
                this.strikes.set(key, curStrikes);

                if (curStrikes === 1) {
                    cooldownMs = 60000; // 1 min
                } else if (curStrikes === 2) {
                    cooldownMs = 300000; // 5 mins
                } else if (curStrikes === 3) {
                    cooldownMs = 900000; // 15 mins
                } else {
                    cooldownMs = 1800000; // 30 mins
                }
            }
        } else {
            const curStrikes = (this.strikes.get(key) || 0) + 1;
            this.strikes.set(key, curStrikes);
            cooldownMs = curStrikes > 1 ? Math.min(curStrikes * 120000, 1800000) : 60000;
        }

        const expiry = Date.now() + cooldownMs;
        this.cooldowns.set(key, expiry);
        if (isDaily) {
            this.isDailyQuota.set(key, true);
        }
        this.lastGlobalQuotaHit = expiry;
        console.warn(`[GeminiKeyManager] Key ...${key.slice(-6)} placed on cooldown for ${Math.round(cooldownMs / 1000)}s ${isDaily ? '(Daily Quota)' : ''}.`);
    }
}

const geminiKeyManager = new GeminiKeyManager();

module.exports = geminiKeyManager;
