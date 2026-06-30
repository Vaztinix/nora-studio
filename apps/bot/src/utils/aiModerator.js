const { levenshteinEditDistance: levenshtein } = require('levenshtein-edit-distance');
const stringSimilarity = require('string-similarity');

// Hardcoded list of toxic slang and profanities for typo detection
const TOXIC_SLANG = ['kys', 'stfu', 'lmao not really', 'retard', 'nigger', 'faggot', 'bitch', 'asshole'];
const SARCASTIC_PATTERNS = [
    /no\s+shit\s+sherlock/i,
    /wow\s*,\s*so\s+smart/i,
    /bravo\s*,\s*genius/i,
    /oh\s*,\s*brilliant/i,
    /clap\s+clap\s+for\s+you/i,
    /wow\s*,\s*what\s+a\s+surprise/i,
    /thanks\s+for\s+nothing/i,
    /is\s+that\s+the\s+best\s+you\s+can\s+do/i
];

/**
 * Analyzes message content for sarcasm, toxic slang, and typo bypasses.
 * Uses a high threshold to minimize false positives.
 */
function analyzeMessage(content) {
    if (!content || typeof content !== 'string') {
        return { flagged: false };
    }

    const cleanContent = content.trim().toLowerCase();
    const words = cleanContent.split(/\s+/);

    // 1. Check for Sarcastic / Passive-Aggressive Toxic Patterns
    for (const pattern of SARCASTIC_PATTERNS) {
        if (pattern.test(cleanContent)) {
            return {
                flagged: true,
                reason: 'Sarcasm / Passive-Aggressive Toxicity',
                confidence: 0.85,
                context: content
            };
        }
    }

    // 2. Check for Toxic Slang directly
    for (const slang of TOXIC_SLANG) {
        if (cleanContent.includes(slang)) {
            return {
                flagged: true,
                reason: 'Toxic Slang / Abuse',
                confidence: 0.95,
                context: slang
            };
        }
    }

    // 3. Typo/Bypass Detection using Levenshtein distance on words
    // We check if any word has a very high similarity to toxic words but with minor typos/symbols
    for (const word of words) {
        // Ignore very short words to prevent false positives
        if (word.length < 4) continue;

        for (const toxic of TOXIC_SLANG) {
            if (toxic.length < 4) continue;

            // Compute similarity
            const sim = stringSimilarity.compareTwoStrings(word, toxic);
            const dist = levenshtein(word, toxic);

            // High threshold constraints:
            // Similarity above 0.75 OR distance of exactly 1/2 characters for medium-long words
            if (sim >= 0.75 && sim < 1.0) {
                return {
                    flagged: true,
                    reason: 'Potential Filter Bypass / Typo Detected',
                    confidence: parseFloat(sim.toFixed(2)),
                    context: `${word} (resembles: ${toxic})`
                };
            }
        }
    }

    return { flagged: false };
}

module.exports = { analyzeMessage };
