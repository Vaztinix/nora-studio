/**
 * 🔑 Gemini API Key & Multi-Pool Quota Manager
 * Automatically distributes requests, rotates keys, tracks rate/daily quotas,
 * and provides accurate, dynamic Discord timestamp countdowns.
 */

class GeminiKeyManager {
    constructor() {
        this.keys = [];
        this.currentIndex = 0;
        this.cooldowns = new Map(); // key -> cooldown expiry timestamp (ms)
        this.strikes = new Map();   // key -> consecutive quota strike count
        this.isDailyQuota = new Map(); // key -> boolean whether hit daily quota
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
            // Check if any key exists
            if (this.keys.length === 0) {
                return now + 60000;
            }
            // All cooldowns expired
            return now;
        }
        return earliest;
    }

    /**
     * Calculates time until next Pacific Time Midnight (when Google Cloud daily quotas reset)
     * or UTC Midnight.
     * @returns {number} ms until midnight PT
     */
    getMsUntilDailyReset() {
        const now = new Date();
        // Google Cloud quotas typically reset at midnight Pacific Time (PT / UTC-7 or UTC-8)
        // We calculate next midnight UTC for clean synchronization
        const tomorrowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
        const diff = tomorrowUtc.getTime() - now.getTime();
        return Math.max(diff, 60000);
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

        return `⏳ **Nora AI Quota Limit Reached**: My AI processing quota is currently exhausted.\n` +
               `⏱️ **Ready Again:** <t:${resetUnix}:R> (<t:${resetUnix}:t> • \`${formattedTime}\`)\n` +
               (isAnyDaily 
                   ? `📅 *Note: Daily request limit reached on upstream Gemini API. Quotas refresh at next midnight UTC window.*` 
                   : `💡 *Keys automatically rotate and cooldowns adjust dynamically.*`);
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
     * Get next round-robin key
     * @returns {string|null}
     */
    getNextKey() {
        const available = this.getAvailableKeys();
        if (available.length === 0) return null;

        this.currentIndex = (this.currentIndex + 1) % available.length;
        return available[this.currentIndex];
    }

    /**
     * Clears strikes and cooldown for a successful key
     * @param {string} key 
     */
    reportSuccess(key) {
        if (!key) return;
        this.strikes.set(key, 0);
        this.cooldowns.delete(key);
        this.isDailyQuota.delete(key);
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
                // Daily quota exceeded!
                isDaily = true;
                cooldownMs = this.getMsUntilDailyReset();
            } else {
                // Progressive backoff based on consecutive strikes
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
