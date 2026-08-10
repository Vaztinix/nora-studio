/**
 * Advanced Contextual AutoMod Engine for Nora
 * Distinguishes targeted harassment vs casual conversation & handles mention limiting.
 */

const SEVERE_SLUR_PATTERNS = [
    /\b(nigger|nigga|nigg|faggot|fag|kike|chink|spic|tranny|retard|retarded)\b/i
];

const TOXIC_HARASSMENT_PATTERNS = [
    /\b(kys|kill\s*your\s*self|go\s*die|go\s*neck\s*your\s*self|die\s*in\s*a\s*fire|hope\s*you\s*die)\b/i,
    /\b(shut\s*the\s*fuck\s*up|stfu|screw\s*you|fuck\s*you|fuck\s*u|get\s*a\s*life)\b/i
];

const GENERAL_PROFANITY_PATTERNS = [
    /\b(bitch|whore|slut|cunt|bastard|dipshit|motherfucker|pussy|dickhead|jackass|asshole|dumbass)\b/i,
    /\b(fuck|shit|damn|crap|piss|cock|dick|tits)\b/i
];

const SCAM_PHISHING_PATTERNS = [
    /discord\.gift/i,
    /steamcom+unity\.com/i,
    /dlscord/i,
    /free.*nitro/i,
    /grabify/i,
    /iplogger/i
];

const DIRECT_TARGETING_INDICATORS = [
    /\b(you\s*are\s*a|you're\s*a|youre\s*a|u\s*r\s*a|u\s*a|you\s*a|ur\s*a|ur\s*an)\b/i,
    /\b(you\s*are|you're|youre|u\s*r|ur)\b/i,
    /\b(your\s*mom|your\s*mother|your\s*family)\b/i
];

async function assessMessageThreatContext(guildConfig, messageInstance) {
    if (!guildConfig) return { actionRequired: false };

    // 1. MASTER TOGGLE CHECK:
    // If BOTH moderationEnabled AND autoModActive are disabled/false, do NOT moderate chat!
    const isModerationEnabled = Boolean(guildConfig.moderationEnabled);
    const isAutoModActive = Boolean(guildConfig.autoModActive);

    if (!isModerationEnabled && !isAutoModActive) {
        return { actionRequired: false };
    }

    // 2. FEATURE TOGGLE CHECKS:
    const isProfanityActive = Boolean(guildConfig.automodProfanity || isAutoModActive);
    const isSlursActive = Boolean(guildConfig.automodSlurs || isAutoModActive);
    const isScamActive = Boolean(guildConfig.automodScam || guildConfig.automodHardcore || guildConfig.automodSpam || isAutoModActive);
    const isMentionsActive = parseInt(guildConfig.automodMentions || 0, 10) > 0;
    
    let customWords = [];
    try {
        customWords = JSON.parse(guildConfig.customBlockedContexts || '[]');
        if (!Array.isArray(customWords)) customWords = [];
    } catch (e) {
        customWords = [];
    }
    const hasCustomWords = customWords.length > 0;

    // If NO sub-filters or custom words are active at all, skip moderation!
    if (!isProfanityActive && !isSlursActive && !isScamActive && !isMentionsActive && !hasCustomWords) {
        return { actionRequired: false };
    }

    const rawText = messageInstance.content ? messageInstance.content.toLowerCase() : '';

    // 1. MENTION LIMITING CHECK
    if (isMentionsActive) {
        const mentionLimit = parseInt(guildConfig.automodMentions || 0, 10);
        const userMentions = messageInstance.mentions?.users?.size || 0;
        const roleMentions = messageInstance.mentions?.roles?.size || 0;
        const everyoneMention = messageInstance.mentions?.everyone ? 1 : 0;
        const totalMentions = userMentions + roleMentions + everyoneMention;

        if (totalMentions > mentionLimit) {
            return {
                actionRequired: true,
                contextClassification: "MENTION_LIMIT_EXCEEDED",
                recommendedAction: "DELETE_AND_WARN",
                reason: `Exceeded mention limit (${totalMentions} mentions sent, limit is ${mentionLimit}).`
            };
        }
    }

    // 2. SCAM & PHISHING CHECK
    if (isScamActive) {
        for (const pattern of SCAM_PHISHING_PATTERNS) {
            if (pattern.test(rawText)) {
                return {
                    actionRequired: true,
                    contextClassification: "TARGETED_HARASSMENT",
                    recommendedAction: "DELETE_AND_WARN",
                    reason: "Detected malicious scam or phishing link pattern."
                };
            }
        }
    }

    // 3. CUSTOM BLOCKED CONTEXTS & WORDS
    let customMatch = null;
    if (hasCustomWords) {
        for (const word of customWords) {
            if (word && typeof word === 'string' && rawText.includes(word.toLowerCase())) {
                customMatch = word;
                break;
            }
        }
    }

    // 4. PROFANITY & HATE SPEECH CHECK
    let matchedSlur = null;
    if (isSlursActive) {
        for (const pattern of SEVERE_SLUR_PATTERNS) {
            const match = rawText.match(pattern);
            if (match) {
                matchedSlur = match[0];
                break;
            }
        }
    }

    let matchedHarassment = null;
    if (isSlursActive || isProfanityActive || isAutoModActive || guildConfig.automodHardcore) {
        for (const pattern of TOXIC_HARASSMENT_PATTERNS) {
            const match = rawText.match(pattern);
            if (match) {
                matchedHarassment = match[0];
                break;
            }
        }
    }

    let matchedProfanity = null;
    if (isProfanityActive) {
        for (const pattern of GENERAL_PROFANITY_PATTERNS) {
            const match = rawText.match(pattern);
            if (match) {
                matchedProfanity = match[0];
                break;
            }
        }
    }

    const violationTerm = customMatch || matchedSlur || matchedHarassment || matchedProfanity;
    if (!violationTerm) {
        return { actionRequired: false };
    }

    // 5. DETERMINE INTENT (Targeted Harassment vs Casual Conversation)
    const hasMentions = (messageInstance.mentions?.users?.size || 0) > 0 || (messageInstance.mentions?.roles?.size || 0) > 0;
    const isDirectlyTargeted = DIRECT_TARGETING_INDICATORS.some(pat => pat.test(rawText));
    const characterSpamDetected = /(.)\1{5,}/.test(rawText);
    const isSevereViolation = Boolean(matchedSlur || matchedHarassment || customMatch);

    if (hasMentions || isDirectlyTargeted || characterSpamDetected || isSevereViolation) {
        return {
            actionRequired: true,
            contextClassification: "TARGETED_HARASSMENT",
            recommendedAction: "EXECUTE_TIMEOUT_PROMPT",
            reason: `Language [${violationTerm}] used in a targeted or high-severity interaction.`
        };
    }

    // Casual expression (e.g. swearing in conversation without targeting someone)
    return {
        actionRequired: isProfanityActive,
        contextClassification: "CASUAL_EXPRESSION",
        recommendedAction: "DISPATCH_EPHEMERAL_NOTICE",
        reason: `Conversational use of flagged word [${violationTerm}].`
    };
}

module.exports = {
    assessMessageThreatContext
};
