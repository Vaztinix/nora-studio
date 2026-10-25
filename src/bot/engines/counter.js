const { create, all } = require('mathjs');

// Initialize a fully sandboxed mathjs instance with zero root-level system access
const mathInstance = create(all);

// Register user-friendly function aliases on the sandboxed mathjs instance
mathInstance.import({
    ln: (x) => mathInstance.log(x),
    nCr: (n, r) => mathInstance.combinations(n, r),
    nPr: (n, r) => mathInstance.permutations(n, r),
    trunc: (x) => Math.trunc(x),
    fact: (x) => mathInstance.factorial(x)
}, { override: true });

// Whitelisted mathematical functions and constants for advanced math support
const ALLOWED_SYMBOLS = new Set([
    // Constants
    'pi', 'PI', 'e', 'E', 'tau', 'TAU', 'phi', 'PHI', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2',
    // Basic, Roots & Powers
    'sqrt', 'cbrt', 'nthRoot', 'pow', 'exp', 'log', 'ln', 'log10', 'log2', 'hypot', 'trunc',
    // Rounding & Sign
    'abs', 'ceil', 'floor', 'round', 'fix', 'sign',
    // Trigonometry
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
    'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
    // Number Theory & Combinatorics
    'factorial', 'fact', 'gamma', 'gcd', 'lcm',
    'combinations', 'permutations', 'nCr', 'nPr',
    // Min, Max, Modulo, Units
    'min', 'max', 'mod', 'deg', 'rad'
]);

const SUPERSCRIPTS = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-', '⁽': '(', '⁾': ')'
};

/**
 * Normalizes Unicode superscript digits into standard exponent notation ^(...)
 */
function normalizeSuperscripts(str) {
    if (!str) return '';
    return str.replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾]+)/g, (match) => {
        const converted = Array.from(match).map(c => SUPERSCRIPTS[c] || c).join('');
        return '^(' + converted + ')';
    });
}

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
    // Superscripts must be converted before NFKC decomposition turns ² into 2
    let s = normalizeSuperscripts(str.trim());
    s = s.normalize('NFKC');
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

    // 1. Grouping brackets & braces to parentheses
    s = s.replace(/\[/g, '(').replace(/\]/g, ')');
    s = s.replace(/\{/g, '(').replace(/\}/g, ')');

    // 2. Division operators: colon (:), obelus (÷), division slash (∕), fraction slash (⁄)
    s = s.replace(/÷/g, '/');
    s = s.replace(/∕/g, '/');
    s = s.replace(/⁄/g, '/');
    s = s.replace(/:+/g, '/');

    // 3. Exponents: ** to ^
    s = s.replace(/\*\*/g, '^');

    // 4. Multiplication symbols: ×, ✕, ✖, ∗, ＊, •, ·, ⋅, ∙
    s = s.replace(/[×✕✖∗＊]/g, '*');
    s = s.replace(/[•·⋅∙]/g, '*');
    // Letter x/X as multiplication between numbers/brackets (preserve hex like 0x10)
    s = s.replace(/(?<=([1-9]|\)))\s*[xX]\s*(?=[\d\(])/g, ' * ');
    s = s.replace(/(?<=\b0)\s+[xX]\s+(?=[\d\(])/g, ' * ');

    // 5. Minus / Subtraction signs: −, –, —, ―, ー, ﹣, －
    s = s.replace(/[−–—―ー﹣－]/g, '-');

    // 6. Mathematical Constants
    s = s.replace(/[πΠ]/g, 'pi');
    s = s.replace(/τ/g, 'tau');
    s = s.replace(/[ϕφ]/g, 'phi');
    s = s.replace(/ℯ/g, 'e');

    // 7. Absolute value bars |x|
    s = s.replace(/\|([^|]+)\|/g, 'abs($1)');

    // 8. Roots: fourth root (∜), cube root (∛), square root (√)
    s = s.replace(/∜\s*(\d+(?:\.\d+)?|\([^)]+\))/g, 'nthRoot($1, 4)');
    s = s.replace(/∛\s*(\d+(?:\.\d+)?|\([^)]+\))/g, 'cbrt($1)');
    s = s.replace(/√\s*(\d+(?:\.\d+)?|\([^)]+\))/g, 'sqrt($1)');

    // 9. Combinatorics & modulo shortcuts (e.g. 4 choose 2, 4 nCr 2, 10 modulo 3)
    s = s.replace(/(\d+)\s*(?:choose|nCr)\s*(\d+)/gi, 'combinations($1, $2)');
    s = s.replace(/(\d+)\s*nPr\s*(\d+)/gi, 'permutations($1, $2)');
    s = s.replace(/\bmodulo\b/gi, 'mod');

    return s;
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
