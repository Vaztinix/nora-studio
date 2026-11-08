const geminiKeyManager = require('./geminiKeyManager');
const { ensureCleanSentenceEnding } = require('./sentenceSanitizer');

/**
 * AI Feature Enhancer powered strictly by Google Gemini models.
 * Enhances Counting, Games, Starboard, AFK, and Leveling with dynamic AI commentary, roasts, and briefings.
 */
class AIFeatureEnhancer {
    /**
     * Executes a fast Google Gemini completion with multi-key rotation and safety fallback.
     */
    static async generateGeminiSnippet(prompt, maxTokens = 60) {
        const fetchPromise = (async () => {
            try {
                const keys = geminiKeyManager.getRotatedAvailableKeys();
                if (!keys || keys.length === 0) return null;

                // Prioritize ultra-lightweight, high-throughput official Gemini models
                const models = [
                    'gemini-2.0-flash-lite',
                    'gemini-1.5-flash-8b',
                    'gemini-2.0-flash',
                    'gemini-1.5-flash'
                ];

                for (const apiKey of keys) {
                    for (const model of models) {
                        try {
                            const controller = new AbortController();
                            const timer = setTimeout(() => controller.abort(), 4000); // 4s max per attempt
                            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                            const isThinkingModel = model.includes('2.5') || model.includes('3.') || model.includes('3-');
                            const generationConfig = {
                                maxOutputTokens: Math.min(Math.max(maxTokens, 60), 160),
                                temperature: 0.85
                            };
                            if (isThinkingModel) {
                                generationConfig.thinkingConfig = { thinkingBudget: 0 };
                            }

                            const res = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                signal: controller.signal,
                                body: JSON.stringify({
                                    contents: [{ role: 'user', parts: [{ text: `${prompt} Must be a fully completed sentence with proper terminal punctuation. Never cut off mid-sentence.` }] }],
                                    generationConfig
                                })
                            });
                            clearTimeout(timer);

                            if (res.ok) {
                                const data = await res.json();
                                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                                if (text && text.trim()) {
                                    geminiKeyManager.reportSuccess(apiKey, text);
                                    const cleaned = text.trim().replace(/^["']|["']$/g, '');
                                    return ensureCleanSentenceEnding(cleaned);
                                }
                            } else if (res.status === 429) {
                                geminiKeyManager.reportQuotaLimit(apiKey, new Error(`HTTP 429 on ${model}`));
                                break; // cascade to next available key
                            }
                        } catch (e) {
                            continue;
                        }
                    }
                }
                return null;
            } catch (err) {
                return null;
            }
        })();

        // Hard 8-second ceiling to guarantee execution falls back cleanly
        return Promise.race([
            fetchPromise,
            new Promise(resolve => setTimeout(() => resolve(null), 8000))
        ]);
    }

    /**
     * Generates a playful AI roast when someone breaks a counting streak.
     */
    static async getCountingRoast(authorName, input, expected, streak) {
        const prompt = `You are Nora, a witty Discord AI. A user named "${authorName}" just broke a server counting streak of ${streak}. They typed "${input}" when the next number was ${expected}. Write a short, funny, playful 1-sentence roast teasing them about their math skills. Do NOT use profanity or slurs. Max 20 words.`;
        const aiResponse = await this.generateGeminiSnippet(prompt, 45);
        if (aiResponse && aiResponse.trim().length > 0) return aiResponse.trim();
        // If AI does not generate or is unavailable, do not use presets
        return null;
    }

    /**
     * Generates an exciting AI cheer when a counting milestone is reached.
     */
    static async getCountingCheer(authorName, milestone) {
        const prompt = `You are Nora, a cheerful Discord AI. A user named "${authorName}" just hit a massive server counting milestone of ${milestone}! Write an exciting, hype 1-sentence cheer congratulating them and the server. Max 20 words.`;
        const aiResponse = await this.generateGeminiSnippet(prompt, 45);
        if (aiResponse && aiResponse.trim().length > 0) return aiResponse.trim();
        // If AI does not generate or is unavailable, do not use presets
        return null;
    }

    /**
     * Generates a witty AI commentary snippet for a message starred to starboard.
     */
    static async getStarboardCommentary(authorName, messageSnippet, starCount, replyContext = '') {
        if (!messageSnippet || messageSnippet.trim().length < 2) return null;
        const lower = messageSnippet.toLowerCase();
        if (lower.includes('blacklist') || lower.includes('server notice') || lower.includes('terms of service') || lower.includes('community guidelines') || lower.includes('investigation') || lower.includes('safety-security') || lower.includes('raid alert') || lower.includes('warning') || lower.includes('incident')) {
            return null; // Tone protection: never generate comedic commentary for serious administrative/safety notices
        }
        const cleanSnippet = messageSnippet.replace(/\n+/g, ' ').slice(0, 180);
        const replyPart = replyContext ? ` (${replyContext.slice(0, 80)})` : '';
        const prompt = `You are Nora, a witty and entertaining Discord bot. A message by "${authorName}"${replyPart} just earned ${starCount} stars and was inducted into the Starboard hall of fame!
Message: "${cleanSnippet}"
Write a witty, clever 1-sentence commentary or compliment explaining why this message is iconic. Keep it entertaining and concise. Maximum 25 words.`;
        const aiResponse = await this.generateGeminiSnippet(prompt, 50);
        if (aiResponse && aiResponse.trim().length > 0) return aiResponse.trim();

        // User directive: "if the AI does not work don't use it. These are just presets."
        // NEVER return static or comedy presets if AI fails or is offline
        return null;
    }

    /**
     * Generates a celebratory title / accolade when someone reaches a milestone level.
     */
    static async getLevelUpAccolade(username, level) {
        const prompt = `You are Nora, an enthusiastic Discord AI companion. A member named "${username}" just leveled up to Level ${level}! Write a cool, inspiring 1-sentence title or cheer celebrating their dedication. Max 20 words.`;
        const aiResponse = await this.generateGeminiSnippet(prompt, 45);
        if (aiResponse && aiResponse.trim().length > 0) return aiResponse.trim();
        return null;
    }

    /**
     * Generates playful banter after an RPS or Guess game.
     */
    static async getGameBanter(gameName, outcome, username) {
        const prompt = `You are Nora, a playful Discord AI bot. You just played ${gameName} against "${username}". The outcome was: Nora ${outcome}. Write a short, funny, 1-sentence reaction to the result. Max 20 words.`;
        const aiResponse = await this.generateGeminiSnippet(prompt, 45);
        if (aiResponse && aiResponse.trim().length > 0) return aiResponse.trim();
        return null;
    }
}

module.exports = AIFeatureEnhancer;
