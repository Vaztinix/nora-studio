const geminiKeyManager = require('./geminiKeyManager');

/**
 * AI Feature Enhancer powered strictly by Google Gemini models.
 * Enhances Counting, Games, Starboard, and Leveling with dynamic AI commentary, roasts, and praise.
 */
class AIFeatureEnhancer {
    /**
     * Executes a fast Google Gemini completion with key rotation and safety fallback.
     */
    static async generateGeminiSnippet(prompt, maxTokens = 60) {
        try {
            const keys = geminiKeyManager.getRotatedAvailableKeys();
            if (!keys || keys.length === 0) return null;

            const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
            const apiKey = keys[0];

            for (const model of models) {
                try {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ role: 'user', parts: [{ text: prompt }] }],
                            generationConfig: {
                                maxOutputTokens: maxTokens,
                                temperature: 0.85
                            }
                        })
                    });

                    if (res.ok) {
                        const data = await res.json();
                        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text && text.trim()) {
                            return text.trim().replace(/^["']|["']$/g, '');
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    /**
     * Generates a playful AI roast when someone breaks a counting streak.
     */
    static async getCountingRoast(authorName, input, expected, streak) {
        const prompt = `You are Nora, a witty Discord AI. A user named "${authorName}" just broke a server counting streak of ${streak}. They typed "${input}" when the next number was ${expected}. Write a short, funny, playful 1-sentence roast teasing them about their math skills. Do NOT use profanity or slurs. Max 20 words.`;
        const aiResponse = await this.generateGeminiSnippet(prompt, 45);
        if (aiResponse) return aiResponse;

        const fallbacks = [
            `I knew math was tough, but counting by 1s shouldn't be the final boss!`,
            `The number was right there, yet you chose chaos.`,
            `Did your keyboard autocorrect a number into sheer tragedy?`,
            `Rest in peace to that streak. We were so close to greatness!`
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    /**
     * Generates an exciting AI cheer when a counting milestone is reached.
     */
    static async getCountingCheer(authorName, milestone) {
        const prompt = `You are Nora, a cheerful Discord AI. A user named "${authorName}" just hit a massive server counting milestone of ${milestone}! Write an exciting, hype 1-sentence cheer congratulating them and the server. Max 20 words.`;
        const aiResponse = await this.generateGeminiSnippet(prompt, 45);
        if (aiResponse) return aiResponse;

        const fallbacks = [
            `Incredible focus! Teamwork makes the dream work — onward to the next record!`,
            `History in the making! Keep this energy going!`,
            `Flawless rhythm from the crew! You love to see it!`
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    /**
     * Generates a witty AI commentary snippet for a message starred to starboard.
     */
    static async getStarboardCommentary(authorName, messageSnippet, starCount) {
        if (!messageSnippet || messageSnippet.trim().length < 3) return null;
        const cleanSnippet = messageSnippet.replace(/\n+/g, ' ').slice(0, 150);
        const prompt = `You are Nora, a witty Discord bot. A message by "${authorName}" got pinned to Starboard with ${starCount} stars! Message: "${cleanSnippet}". Write a witty, clever 1-sentence commentary or compliment explaining why this message is iconic. Max 25 words.`;
        const aiResponse = await this.generateGeminiSnippet(prompt, 50);
        if (aiResponse) return aiResponse;

        const fallbacks = [
            `Framed in the server hall of fame where it rightfully belongs.`,
            `Pure comedy gold — the council has voted and approved!`,
            `Instant classic. Truly a certified community moment.`
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    /**
     * Generates a celebratory title / accolade when someone reaches a milestone level.
     */
    static async getLevelUpAccolade(username, level) {
        const prompt = `You are Nora, an enthusiastic Discord AI companion. A member named "${username}" just leveled up to Level ${level}! Write a cool, inspiring 1-sentence title or cheer celebrating their dedication. Max 20 words.`;
        const aiResponse = await this.generateGeminiSnippet(prompt, 45);
        if (aiResponse) return aiResponse;

        const fallbacks = [
            `Ascending through the ranks like a true server legend!`,
            `Unstoppable momentum! The chatter crown is yours.`,
            `Dedication paying off in real-time. Keep shining!`
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    /**
     * Generates playful banter after an RPS or Guess game.
     */
    static async getGameBanter(gameName, outcome, username) {
        const prompt = `You are Nora, a playful Discord AI bot. You just played ${gameName} against "${username}". The outcome was: Nora ${outcome}. Write a short, funny, 1-sentence reaction to the result. Max 20 words.`;
        const aiResponse = await this.generateGeminiSnippet(prompt, 45);
        if (aiResponse) return aiResponse;

        if (outcome === 'won') {
            return `Calculated victory! Better luck next round!`;
        } else if (outcome === 'lost') {
            return `You got me this time! Rematch soon?`;
        } else {
            return `Great minds think alike — perfect deadlock!`;
        }
    }
}

module.exports = AIFeatureEnhancer;
