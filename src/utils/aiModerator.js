const { levenshteinEditDistance: levenshtein } = require('levenshtein-edit-distance');
const stringSimilarity = require('string-similarity');

// Hardcoded list of severe toxic slang and profanities for typo detection
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

// Patterns indicating a user is discussing, defining, quoting, or explaining a word rather than directing abuse
const EDUCATIONAL_META_PATTERNS = [
    /is\s+literally\s+in\s+the\s+abbreviation/i,
    /means\s+["']?.+["']?/i,
    /stands\s+for/i,
    /abbreviation\s+for/i,
    /definition\s+of/i,
    /meaning\s+of/i,
    /what\s+does\s+.*\s+mean/i,
    /discussing\s+(its|the)\s+meaning/i,
    /dictionary/i
];

/**
 * Analyzes message content for sarcasm, toxic slang, and typo bypasses while checking context intent.
 * Ignores non-targeted educational/meta discussion and casual swearing.
 */
function analyzeMessage(content) {
    if (!content || typeof content !== 'string') {
        return { flagged: false };
    }

    const cleanContent = content.trim().toLowerCase();
    const words = cleanContent.split(/\s+/);

    // 0. Context/Intent Check: If user is explaining, quoting, or defining an abbreviation/word, skip flagging
    for (const pattern of EDUCATIONAL_META_PATTERNS) {
        if (pattern.test(cleanContent)) {
            return { flagged: false, reason: 'Educational / Discussion Context' };
        }
    }

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
            // Check if stfu / casual words are being discussed meta-wise or used casually without personal attacks
            if (slang === 'stfu' && (cleanContent.includes('abbreviation') || cleanContent.includes('means') || cleanContent.includes('isnt supposed to be nice'))) {
                continue;
            }

            return {
                flagged: true,
                reason: 'Toxic Slang / Abuse',
                confidence: 0.95,
                context: slang
            };
        }
    }

    // 3. Typo/Bypass Detection using Levenshtein distance on words
    for (const word of words) {
        // Ignore very short words or natural conversational words like unc, days, etc.
        if (word.length < 4) continue;
        if (['unc', 'days', 'just', 'more', 'bigger'].includes(word)) continue;

        for (const toxic of TOXIC_SLANG) {
            if (toxic.length < 4) continue;

            // Compute similarity
            const sim = stringSimilarity.compareTwoStrings(word, toxic);

            // High threshold constraints with exclusion of harmless natural words
            if (sim >= 0.82 && sim < 1.0) {
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

