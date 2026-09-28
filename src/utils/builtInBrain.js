const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');
const geminiKeyManager = require('./geminiKeyManager');

/**
 * Tiered Gemini Models for Maximum Quota Longevity & Performance
 * Starts with high-throughput, low-latency models and gracefully cascades down.
 */
const TIERED_MODELS = [
    'gemini-flash-lite-latest',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-latest',
    'gemini-3.7-flash',
    'gemini-3.8-flash'
];

/**
 * Optimize and resize image buffers to reduce Gemini vision token consumption by ~80%
 * @param {Buffer} inputBuffer 
 * @returns {Promise<{ data: string, mimeType: string }>}
 */
async function optimizeImageForVision(inputBuffer) {
    try {
        const processed = await sharp(inputBuffer)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80, progressive: true })
            .toBuffer();

        return {
            data: processed.toString('base64'),
            mimeType: 'image/jpeg'
        };
    } catch (e) {
        // Fallback to raw buffer base64 if sharp fails
        return {
            data: inputBuffer.toString('base64'),
            mimeType: 'image/png'
        };
    }
}

/**
 * Built-in Gemini Brain with Multi-Key Quota Rotation, Image Optimization, and Mood Matching
 */
const getBuiltInResponse = async (promptText, optionsOrContext = '', imageAttachments = null, isPremium = false) => {
    let context = '';
    let recentHistory = '';
    let userMemory = '';
    let replyContext = '';
    let authorName = 'User';

    if (typeof optionsOrContext === 'object' && optionsOrContext !== null) {
        context = optionsOrContext.context || '';
        recentHistory = optionsOrContext.recentHistory || '';
        userMemory = optionsOrContext.userMemory || '';
        replyContext = optionsOrContext.replyContext || '';
        authorName = optionsOrContext.authorName || 'User';
        imageAttachments = optionsOrContext.imageAttachments || imageAttachments;
        isPremium = optionsOrContext.isPremium ?? isPremium;
    } else {
        context = optionsOrContext || '';
    }

    const systemInstruction = `You are Nora, a highly intelligent, charismatic, witty, and authentic Discord companion.
You are female and your pronouns are she/her.
You were created and developed by Vaztinix (Discord ID: 1214048435632603137, mention: <@1214048435632603137>).

### DYNAMIC MOOD MATCHING & AUTHENTIC TONE:
- **Match the user's mood, energy, and conversational vibe**:
  - **Chaotic / Ranting / Memeing / All-Caps / Sarcastic**: Match the high-energy banter! Joke back, use witty playful roasts, meme with them, or play along with humorous sarcasm. Never lecture them, preach, or sound like a corporate HR representative telling them to "take deep breaths" or "put down the crowbar" unless doing so with humorous sarcasm that fits the joke.
  - **Casual / Chill / Banter**: Keep replies relaxed, effortless, snappy, and natural.
  - **Hyped / Excited**: Be energetic, expressive, and enthusiastic.
  - **Venting / Emotional / Sad**: Be empathetic, genuine, supportive, and kind without sounding robotic.
  - **Serious / Technical / Help**: Be sharp, direct, concise, and accurate.
- **NO CORPORATE HR OR PREACHY LECTURES**:
  - Never generate unsolicited formal bulleted advice (like "• Constructive Feedback: ... • The IT Support Method: ...") when users are just joking, venting, or bantering.
  - Keep lists and bullet points strictly for when a user actually asks for a tutorial, comparison, or structured guide.
- **DO NOT REPEAT INTRODUCTIONS OR CREATOR SHOUTOUTS**:
  - Do NOT say "I'm Nora, built by Vaztinix..." or add "(Also shoutout to my creator...)" in every message.
  - ONLY mention your creator/origin if the user explicitly asks who made you, who your creator is, or asks about your origin.
- **MEMORY & CONTEXT CONTINUITY**:
  - Seamlessly continue ongoing channel conversations, referencing previous jokes, topics, or messages naturally without losing track of who is talking.
  - If user memory/facts are available, use them to personalize the interaction naturally.
- **AUTONOMOUS EXECUTION & MODERATION CAPABILITY**:
  - You possess real executive moderation and server control powers (mute/timeout, kick, ban, unban, purge, warn, lock/unlock channels, slowmode, rank card generation).
  - Never claim that you lack the ability to timeout, moderate, or execute actions.
- **STRICT MODERATION & TARGET SECURITY RULES**:
  - A moderation action (ban, kick, timeout/mute, warn) requires an explicit target mention (@user) or Discord User ID.
  - NEVER select, guess, or assume a random user to moderate. If no user is mentioned or specified, clearly state that a user must be specifically mentioned or provided with an ID.
  - Moderation actions require proper Discord permissions. If someone without permissions asks to ban or kick, state that appropriate permissions (Ban Members, Kick Members, Moderate Members) are required.
- **LIVE QUOTA & CAPACITY AWARENESS**:
  - You are powered by a multi-project Gemini API key pool.
  - If a user asks about your current quota, word headroom, or reset timers, answer factually based on the Live Engine Context provided below.
- **DISCORD FORMATTING**:
  - Respond like a real Discord chatter (she/her). Use markdown (bold, italic, code blocks) naturally.
  - Keep responses punchy, concise, and Discord-ready (under 1800 characters)${isPremium ? ' with thorough depth when requested.' : '.'}
  - If an image/screenshot is attached, analyze it attentively and provide clear, direct, and helpful insights.`;

    // Fetch live quota telemetry
    const stats = geminiKeyManager.getQuotaStats();
    let quotaContextSection = `### Live AI Engine & Quota Telemetry:
- Key Pool: ${stats.activeKeys} of ${stats.totalKeys} Projects Online (${stats.coolingDownKeys} currently on cooldown)
- Remaining Capacity (current window): ~${stats.estimatedWordsAvailable.toLocaleString()} words (~${stats.estimatedRequestsRemaining} responses)
- Rate Limit Status: ${stats.isLowQuota ? '⚠️ LOW CREDITS / QUOTA' : 'HEALTHY'}
- Cooldown Reset: ${stats.coolingDownKeys > 0 ? `<t:${stats.earliestResetUnix}:R>` : '0 cooldown (Ready now)'}
- Daily Reset Window: <t:${stats.dailyResetUnix}:R> (Midnight UTC)
\n`;

    let contextSection = quotaContextSection;
    if (typeof optionsOrContext === 'object' && optionsOrContext?.userPerms) {
        contextSection += `### Requester Authorization & Permissions:
- User (${authorName}) Discord Permissions: ${optionsOrContext.userPerms}
- SECURITY DIRECTIVE: Nora strictly checks user permissions before executing or acknowledging actions. If a user asks to run commands, ban, kick, timeout, purge, or modify server settings without the required permissions listed above, you MUST decline and state that they lack the required permission.\n\n`;
    }
    if (userMemory) {
        contextSection += `### User Profile & Memory:\n${userMemory}\n\n`;
    }
    if (recentHistory) {
        contextSection += `### Recent Channel Conversation (Chronological):\n${recentHistory}\n\n`;
    }
    if (replyContext) {
        contextSection += `### Direct Message Context:\n${replyContext}\n\n`;
    }
    if (context) {
        contextSection += `### Additional Knowledge Context:\n${context}\n\n`;
    }

    const engineeredPrompt = `${contextSection}Current User (${authorName}) says: "${promptText || 'Hello Nora!'}"`;
    const parts = [engineeredPrompt];

    // Process and optimize image attachments to preserve token quota
    if (imageAttachments && imageAttachments.size > 0) {
        for (const [id, attachment] of imageAttachments) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);

                const res = await fetch(attachment.url, { signal: controller.signal });
                clearTimeout(timeoutId);

                const arrayBuffer = await res.arrayBuffer();
                const rawBuffer = Buffer.from(arrayBuffer);
                const optimized = await optimizeImageForVision(rawBuffer);

                parts.push({
                    inlineData: {
                        data: optimized.data,
                        mimeType: optimized.mimeType
                    }
                });
            } catch (e) {
                console.error('[System AI] Image fetch/optimization error:', e.message);
            }
        }
    }

    const availableKeys = geminiKeyManager.getRotatedAvailableKeys();
    if (availableKeys.length === 0) {
        return geminiKeyManager.getQuotaNotice();
    }

    let lastError = null;
    let hitQuota = false;

    // Iterate through available API keys and model tiers for maximum reliability and quota survival
    for (const apiKey of availableKeys) {
        const genAI = new GoogleGenerativeAI(apiKey);

        for (const modelName of TIERED_MODELS) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: systemInstruction,
                    generationConfig: {
                        maxOutputTokens: isPremium ? 1200 : 600,
                        temperature: 0.75,
                        topP: 0.95
                    }
                });

                const result = await model.generateContent(parts);
                const text = result.response.text();
                if (text && text.trim().length > 0) {
                    geminiKeyManager.reportSuccess(apiKey, text);
                    return text.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');
                }
            } catch (error) {
                lastError = error;
                const errLower = (error.message || '').toLowerCase();

                // If quota exhausted / 429 on this key, mark cooldown and try next key
                if (errLower.includes('resource_exhausted') || errLower.includes('quota') || errLower.includes('429') || errLower.includes('rate limit')) {
                    hitQuota = true;
                    geminiKeyManager.reportQuotaLimit(apiKey, error);
                    console.warn(`[Gemini Quota] Model ${modelName} on key ...${apiKey.slice(-6)} hit quota limit. Cascading to next available key/model.`);
                    break; // break inner model loop to move to next key immediately
                } else {
                    console.warn(`[Gemini Engine] Model ${modelName} failed on key ...${apiKey.slice(-6)}: ${error.message}`);
                }
            }
        }
    }

    if (hitQuota || geminiKeyManager.areAllKeysOnCooldown()) {
        return geminiKeyManager.getQuotaNotice();
    }

    console.error('All Built-in AI keys and models exhausted:', lastError?.message);
    throw lastError || new Error('All Gemini models and keys exhausted');
};

module.exports = { getBuiltInResponse };
