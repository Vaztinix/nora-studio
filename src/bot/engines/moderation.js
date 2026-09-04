/**
 * Advanced Contextual AutoMod & Moderation Engine for Nora
 * High-performance real-time threat analysis, invite/link filtering,
 * anti-spam token-bucket rate limiting, anti-caps, anti-zalgo, and toxicity detection.
 */

const { PermissionFlagsBits } = require('discord.js');

// In-memory rate limiting and spam tracking per user in each guild: Map<`${guildId}_${userId}`, Array<number>>
const spamTracker = new Map();
const lastMessageContent = new Map();

// Periodic cleanup of stale rate-limiting entries (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of spamTracker.entries()) {
        const recent = timestamps.filter(t => now - t < 30000);
        if (recent.length === 0) {
            spamTracker.delete(key);
        } else {
            spamTracker.set(key, recent);
        }
    }
    for (const [key, record] of lastMessageContent.entries()) {
        if (now - record.timestamp > 60000) {
            lastMessageContent.delete(key);
        }
    }
}, 300000);

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
    /discrod/i,
    /discord-app/i,
    /free.*nitro/i,
    /grabify/i,
    /iplogger/i,
    /2no\.co/i,
    /blasze\.com/i,
    /linkvertise/i
];

const DISCORD_INVITE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/([a-zA-Z0-9\-]+)/gi;
const GENERAL_URL_REGEX = /(https?:\/\/[^\s]+)/gi;
const ZALGO_CHAR_REGEX = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g;

function parseJsonArray(str) {
    if (!str) return [];
    if (Array.isArray(str)) return str;
    try {
        const parsed = JSON.parse(str);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return str.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    }
}

/**
 * Check if a guild member or channel is exempt from AutoMod
 */
function isExempt(member, channelId, guildConfig) {
    if (!member) return false;
    
    // Server administrators or members with Manage Messages bypass AutoMod
    if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageMessages)) {
        return true;
    }

    // Role exemptions
    const immuneRoles = parseJsonArray(guildConfig.automodImmuneRoles);
    if (immuneRoles.length > 0 && member.roles?.cache?.some(r => immuneRoles.includes(r.id))) {
        return true;
    }

    // Channel exemptions
    const immuneChannels = parseJsonArray(guildConfig.automodImmuneChannels);
    if (channelId && immuneChannels.includes(channelId)) {
        return true;
    }

    return false;
}

/**
 * Primary message threat and safety assessment
 */
