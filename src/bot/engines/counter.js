const { create, all } = require('mathjs');

// Initialize a fully sandboxed mathjs instance with zero root-level system access
const mathInstance = create(all);

// Whitelisted mathematical functions and constants for advanced math support
const ALLOWED_SYMBOLS = new Set([
    // Constants
    'pi', 'PI', 'e', 'E', 'tau', 'TAU', 'phi', 'PHI', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2',
    // Basic, Roots & Powers
    'sqrt', 'cbrt', 'nthRoot', 'pow', 'exp', 'log', 'ln', 'log10', 'log2',
    // Rounding & Sign
    'abs', 'ceil', 'floor', 'round', 'fix', 'sign',
    // Trigonometry
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
    'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
    // Number Theory & Combinatorics
    'factorial', 'gamma', 'gcd', 'lcm',
    'combinations', 'permutations',
    // Min, Max, Modulo
    'min', 'max', 'mod'
]);

/**
 * Strips all emoji characters from a string, including:
 * - Unicode emojis (emoticons, symbols, flags, skin-tone modifiers, ZWJ sequences)
 * - Discord custom emojis like <:name:id> and <a:name:id>
 * - Common emoji-related symbols (© ® ™ etc.)
 */
function stripEmojis(str) {
    if (!str) return '';
    return str
        .replace(/<a?:\w+:\d+>/g, '')
        .replace(/\d\uFE0F?\u20E3/gu, '')
        .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/[\u200d\uFE0F]/g, '')
        .replace(/[\u20E3]/g, '')
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
 * Normalizes common mathematical typography into standard parser syntax
 */
function normalizeMathSyntax(str) {
    let s = str.trim();
    return s
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/−/g, '-')
        .replace(/π/g, 'pi')
        .replace(/√\s*(\d+|\([^\)]+\))/g, 'sqrt($1)');
}

/**
 * Validates and evaluates mathematical expressions safely using mathjs AST traversal.
 * Supports basic arithmetic, advanced algebra, trigonometry, logarithms, roots, and combinatorics.
 *
 * Returns:
 * - { isValid: true, result: number } if input evaluates to targetCountSequence
 * - { isValid: false, isWrongCount: true, calculated: number, reason: string } if input was an expression/number that did NOT equal targetCountSequence
 * - { isValid: false, isNonCounting: true, reason: string } if message was pure chatter, emojis, or invalid/malicious text
 */
function evaluateCountingInput(userInputString, targetCountSequence) {
    // Step 1: Strip emojis and markdown
    const withoutEmojis = stripEmojis(userInputString);
    const cleanedInput = stripMarkdown(withoutEmojis);

    if (!cleanedInput || cleanedInput.length === 0) {
        return {
            isValid: false,
            isNonCounting: true,
            reason: "Non-counting content: message contains only emojis or non-numeric characters."
        };
    }

    // Ultra-fast path: plain integers
    if (/^-?\d+$/.test(cleanedInput)) {
        const val = parseInt(cleanedInput, 10);
        if (val === targetCountSequence) {
            return { isValid: true, result: val };
        }
        return {
            isValid: false,
            isWrongCount: true,
            calculated: val,
            reason: `Math mismatch: expression calculated to ${val}, expected ${targetCountSequence}.`
        };
    }

    const normalized = normalizeMathSyntax(cleanedInput);

    // Reject dangerous syntax or assignments immediately
    if (/[=;`\\]/.test(normalized)) {
        return {
            isValid: false,
            isNonCounting: true,
            reason: "Security rejection: string contains illegal characters or script injections."
        };
    }

    try {
        const parsed = mathInstance.parse(normalized);

        // Security AST audit
        let hasMaliciousNode = false;
        let unknownIdentifier = null;
        let hasMathOperationOrNumber = false;

        parsed.traverse((node) => {
            if (node.isAssignmentNode || node.isFunctionAssignmentNode || node.isBlockNode || node.isAccessorNode || node.isIndexNode) {
                hasMaliciousNode = true;
            }
            if (node.isConstantNode || node.isOperatorNode) {
                hasMathOperationOrNumber = true;
            }
            if (node.isSymbolNode) {
                if (!ALLOWED_SYMBOLS.has(node.name)) {
                    unknownIdentifier = node.name;
                } else {
                    hasMathOperationOrNumber = true;
                }
            }
        });

        if (hasMaliciousNode || unknownIdentifier) {
            return {
                isValid: false,
                isNonCounting: true,
                reason: `Non-counting content: unknown word or unapproved identifier "${unknownIdentifier || 'injection'}".`
            };
        }

        if (!hasMathOperationOrNumber) {
            return {
                isValid: false,
                isNonCounting: true,
                reason: "Non-counting content: no mathematical expression found."
            };
        }

        const compiled = parsed.compile();
        const output = compiled.evaluate({});

        if (typeof output !== 'number' || !Number.isFinite(output) || Number.isNaN(output)) {
            return {
                isValid: false,
                isWrongCount: true,
                reason: "Calculation error: expression did not produce a finite real number."
            };
        }

        // Round floating point artifacts (e.g. 2.9999999999999995 -> 3, sin(pi) -> 0)
        const rounded = Math.round(output);
        const effectiveResult = Math.abs(output - rounded) < 1e-9 ? rounded : output;

        if (effectiveResult === targetCountSequence) {
            return {
                isValid: true,
                result: effectiveResult
            };
        }

        return {
            isValid: false,
            isWrongCount: true,
            calculated: effectiveResult,
            reason: `Math mismatch: expression calculated to ${effectiveResult}, expected ${targetCountSequence}.`
        };
    } catch (syntaxError) {
        return {
            isValid: false,
            isNonCounting: true,
            reason: "Calculation error: expression is malformed or not a valid mathematical statement."
        };
    }
}

module.exports = {
    evaluateCountingInput,
    stripMarkdown,
    stripEmojis
};
