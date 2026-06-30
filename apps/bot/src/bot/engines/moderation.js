/**
 * Analyzes conversational context around flagged keywords to avoid over-moderation.
 */
async function assessMessageThreatContext(guildConfig, messageInstance) {
    // Return immediately if the custom moderation module hasn't been manually enabled
    if (!guildConfig.autoModActive) {
        return { actionRequired: false };
    }

    const rawTextContent = messageInstance.content.toLowerCase();
    
    // Custom blocked context keywords stored as a JSON array of strings in SQLite
    let wordDictionary = [];
    try {
        wordDictionary = JSON.parse(guildConfig.customBlockedContexts || '[]');
    } catch (e) {
        wordDictionary = [];
    }
    
    // Evaluate message text against the active keyword list
    const identifiedViolations = wordDictionary.filter(term => rawTextContent.includes(term.toLowerCase()));
    if (identifiedViolations.length === 0) {
        return { actionRequired: false };
    }

    // Check for indicators of targeted intent
    const targetedMentionPresent = messageInstance.mentions.users.size > 0;
    const characterSpamDetected = /(.)\1{4,}/.test(rawTextContent); // Matches heavy character repetition

    if (targetedMentionPresent || characterSpamDetected) {
        return {
            actionRequired: true,
            contextClassification: "TARGETED_HARASSMENT",
            recommendedAction: "EXECUTE_TIMEOUT_PROMPT",
            reason: `Flagged keyword [${identifiedViolations[0]}] deployed in a high-threat targeted interaction.`
        };
    }

    // Handle conversational expressions smoothly according to server safety preferences
    return {
        actionRequired: !guildConfig.useDefaultSafetyRules, // False if owner sets layout to ignore casual context
        contextClassification: "CASUAL_EXPRESSION",
        recommendedAction: "DISPATCH_EPHEMERAL_NOTICE",
        reason: "Flagged keyword detected inside an un-targeted conversational statement."
    };
}

module.exports = {
    assessMessageThreatContext
};