async function assessMessageThreatContext(guildConfig, messageInstance) {
    if (!guildConfig || !messageInstance || !messageInstance.content) {
        return { actionRequired: false };
    }

    // Master toggles
    const isModerationEnabled = guildConfig.moderationEnabled !== false;
    const isAutoModActive = guildConfig.autoModActive !== false;
    if (!isModerationEnabled || !isAutoModActive) {
        return { actionRequired: false };
    }

    // Immunity check
    if (isExempt(messageInstance.member, messageInstance.channel?.id, guildConfig)) {
        return { actionRequired: false };
    }

    const rawText = messageInstance.content || '';
    const lowerText = rawText.toLowerCase();
    const now = Date.now();
    const trackerKey = `${messageInstance.guild?.id || 'guild'}_${messageInstance.author?.id || 'user'}`;

    // 1. FAST RATE-LIMITING & DUPLICATE SPAM CHECK
    if (guildConfig.spamDetectionEnabled) {
        const spamThreshold = parseInt(guildConfig.spamThreshold || 5, 10);
        const spamInterval = parseInt(guildConfig.spamInterval || 5000, 10);

        if (!spamTracker.has(trackerKey)) spamTracker.set(trackerKey, []);
        const timestamps = spamTracker.get(trackerKey).filter(t => now - t < spamInterval);
        timestamps.push(now);
        spamTracker.set(trackerKey, timestamps);

        if (timestamps.length > spamThreshold) {
            return {
                actionRequired: true,
                contextClassification: 'SPAM_RATE_LIMIT',
                recommendedAction: 'DELETE_AND_TIMEOUT',
                durationMs: parseInt(guildConfig.antiSpamMuteDuration || 60000, 10),
                reason: `Sending messages too quickly (${timestamps.length} messages in ${(spamInterval / 1000).toFixed(1)}s, max ${spamThreshold}).`
            };
        }

        // Duplicate message spam (e.g. same text repeated 3+ times in 10s)
        const lastRecord = lastMessageContent.get(trackerKey);
        if (lastRecord && lastRecord.content === rawText && (now - lastRecord.timestamp < 10000)) {
            const count = (lastRecord.count || 1) + 1;
            lastMessageContent.set(trackerKey, { content: rawText, timestamp: now, count });
            if (count >= 4) {
                return {
                    actionRequired: true,
                    contextClassification: 'DUPLICATE_SPAM',
                    recommendedAction: 'DELETE_AND_TIMEOUT',
                    durationMs: parseInt(guildConfig.antiSpamMuteDuration || 60000, 10),
                    reason: `Repeated identical message ${count} times in quick succession.`
                };
            }
        } else {
            lastMessageContent.set(trackerKey, { content: rawText, timestamp: now, count: 1 });
        }
    }

    // 2. DISCORD INVITE LINK CHECK
    if (guildConfig.automodInvites) {
        const inviteMatches = [...rawText.matchAll(DISCORD_INVITE_REGEX)];
        if (inviteMatches.length > 0) {
            const allowedInvites = parseJsonArray(guildConfig.allowedInvites).map(s => s.toLowerCase().trim());
            let hasUnauthorizedInvite = false;
            let caughtInvite = '';

            for (const match of inviteMatches) {
                const inviteCode = match[1] ? match[1].toLowerCase() : '';
                if (!allowedInvites.includes(inviteCode)) {
                    hasUnauthorizedInvite = true;
                    caughtInvite = match[0];
                    break;
                }
            }

            if (hasUnauthorizedInvite) {
                return {
                    actionRequired: true,
                    contextClassification: 'UNAUTHORIZED_INVITE',
                    recommendedAction: 'DELETE_AND_WARN',
                    reason: `Posting unauthorized Discord invite link (${caughtInvite}).`
                };
            }
        }
    }

    // 3. MALICIOUS PHISHING & SCAM LINKS
    const isScamActive = Boolean(guildConfig.automodScam || guildConfig.automodHardcore || guildConfig.automodSpam);
    if (isScamActive) {
        for (const pattern of SCAM_PHISHING_PATTERNS) {
            if (pattern.test(rawText)) {
                return {
                    actionRequired: true,
                    contextClassification: 'PHISHING_SCAM',
                    recommendedAction: 'DELETE_AND_TIMEOUT',
                    durationMs: 3600000, // 1 hour timeout for active phishing
                    reason: `Detected malicious phishing or scam URL pattern.`
                };
            }
        }
    }

    // 4. GENERAL LINK BLOCKER
    if (guildConfig.automodLinks) {
        if (GENERAL_URL_REGEX.test(rawText)) {
            return {
                actionRequired: true,
                contextClassification: 'LINK_BLOCKED',
                recommendedAction: 'DELETE_AND_WARN',
                reason: `External links are restricted on this server.`
            };
        }
    }

    // 5. MASS MENTION LIMIT
    const mentionLimit = parseInt(guildConfig.automodMentions || 0, 10);
    if (mentionLimit > 0) {
        const userMentions = messageInstance.mentions?.users?.size || 0;
        const roleMentions = messageInstance.mentions?.roles?.size || 0;
        const everyoneMention = messageInstance.mentions?.everyone ? 1 : 0;
        const totalMentions = userMentions + roleMentions + everyoneMention;

        if (totalMentions > mentionLimit) {
            return {
                actionRequired: true,
                contextClassification: 'MENTION_LIMIT_EXCEEDED',
                recommendedAction: 'DELETE_AND_WARN',
                reason: `Exceeded mass mention limit (${totalMentions} mentions, limit: ${mentionLimit}).`
            };
        }
    }

    // 6. MASS CAPS FILTER
    if (guildConfig.automodCaps && rawText.length >= 8) {
        const alphaOnly = rawText.replace(/[^a-zA-Z]/g, '');
        if (alphaOnly.length >= 8) {
            const upperCount = (rawText.match(/[A-Z]/g) || []).length;
            const capsPercentage = upperCount / alphaOnly.length;
            if (capsPercentage >= 0.75) {
                return {
                    actionRequired: true,
                    contextClassification: 'MASS_CAPS',
                    recommendedAction: 'DELETE_AND_WARN',
                    reason: `Excessive capital letters (${Math.round(capsPercentage * 100)}% caps).`
                };
            }
        }
    }

    // 7. ZALGO & CORRUPT UNICODE FILTER
    if (guildConfig.automodZalgo) {
        const zalgoCount = (rawText.match(ZALGO_CHAR_REGEX) || []).length;
        if (zalgoCount > 10) {
            return {
                actionRequired: true,
                contextClassification: 'ZALGO_TEXT',
                recommendedAction: 'DELETE_AND_WARN',
                reason: `Excessive corrupted unicode or Zalgo characters (${zalgoCount} combining marks).`
            };
        }
    }

    // 8. CUSTOM BLOCKED CONTEXTS & PHRASES
    const customWords = parseJsonArray(guildConfig.customBlockedContexts);
    if (customWords.length > 0) {
        for (const word of customWords) {
            if (word && typeof word === 'string' && lowerText.includes(word.toLowerCase().trim())) {
                return {
                    actionRequired: true,
                    contextClassification: 'CUSTOM_BLOCKLIST',
                    recommendedAction: 'DELETE_AND_WARN',
                    reason: `Contains server blocklisted phrase "${word}".`
                };
            }
        }
    }

    // 9. SEVERE SLURS & HATE SPEECH
    if (guildConfig.automodSlurs !== false) {
        for (const pattern of SEVERE_SLUR_PATTERNS) {
            const match = lowerText.match(pattern);
            if (match) {
                return {
                    actionRequired: true,
                    contextClassification: 'SEVERE_HATE_SPEECH',
                    recommendedAction: 'DELETE_AND_TIMEOUT',
                    durationMs: 3600000, // 1 hour timeout
                    reason: `Hate speech / prohibited slur detected [${match[0]}].`
                };
            }
        }
    }

    // 10. TOXIC HARASSMENT & THREATS
    if (guildConfig.automodHardcore || guildConfig.automodProfanity || isAutoModActive) {
        for (const pattern of TOXIC_HARASSMENT_PATTERNS) {
            const match = lowerText.match(pattern);
            if (match) {
                return {
                    actionRequired: true,
                    contextClassification: 'TOXIC_HARASSMENT',
                    recommendedAction: 'DELETE_AND_WARN',
                    reason: `Harassment or toxic language pattern detected [${match[0]}].`
                };
            }
        }
    }

    // 11. GENERAL PROFANITY & VULGARITY
    if (guildConfig.automodProfanity) {
        for (const pattern of GENERAL_PROFANITY_PATTERNS) {
            const match = lowerText.match(pattern);
            if (match) {
                return {
                    actionRequired: true,
                    contextClassification: 'PROFANITY',
                    recommendedAction: 'DELETE_AND_WARN',
                    reason: `Profanity / vulgarity detected [${match[0]}].`
                };
            }
        }
    }

    return { actionRequired: false };
}

module.exports = {
    assessMessageThreatContext,
    isExempt
};
