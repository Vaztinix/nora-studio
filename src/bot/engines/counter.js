const { create, all } = require('mathjs');

// Initialize a fully sandboxed mathjs instance with zero root-level system access
const mathInstance = create(all);
const secureEvaluator = mathInstance.evaluate;

/**
 * Validates mathematical expressions safely without using vulnerable eval() commands.
 */
function evaluateCountingInput(userInputString, targetCountSequence) {
    // Reject any string containing alphabetical or unapproved programming characters
    const maliciousPattern = /[a-zA-Z_=;!?'"`\\]/;
    if (maliciousPattern.test(userInputString)) {
        return { 
            isValid: false, 
            reason: "Security rejection: string contains illegal characters or script injections." 
        };
    }

    try {
        // Process expression parsing inside the safe sandbox wrapper
        const parsingOutput = secureEvaluator(userInputString);

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
