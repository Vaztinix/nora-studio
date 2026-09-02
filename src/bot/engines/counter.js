const { create, all } = require('mathjs');

// Initialize a fully sandboxed mathjs instance with zero root-level system access
const mathInstance = create(all);
const secureEvaluator = mathInstance.evaluate;

/**
 * Strips all emoji characters from a string, including:
 * - Unicode emojis (emoticons, symbols, flags, skin-tone modifiers, ZWJ sequences)
 * - Discord custom emojis like <:name:id> and <a:name:id>
 * - Common emoji-related symbols (© ® ™ etc.)
 */
function stripEmojis(str) {
    return str
        // Remove Discord custom emojis: <:name:id> and <a:name:id>
        .replace(/<a?:\w+:\d+>/g, '')
        // Remove Unicode keycap emojis: e.g., 0️⃣ to 9️⃣
        .replace(/\d\uFE0F?\u20E3/gu, '')
        // Remove Regional Indicator symbols (Flags)
        .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
        // Remove Unicode emojis using modern property escapes
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/[\u200d\uFE0F]/g, '') // ZWJ and Variation Selector
        .replace(/[\u20E3]/g, '') // Combining enclosing keycap
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Strips Discord markdown formatting:
 * - Bold: **text**
 * - Italics: *text*
 * - Bold Italics: ***text***
 * - Underline: __text__
 * - Strikethrough: ~~text~~
 * - Spoilers: ||text||
 * - Inline code: `text`
 * - Code blocks: ```text```
 */
function stripMarkdown(str) {
    if (!str) return '';
    let s = str.trim().normalize('NFKC');
    s = s.replace(/```(?:[a-z]*\n)?([\s\S]*?)```/gi, '$1');
    s = s.replace(/`([^`]+)`/g, '$1');
    s = s.replace(/\|\|([\s\S]*?)\|\|/g, '$1');
    s = s.replace(/~~([\s\S]*?)~~/g, '$1');
    s = s.replace(/__([\s\S]*?)__/g, '$1');
    s = s.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '$1');
    s = s.replace(/\*\*([\s\S]+?)\*\*/g, '$1');
    s = s.replace(/(?:^|\s)\*([^*\s]+)\*(?:\s|$)/g, ' $1 ');
    s = s.replace(/(?:^|\s)_([^_\s]+)_(?:\s|$)/g, ' $1 ');
    return s.trim();
}

/**
 * Validates mathematical expressions safely without using vulnerable eval() commands.
 */
function evaluateCountingInput(userInputString, targetCountSequence) {
    // Step 1: Strip emojis and Discord markdown from the input
    const withoutEmojis = stripEmojis(userInputString);
    const cleanedInput = stripMarkdown(withoutEmojis);

    // If the message was purely emojis or empty after stripping, silently ignore
    if (!cleanedInput || cleanedInput.length === 0) {
        return {
            isValid: false,
            reason: "Non-counting content: message contains only emojis or non-numeric characters."
        };
    }

    // Step 2: Reject any string containing alphabetical or unapproved programming characters
    const maliciousPattern = /[a-zA-Z_=;!?'"`\\]/;
    if (maliciousPattern.test(cleanedInput)) {
        return { 
            isValid: false, 
            reason: "Security rejection: string contains illegal characters or script injections." 
        };
    }

    try {
        // Process expression parsing inside the safe sandbox wrapper
        const parsingOutput = secureEvaluator(cleanedInput);

        // Verify calculation matches the required step number in the tracking sequence
        if (typeof parsingOutput === 'number' && parsingOutput === targetCountSequence) {
            return { 
                isValid: true, 
                result: parsingOutput 
            };
        }
        
        return { 
            isValid: false, 
            reason: `Math mismatch: expression calculated to ${parsingOutput}, expected ${targetCountSequence}.` 
        };
    } catch (syntaxError) {
        return { 
            isValid: false, 
            reason: "Calculation error: expression is malformed or incomplete." 
        };
    }
}

module.exports = {
    evaluateCountingInput
};
