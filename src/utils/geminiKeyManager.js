/**
 * 🔑 Gemini API Key & Multi-Pool Quota Manager
 * Automatically distributes requests and rotates keys upon encountering 429 / Quota limits.
 * Provides real-time countdown timers until quota resets.
 */

class GeminiKeyManager {
    constructor() {
        this.keys = [];
        this.currentIndex = 0;
        this.cooldowns = new Map(); // key -> cooldown expiry timestamp
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
            return now + 60000;
        }
        return earliest;
    }

    /**
     * Generates a user-friendly message with Discord dynamic timestamp countdown
     * @returns {string}
     */
    getQuotaNotice() {
        const resetMs = this.getEarliestResetTimestamp();
        const resetUnix = Math.floor(resetMs / 1000);
        const secondsRemaining = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));

        return `⏳ **AI Quota Limit Reached**: I am currently out of AI processing quota.\n⏱️ **Quota Resets:** <t:${resetUnix}:R> (\`${secondsRemaining}s\`)`;
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
     * Mark a key as exhausted with a cooldown period (default 60 seconds)
     * @param {string} key 
     * @param {number} cooldownMs 
     */
    reportQuotaLimit(key, cooldownMs = 60000) {
        if (!key) return;
        const expiry = Date.now() + cooldownMs;
        this.cooldowns.set(key, expiry);
        this.lastGlobalQuotaHit = expiry;
        console.warn(`[GeminiKeyManager] Key ...${key.slice(-6)} placed on cooldown for ${Math.round(cooldownMs / 1000)}s due to quota limit.`);
    }
}

const geminiKeyManager = new GeminiKeyManager();

module.exports = geminiKeyManager;
