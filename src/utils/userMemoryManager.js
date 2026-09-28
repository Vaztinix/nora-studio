const UserMemory = require('../database/models/UserMemory');

/**
 * 🧠 User Memory & Mood Distillation Manager
 * Tracks long-term user memories, facts, preferences, and interests.
 */

/**
 * Get formatted memory and profile context for a user
 * @param {string} userId 
 * @param {string} username 
 * @returns {Promise<string>}
 */
async function getUserMemoryContext(userId, username) {
    if (!userId) return '';
    try {
        const memory = await UserMemory.findOne({ where: { userId } });
        if (!memory) return '';

        let insights = [];
        try {
            insights = JSON.parse(memory.insights || '[]');
        } catch (e) {
            insights = [];
        }

        let interests = {};
        try {
            interests = JSON.parse(memory.interests || '{}');
        } catch (e) {
            interests = {};
        }

        const topInterests = Object.entries(interests)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([topic]) => topic);

        const lines = [];
        if (insights.length > 0) {
            lines.push(`- Known facts / memories about ${username}: ${insights.slice(-8).join('; ')}`);
        }
        if (topInterests.length > 0) {
            lines.push(`- Frequent topics of interest: ${topInterests.join(', ')}`);
        }

        return lines.join('\n');
    } catch (e) {
        console.error('[UserMemoryManager] Failed to fetch memory context:', e.message);
        return '';
    }
}

/**
 * Learn and distill facts/interests from user message
 * @param {string} userId 
 * @param {string} content 
 */
async function updateUserMemory(userId, content) {
    if (!userId || !content || content.length < 3) return;

    try {
        const [memory] = await UserMemory.findOrCreate({ where: { userId } });
        let insights = [];
        try {
            insights = JSON.parse(memory.insights || '[]');
        } catch (e) {
            insights = [];
        }

        let interests = {};
        try {
            interests = JSON.parse(memory.interests || '{}');
        } catch (e) {
            interests = {};
        }

        const lower = content.toLowerCase().trim();

        // 1. Topic detection
        const topics = {
            gaming: ['play', 'game', 'cs2', 'valorant', 'roblox', 'minecraft', 'steam', 'fps', 'rpg'],
            coding: ['code', 'error', 'dev', 'bot', 'javascript', 'python', 'api', 'bug', 'git'],
            music: ['song', 'music', 'album', 'listen', 'spotify', 'track', 'artist'],
            anime: ['anime', 'manga', 'watch', 'episode', 'series'],
            tech: ['pc', 'gpu', 'ram', 'cpu', 'hardware', 'server', 'linux', 'windows']
        };

        for (const [topic, keywords] of Object.entries(topics)) {
            if (keywords.some(kw => lower.includes(kw))) {
                interests[topic] = (interests[topic] || 0) + 1;
            }
        }

        // 2. Explicit memory captures ("remember that...", "don't forget that...")
        const rememberMatch = content.match(/(?:remember that|remember|don't forget that|dont forget that|keep in mind that)\s+(.+?)(?=[.!?\n]|$)/i);
        if (rememberMatch && rememberMatch[1]) {
            const rawFact = rememberMatch[1].trim().replace(/^[:,\s]+/, '');
            if (rawFact.length >= 3 && rawFact.length <= 120) {
                const cleanedFact = `Note: ${rawFact}`;
                if (!insights.includes(cleanedFact)) {
                    insights.push(cleanedFact);
                }
            }
        }

        // 3. Self-identification & preferences ("my name is...", "i love...", "i hate...", "my favorite...")
        const nameMatch = content.match(/\b(?:my name is|call me|i'm called|im called)\s+([A-Za-z0-9_]{2,20})\b/i);
        if (nameMatch && nameMatch[1] && !['nora', 'a', 'the', 'who', 'what', 'not', 'bot'].includes(nameMatch[1].toLowerCase().trim())) {
            const nameFact = `Name is ${nameMatch[1].trim()}`;
            if (!insights.some(i => i.startsWith('Name is'))) {
                insights.push(nameFact);
            }
        }

        const favMatch = content.match(/\b(?:my favorite|my fav)\s+([a-z0-9_ -]{2,20}?)\s+is\s+([a-z0-9_ -]{2,30}?)(?=[.,!?\n]| and |$)/i);
        if (favMatch && favMatch[1] && favMatch[2]) {
            const favFact = `Favorite ${favMatch[1].trim()}: ${favMatch[2].trim()}`;
            if (!insights.includes(favFact)) {
                insights.push(favFact);
            }
        }

        const sentimentMatch = content.match(/\b(?:i really love|i love|i really hate|i hate)\s+([^.,!?\n]{2,40})/i);
        if (sentimentMatch && sentimentMatch[0] && !content.toLowerCase().includes('you')) {
            const sentimentFact = sentimentMatch[0].trim();
            if (!insights.includes(sentimentFact) && sentimentFact.length < 50) {
                insights.push(sentimentFact);
            }
        }

        // Keep insights bounded (max 12 recent items)
        if (insights.length > 12) {
            insights = insights.slice(insights.length - 12);
        }

        memory.insights = JSON.stringify(insights);
        memory.interests = JSON.stringify(interests);
        memory.lastInteracted = new Date();
        await memory.save();
    } catch (e) {
        console.error('[UserMemoryManager] Update failed:', e.message);
    }
}

module.exports = {
    getUserMemoryContext,
    updateUserMemory
};
