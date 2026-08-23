// ─────────────────────────────────────────────────────────────────────────────
// 🛡️ Nora Reaction Role Helper & Concurrency Manager
// Prevents race conditions, flapping, and role addition/removal loops
// ─────────────────────────────────────────────────────────────────────────────

const suppressionMap = new Map();
const SUPPRESSION_TTL_MS = 10000; // 10 seconds TTL

// Clean up expired suppressions every 30s
setInterval(() => {
    const now = Date.now();
    for (const [key, expiresAt] of suppressionMap.entries()) {
        if (now > expiresAt) {
            suppressionMap.delete(key);
        }
    }
}, 30000).unref();

/**
 * Normalizes a unicode emoji string by stripping variation selectors and trimming.
 */
function normalizeEmoji(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[\ufe0e\ufe0f]/g, '').trim();
}

/**
 * Extracts numeric custom emoji ID if a full Discord tag (<:name:id> or <a:name:id>) is passed.
 */
function extractCustomEmojiId(str) {
    if (!str || typeof str !== 'string') return null;
    const match = str.match(/^<?(a)?:[a-zA-Z0-9_]+:([0-9]+)>?$/);
    return match ? match[2] : null;
}

/**
 * Checks if a Discord Reaction emoji matches a stored database emoji string.
 * Supports custom emoji IDs, emoji names, full tags, and normalized unicode.
 */
function matchesEmoji(reactionEmoji, storedEmoji) {
    if (!reactionEmoji || !storedEmoji) return false;

    const storedStr = String(storedEmoji).trim();
    const storedCustomId = extractCustomEmojiId(storedStr) || (storedStr.match(/^\d+$/) ? storedStr : null);

    // 1. Check custom emoji ID matching
    if (reactionEmoji.id) {
        if (storedCustomId && reactionEmoji.id === storedCustomId) return true;
        if (reactionEmoji.id === storedStr) return true;
        if (reactionEmoji.toString() === storedStr) return true;
        if (reactionEmoji.name && reactionEmoji.name.toLowerCase() === storedStr.toLowerCase()) return true;
    }

    // 2. Check Unicode emoji matching
    const reactionName = reactionEmoji.name ? String(reactionEmoji.name).trim() : '';
    if (reactionName) {
        if (reactionName === storedStr) return true;
        if (normalizeEmoji(reactionName) === normalizeEmoji(storedStr)) return true;
        if (reactionEmoji.toString() === storedStr) return true;
        if (normalizeEmoji(reactionEmoji.toString()) === normalizeEmoji(storedStr)) return true;
    }

    return false;
}

/**
 * Marks a reaction removal on a message as initiated by Nora (e.g. for Single-Select mode).
 * This prevents messageReactionRemove from undoing the newly granted role or sending duplicate DMs.
 */
function markSuppressed(messageId, userId, emojiKey) {
    const key = `${messageId}:${userId}:${emojiKey}`;
    suppressionMap.set(key, Date.now() + SUPPRESSION_TTL_MS);
}

/**
 * Checks and consumes the suppression status for a reaction removal.
 */
function checkAndConsumeSuppression(messageId, userId, emojiKey) {
    const key = `${messageId}:${userId}:${emojiKey}`;
    const expiresAt = suppressionMap.get(key);
    if (expiresAt && Date.now() < expiresAt) {
        suppressionMap.delete(key);
        return true;
    }
    // Also check wildcard suppression for any emoji on this message for this user (during rapid switch)
    const wildcardKey = `${messageId}:${userId}:*`;
    const wildcardExpires = suppressionMap.get(wildcardKey);
    if (wildcardExpires && Date.now() < wildcardExpires) {
        return true;
    }
    return false;
}

// ─── Per-Member Action Queue ──────────────────────────────────────────────────
// Ensures role modifications for the same user in the same guild execute sequentially,
// preventing concurrent PATCH requests and stale cache role wiping.
const memberQueues = new Map();

/**
 * Executes a role action function in a sequential per-member queue.
 */
async function enqueueRoleAction(guildId, userId, actionFn) {
    const queueKey = `${guildId}:${userId}`;
    const previousPromise = memberQueues.get(queueKey) || Promise.resolve();

    const currentPromise = previousPromise
        .catch(() => {}) // Don't allow previous error to break future actions
        .then(async () => {
            try {
                await actionFn();
            } catch (err) {
                console.error(`[Reaction Role Queue Error] (${queueKey}):`, err.message);
            }
        })
        .finally(() => {
            if (memberQueues.get(queueKey) === currentPromise) {
                memberQueues.delete(queueKey);
            }
        });

    memberQueues.set(queueKey, currentPromise);
    return currentPromise;
}

module.exports = {
    matchesEmoji,
    normalizeEmoji,
    extractCustomEmojiId,
    markSuppressed,
    checkAndConsumeSuppression,
    enqueueRoleAction
};
