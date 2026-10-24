/**
 * ✍️ Sentence Sanitizer & Thought Completion Shield for Nora AI
 * Guarantees that AI responses always finish their thoughts cleanly without trailing cut-offs.
 * Formats outputs to be clean, punchy Discord messages with complete terminal punctuation.
 */

/**
 * Ensures AI responses always finish their thoughts cleanly without trailing cut-offs.
 * Trims dangling fragments (e.g. "...deep in code or") back to the last complete sentence,
 * cleans dangling conjunctions, and guarantees proper terminal punctuation.
 *
 * @param {string} rawText
 * @returns {string}
 */
function ensureCleanSentenceEnding(rawText) {
    if (!rawText || typeof rawText !== 'string') return rawText;
    let text = rawText.trim();
    if (!text) return text;

    // Auto-close open code blocks if truncated inside markdown
    const codeBlockCount = (text.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
        text += '\n```';
    }

    // Terminal characters that indicate a completed sentence, thought, or Discord expression
    const terminalRegex = /([.!?~"'`*_)}\]>:;]|\p{Extended_Pictographic})$/u;

    // Common dangling conjunctions, prepositions, and auxiliary words signaling a cut-off fragment
    const danglingEndRegex = /\b(and|or|but|because|with|in|on|at|to|for|of|is|are|was|were|the|a|an|it|its|that|this|these|those|which|who|whom|whose|if|then|so|as|than|either|neither)\s*$/i;

    // If text already ends with a clean terminator and no dangling word precedes it
    const strippedEnd = text.replace(terminalRegex, '').trim();
    if (terminalRegex.test(text) && !danglingEndRegex.test(strippedEnd)) {
        return text;
    }

    // Search backwards for the last complete sentence ending in ., !, or ?
    const sentenceEndMatches = [...text.matchAll(/[.!?](\s+|$)/g)];
    if (sentenceEndMatches.length > 0) {
        const lastMatch = sentenceEndMatches[sentenceEndMatches.length - 1];
        const cutoffIndex = lastMatch.index + 1; // Include the punctuation mark
        const trailingFragment = text.slice(cutoffIndex).trim();

        // If the remaining fragment after the last sentence is incomplete or dangling
        if (trailingFragment && (!terminalRegex.test(trailingFragment) || danglingEndRegex.test(trailingFragment))) {
            const cleanCandidate = text.slice(0, cutoffIndex).trim();
            // Retain the clean candidate if it contains substantial text (>= 15 chars)
            if (cleanCandidate.length >= 15) {
                return cleanCandidate;
            }
        }
    }

    // If the text was a single sentence or had no earlier terminal punctuation:
    // Strip trailing dangling words (e.g. "...cluster units are" -> "...cluster units")
    while (danglingEndRegex.test(text)) {
        text = text.replace(danglingEndRegex, '').trim();
    }

    // Append period if still missing terminal punctuation
    if (!terminalRegex.test(text)) {
        text += '.';
    }

    return text;
}

module.exports = { ensureCleanSentenceEnding };
