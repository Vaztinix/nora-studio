/**
 * 🌐 Dynamic Conversation & Mood Sharing Hub
 * Synchronizes multi-turn conversations, active threads, and conversational mood
 * across all 3 Gemini API projects in the key pool to guarantee seamless context
 * continuity and natural conversational flow.
 */

class ConversationHub {
    constructor() {
        this.threads = new Map(); // channelId -> Array<{ speaker, text, timestamp, isBot, isStaffOnly, authorId, channelName }>
        this.moods = new Map();   // channelId -> { mood, energy, lastTopics, lastUpdated }
        this.channelStaffFlags = new Map(); // channelId -> boolean
        this.MAX_TURNS = 50; // Deep multi-turn memory
    }

    /**
     * Add a message to the shared cross-project thread with staff privacy tagging
     */
    addMessage(channelId, speaker, text, isBot = false, meta = {}) {
        if (!channelId || !text) return;
        const cid = String(channelId);
        if (!this.threads.has(cid)) {
            this.threads.set(cid, []);
        }

        const isStaffOnly = Boolean(meta.isStaffOnly);
        if (meta.isStaffOnly !== undefined) {
            this.channelStaffFlags.set(cid, isStaffOnly);
        }

        const thread = this.threads.get(cid);
        thread.push({
            speaker: isBot ? 'Nora' : speaker,
            text: text.trim(),
            timestamp: Date.now(),
            isBot,
            isStaffOnly,
            authorId: meta.authorId || null,
            channelName: meta.channelName || null
        });

        if (thread.length > this.MAX_TURNS) {
            this.threads.set(cid, thread.slice(-this.MAX_TURNS));
        }

        // Dynamically analyze and update the conversational mood for the channel
        this._updateChannelMood(cid, text, isBot);
    }

    /**
     * Get shared multi-turn dialogue context formatted for prompt injection.
     * Enforces strict staff privacy: Staff-only channel messages are NEVER leaked to non-staff channels.
     */
    getSharedThreadContext(channelId, requestingChannelIsStaffOnly = false) {
        const cid = String(channelId);
        const thread = this.threads.get(cid);
        if (!thread || thread.length === 0) return '';

        // Strict Privacy Firewall: Never share staff-only messages with public/non-staff channels
        const safeMessages = thread.filter(t => {
            if (t.isStaffOnly && !requestingChannelIsStaffOnly) return false;
            return true;
        });

        // Limit to recent 12 turns so working memory stays fresh and prevents crosstalk confusion
        const recentMessages = safeMessages.slice(-12);
        return recentMessages.map(t => `[${t.speaker}]: ${t.text}`).join('\n');
    }

    /**
     * Get active mood summary for natural adaptive tone
     */
    getChannelMoodSummary(channelId) {
        const cid = String(channelId);
        const moodData = this.moods.get(cid);
        if (!moodData) return 'Chill & Natural Discord Banter';

        return `${moodData.mood} (Energy: ${moodData.energy})`;
    }

    /**
     * Internal mood and vibe analyzer
     */
    _updateChannelMood(channelId, text, isBot) {
        if (isBot) return; // Only learn vibe from users
        const lower = text.toLowerCase();
        let mood = 'Chill & Friendly Banter';
        let energy = 'Moderate';

        // Check for specific emotional / conversational states
        if (/\b(i\s+hate\s+my\s+life|depressed|sad|crying|hopeless|hurting|grief)\b/i.test(lower)) {
            mood = 'Supportive, Deeply Empathetic & Gentle';
            energy = 'Calm & Warm';
        } else if (text === text.toUpperCase() && text.length > 8 && /[A-Z]/.test(text)) {
            mood = 'Hyped & Chaotic All-Caps Energy';
            energy = 'High / Excited';
        } else if (/\b(lmao|lol|haha|skull|💀|😭|bruh|bro|meme|roast|ratio)\b/i.test(lower)) {
            mood = 'Playful Discord Banter & Witty Humor';
            energy = 'High / Bubbly';
        } else if (/\b(how\s+to|explain|code|error|debug|syntax|how\s+do\s+i|config|setup)\b/i.test(lower)) {
            mood = 'Technical, Sharp & Helpful';
            energy = 'Focused';
        }

        this.moods.set(channelId, {
            mood,
            energy,
            lastUpdated: Date.now()
        });
    }
}

const conversationHub = new ConversationHub();
module.exports = conversationHub;
