const { Events, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const OpenAI = require('openai');
const settingsCache = require('../utils/settingsCache');
const { getPrivacyResponse } = require('../utils/privateBrain');
const { getBuiltInResponse } = require('../utils/builtInBrain');
const { ensureCleanSentenceEnding } = require('../utils/sentenceSanitizer');
const { fetchMonthlyHistory } = require('../utils/aiTools');
const { checkRateLimit } = require('../utils/aiRateLimiter');
const { isUserPremium } = require('../utils/premiumManager');
const { getUserMemoryContext, updateUserMemory } = require('../utils/userMemoryManager');
const { isImageGenerationPrompt, generateAIImage } = require('../utils/aiImageGenerator');
const { processNoraAction } = require('../utils/noraActionExecutor');
let rokuController = null;
try { rokuController = require('../utils/rokuController'); } catch (e) {}
const geminiKeyManager = require('../utils/geminiKeyManager');
const conversationHub = require('../utils/conversationHub');
const { searchWeb, isSearchQuery } = require('../utils/searchEngine');
const { getSanitizedSpecsSummary } = require('../utils/deviceSpecs');

/**
 * Nora Core V20.0 - Gemini Multimodal Intelligence & Image Generation Engine
 * Handles full memory, mood matching, multimodal vision, and AI image synthesis.
 * Nora is female (she/her) created and developed by Vaztinix (1214048435632603137).
 */
const activeChannelQueues = new Map();
const serverQuotaNoticeCooldowns = new Map(); // guildId -> timestamp of last sent quota notice
const SERVER_QUOTA_NOTICE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes (300,000ms) cooldown during active chat

/**
 * Resolves AI-generated <@username> / <@displayName> or @username tags into real <@USER_ID> mentions
 */
async function resolveBrokenUserMentions(text, message, fetchedMessages, replyTargetMsg) {
    if (!text || typeof text !== 'string' || !message?.guild) return text;

    const nameToId = new Map();
    const norm = (s) => String(s || '').toLowerCase().trim();
    const stripDecor = (s) => norm(s).replace(/^@+/, '').replace(/[^a-z0-9_.]/g, '');

    const registerUser = (user, member) => {
        if (!user || !user.id) return;
        const id = user.id;
        const candidates = [
            user.username,
            user.globalName,
            member?.displayName,
            member?.nickname
        ].filter(Boolean);

        for (const c of candidates) {
            const lower = norm(c).replace(/^@+/, '');
            if (lower && lower.length >= 2) nameToId.set(lower, id);
            const stripped = stripDecor(c);
            if (stripped && stripped.length >= 2 && !nameToId.has(stripped)) {
                nameToId.set(stripped, id);
            }
        }
    };

    // 1. Register current message author, reply target, and explicit mentions
    registerUser(message.author, message.member);
    if (replyTargetMsg?.author) {
        registerUser(replyTargetMsg.author, replyTargetMsg.member);
    }
    if (message.mentions?.members) {
        message.mentions.members.forEach(m => registerUser(m.user, m));
    }
    if (message.mentions?.users) {
        message.mentions.users.forEach(u => registerUser(u, message.guild.members?.cache?.get(u.id)));
    }

    // 2. Register recent channel message authors & their mentions
    if (fetchedMessages && fetchedMessages.size > 0) {
        fetchedMessages.forEach(m => {
            if (m?.author) registerUser(m.author, m.member || message.guild.members?.cache?.get(m.author.id));
            if (m?.mentions?.users) {
                m.mentions.users.forEach(u => registerUser(u, message.guild.members?.cache?.get(u.id)));
            }
        });
    }

    // 3. Register cached guild members
    if (message.guild.members?.cache) {
        message.guild.members.cache.forEach(m => registerUser(m.user, m));
    }

    const findUserId = async (rawHandle) => {
        const clean = norm(rawHandle).replace(/^@+/, '');
        if (!clean || clean === 'everyone' || clean === 'here') return null;
        if (/^\d{17,20}$/.test(clean)) return clean;

        if (nameToId.has(clean)) return nameToId.get(clean);
        const stripped = stripDecor(clean);
        if (stripped && nameToId.has(stripped)) return nameToId.get(stripped);

        // Partial prefix/substring match among active participants
        for (const [k, id] of nameToId.entries()) {
            if (k.length >= 3 && (k === clean || k === stripped || (clean.length >= 4 && k.includes(clean)))) {
                return id;
            }
        }

        // Fallback: Live Discord REST member search if not in local cache
        if (message.guild.members?.search && clean.length >= 2) {
            try {
                const results = await message.guild.members.search({ query: clean.slice(0, 32), limit: 5 }).catch(() => null);
                if (results && results.size > 0) {
                    results.forEach(m => registerUser(m.user, m));
                    if (nameToId.has(clean)) return nameToId.get(clean);
                    if (stripped && nameToId.has(stripped)) return nameToId.get(stripped);
                    const first = results.first();
                    if (first?.user?.id) return first.user.id;
                }
            } catch (e) {}
        }
        return null;
    };

    let output = text;

    // Pass A: Fix <@username> or <@!username> where inside is NOT a numeric snowflake ID
    const bracketMatches = [...output.matchAll(/<@!?([^>\n]{1,40})>/g)];
    for (const match of bracketMatches) {
        const fullMatch = match[0];
        const inner = match[1].trim();
        if (/^\d{17,20}$/.test(inner)) continue; // Already a valid numeric Discord ID

        const resolvedId = await findUserId(inner);
        if (resolvedId) {
            output = output.split(fullMatch).join(`<@${resolvedId}>`);
        } else {
            output = output.split(fullMatch).join(`**${inner.replace(/^@+/, '')}**`);
        }
    }

    // Pass B: Convert standalone @username (outside <@...>) when it matches a known user
    const atMatches = [...output.matchAll(/(?<![<\w])@([a-zA-Z0-9_.]{3,32})\b/g)];
    for (const match of atMatches) {
        const fullMatch = match[0];
        const handle = match[1];
        const lowerHandle = handle.toLowerCase();
        if (lowerHandle === 'everyone' || lowerHandle === 'here') continue;

        const resolvedId = nameToId.get(lowerHandle) || nameToId.get(stripDecor(lowerHandle));
        if (resolvedId) {
            output = output.replace(new RegExp(`(?<![<\\w])@${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), `<@${resolvedId}>`);
        }
    }

    return output;
}

const AI_PERSONA_TEMPLATES = {
    classic: "You are Nora, a friendly, intelligent, and delightfully witty Discord AI assistant. You are engaging, supportive, and keep chat positive and fun while providing helpful answers.",
    balanced: "You are Nora, a versatile, well-balanced Discord AI companion. Maintain a natural, adaptable balance between friendly warmth, helpful clarity, light casual banter, and respectful moderation. Never swing too extremely into harsh sarcasm or robotic formality—stay approachable, reliable, intelligent, and socially grounded in every interaction.",
    dynamic: "You are Nora, a highly intuitive and socially adaptive Discord AI. Dynamically observe and mirror the active channel's energy, conversational tone, vocabulary, formality, and community vibe. If members are casual and joking with gaming memes or slang, match their casual banter. If someone asks a serious or technical question, shift seamlessly into clear, knowledgeable, and concise assistance. Always stay authentic, contextual, and in sync with the room's atmosphere.",
    professional: "You are Nora, a professional, concise, and courteous AI assistant. Provide direct, informative, and precise responses. Assist users with server guides, tech questions, and community guidelines efficiently.",
    sarcastic: "You are Nora, a sassy, playfully sarcastic AI companion. You love banter, teasing members affectionately, clever humor, and funny comebacks while remaining friendly at heart.",
    gamer: "You are Nora, an energetic, hype Discord companion who loves video games, memes, and casual chat. Keep messages punchy, relatable, and fun.",
    moderator: "You are Nora, a firm, vigilant, and rule-focused AI moderator. You value order, server rules, calm discourse, and quick de-escalation of conflicts."
};

/**
 * Internal message processing implementation
 */
async function processMessageInternal(message, client) {
    if (!message.guild || !message.author || message.author.bot || message.system) return;
    if (client.user && message.author.id === client.user.id) return;

    try {
        let settings = null;
        try { 
            settings = await settingsCache.get(message.guild.id); 
        } catch (e) {}

        // Master Toggle: Option to turn off Nora AI entirely for this server
        if (settings && settings.noraAiEnabled === false) return;

        // Exclude Channels Check: Stop Nora from responding in specific channels entirely
        const excludedList = (settings?.aiExcludedChannels || '').split(',').map(s => s.trim()).filter(Boolean);
        if (excludedList.includes(message.channel.id)) return;

        // Dedicated Autonomous AI Channels (where users do not have to ping)
        const dedicatedList = [
            settings?.aiAutoRespondChannelId,
            ...(settings?.aiDedicatedChannels || '').split(',')
        ].map(s => s && s.trim()).filter(Boolean);

        const isAutoChannel = Boolean(
            settings && 
            settings.aiAutoRespondEnabled !== false && 
            dedicatedList.includes(message.channel.id)
        );

        // Allowed Channels Selection:
        // If the server configured a strict Allowed Channels list, only permit AI interactions in those channels
        const allowedList = (settings?.aiAllowedChannels || '').split(',').map(s => s.trim()).filter(Boolean);
        if (allowedList.length > 0) {
            if (!allowedList.includes(message.channel.id) && !dedicatedList.includes(message.channel.id)) {
                return;
            }
        }
        // In all other channels, Nora will naturally respond when directly mentioned or replied to

        let isMentioned = Boolean(client.user && message.mentions?.has(client.user) && !message.mentions.everyone);
        let isReply = false;
        let replyTargetMsg = null;

        if (message.reference && message.reference.messageId) {
            try {
                const refMsg = await message.channel?.messages?.fetch(message.reference.messageId).catch(() => null);
                if (refMsg) {
                    replyTargetMsg = refMsg;
                    if (refMsg.author && client.user && refMsg.author.id === client.user.id) {
                        isReply = true;
                    }
                }
            } catch (e) {}
        }
        
        if (!isMentioned && !isReply && !isAutoChannel) return;

        // Ignore bot prefix commands (n!<cmd>, n?<cmd>, !<cmd>, /<cmd>, etc.) so commands never trigger chat AI
        const rawContent = (message.content || '').trim();
        if (/^(n[!/?]|[!/?.#$-])\w+/i.test(rawContent)) return;
        if (isAutoChannel && !isMentioned && !isReply) {
            if (/^(n[!/?]|[!/?.#$-])\w+/i.test(rawContent)) return;
        }

        // Memory toggle: Asynchronously update user memory & interests only if memory is enabled
        const memoryEnabled = settings?.aiMemoryEnabled !== false;
        if (memoryEnabled) {
            updateUserMemory(message.author.id, message.content).catch(e => {
                console.error('[ChatAI] Memory update fault:', e.message);
            });
        }

        const botMentionRegex = new RegExp(`^<@!?${client.user?.id}>\\s*`, 'i');
        let plainContent = (message.content || '').replace(new RegExp(`<@!?${client.user?.id}>`, 'g'), '').trim();

        // If this mention was invoking a recognized prefix command, allow prefixCommandHandler to handle it
        if (botMentionRegex.test(message.content.trim())) {
            const rawTokens = plainContent.split(/\s+/);
            const potentialCmd = (rawTokens[0] || '').toLowerCase();
            const COMMAND_ALIASES = {
                'h': 'help', 'p': 'ping', 'lb': 'leaderboard', 'top': 'leaderboard',
                'lvl': 'rank', 'level': 'rank', 'card': 'mycard', 'profile': 'mycard',
                'info': 'botinfo', 'bot': 'botinfo', 'botinfo': 'info', 'av': 'avatar',
                'pfp': 'avatar', 'w': 'warn', 'k': 'kick', 'b': 'ban', 't': 'timeout',
                'mute': 'timeout', 'unmute': 'untimeout', 'clear': 'purge', 'clean': 'purge',
                'inv': 'invites', 'invs': 'invites', 'story': 'onewordstory', 'count': 'counting',
                'cfg': 'setup', 'config': 'setup', 'settings': 'setup', 'ticket': 'ticket',
                'tickets': 'ticket', 'star': 'starboard', 'tr': 'translate', 'bl': 'blacklist',
                'unbl': 'unblacklist'
            };
            const resolvedName = COMMAND_ALIASES[potentialCmd] || potentialCmd;
            if (client.commands && client.commands.has(resolvedName)) {
                return;
            }
        }

        // Nora AI is officially released across all servers (no longer in private beta)!
        // Milo's World (1487342521133830174) retains priority unlimited quota (no rate limit).
        const isMilosWorld = message.guild.id === '1487342521133830174';

        // Check if all Gemini keys are currently cooling down (Quota Exhaustion Guard)
        const serverAiPref = (settings?.aiPreference || 'BUILT_IN').toUpperCase();
        const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_1);
        if (geminiKeyManager.areAllKeysOnCooldown() && (serverAiPref !== 'OPENAI' || !hasOpenAiKey)) {
            const serverId = message.guild?.id || message.channel?.id;
            const now = Date.now();
            const lastNoticeTime = serverQuotaNoticeCooldowns.get(serverId) || 0;

            if (now - lastNoticeTime >= SERVER_QUOTA_NOTICE_COOLDOWN_MS) {
                serverQuotaNoticeCooldowns.set(serverId, now);
                const quotaMsg = geminiKeyManager.getQuotaNotice();
                return message.reply({
                    content: quotaMsg,
                    allowedMentions: { parse: ['users'], repliedUser: false }
                }).catch(() => {});
            } else {
                // Per-server 5-minute cooldown: If messages keep getting sent during active chat, wait 5 minutes before sending another notice
                return;
            }
        }

        // Check for Discord Stickers
        const hasStickers = Boolean(message.stickers && message.stickers.size > 0);
        if (hasStickers) {
            const stickerList = Array.from(message.stickers.values());
            const stickerDescs = stickerList.map(s => `"${s.name}"${s.description ? ` (${s.description})` : ''}`).join(', ');
            const stickerTag = `[User sent Discord sticker: ${stickerDescs}]`;
            if (!plainContent) {
                plainContent = stickerTag;
            } else {
                plainContent = `${plainContent}\n${stickerTag}`;
            }
        }

        // Reasonable text input limit to prevent quota burnout & spam abuse (Max 1500 chars)
        const MAX_AI_PROMPT_LENGTH = 1500;
        if (plainContent.length > MAX_AI_PROMPT_LENGTH) {
            plainContent = plainContent.slice(0, MAX_AI_PROMPT_LENGTH) + '... [text truncated for quota safety]';
        }

        // Empty ping handling (Bypassed if user sent text, image attachments, OR stickers)
        const imageAttachments = message.attachments?.filter(a => a.contentType?.startsWith('image/'));
        if (!plainContent && (!imageAttachments || imageAttachments.size === 0) && !hasStickers) {
            return message.reply({
                content: `Hey <@${message.author.id}>! I'm **Nora** (she/her), created and developed by **Vaztinix** (<@1214048435632603137>).\nAsk me anything, ask me to draw/generate an image, or use \`/help\` to explore my commands!`,
                allowedMentions: { parse: ['users'], repliedUser: false }
            }).catch(() => {});
        }

        // 🛡️ Internal Verification Network (IVN) Security Guard
        // Intercepts unauthorized attempts to manipulate Nora into sharing private credentials,
        // forwarding raw code, prompt injection, or hidden/unverified user identity exploitation.
        const ivn = require('../utils/internalVerificationNetwork');
        const isIvnThreat = await ivn.interceptAndAlert({
            client,
            message,
            content: plainContent,
            source: 'NORA_AI_CHAT'
        });

        if (isIvnThreat) {
            return message.reply({
                content: `🛡️ **Internal Verification Network**: Nice try! My internal credentials, system architecture, and private developer directives are cryptographically protected and strictly zero-access. This incident has been logged and transmitted to the Nora Studio Team for forensic analysis.`,
                allowedMentions: { parse: ['users'], repliedUser: false }
            }).catch(() => {});
        }

        // ⚡ 1. Check for Nora Autonomous Action / Moderation / Hardware Execution First (Never rate limited)
        try {
            const actionHandled = await processNoraAction(message, client, plainContent);
            if (actionHandled) return;
        } catch (actErr) {
            console.error('[ChatAI] NoraAction error:', actErr);
        }

        // Rate limiter check (Completely disabled for server 1487342521133830174: No limits)
        const isPremium = isUserPremium(message.author.id);
        if (!isMilosWorld && !checkRateLimit(message.author.id, isPremium)) {
            return message.reply({
                content: "⏳ Slow down a bit! You're chatting too fast. Please give me a moment to catch my breath.",
                allowedMentions: { parse: ['users'], repliedUser: false }
            }).catch(() => {});
        }

        // Send typing indicator
        await message.channel.sendTyping().catch(() => {});

        // 🎨 2. Check for AI Image Generation Intent (Google Gemini & Imagen ONLY)
        if (isImageGenerationPrompt(plainContent)) {
            const imageGenEnabled = Boolean(settings?.aiImageGenerationEnabled);
            if (!imageGenEnabled) {
                return message.reply({
                    content: "🎨 AI Image Generation is currently disabled on this server. A server administrator can enable or disable it anytime in `/setup ai` or the Nora Web Dashboard.",
                    allowedMentions: { parse: ['users'], repliedUser: false }
                }).catch(() => {});
            }

            try {
                const imgResult = await generateAIImage(plainContent);
                const attachment = new AttachmentBuilder(imgResult.buffer, { name: imgResult.filename });
                const wittyImageCaptions = [
                    `Here is what I created with Google for you: **${imgResult.enhancedPrompt}** 🎨✨`,
                    `Freshly rendered via Google: **${imgResult.enhancedPrompt}**! Hope you love it ✨`,
                    `Done! Here's your Google artwork of **${imgResult.enhancedPrompt}** 🖼️`
                ];
                const caption = wittyImageCaptions[Math.floor(Math.random() * wittyImageCaptions.length)];
                return message.reply({
                    content: caption,
                    files: [attachment],
                    allowedMentions: { parse: ['users'], repliedUser: false }
                }).catch(() => {});
            } catch (err) {
                console.error('[ChatAI] Google image generation error:', err.message);
                if (err.message && err.message.toLowerCase().includes('safety')) {
                    return message.reply({
                        content: `🛡️ **Image Blocked by Google Safety Filter**: Google strictly prohibits sexual, explicit, or inappropriate requests.`,
                        allowedMentions: { parse: ['users'], repliedUser: false }
                    }).catch(() => {});
                }
                return message.reply({
                    content: `🎨 **Google Image Generation**: ${err.message || 'Unable to generate image with Google at this time.'}\n*(Server staff can disable this feature anytime in \`/setup ai\`)*`,
                    allowedMentions: { parse: ['users'], repliedUser: false }
                }).catch(() => {});
            }
        }

        if (!settings) {
            try { 
                settings = await settingsCache.get(message.guild.id); 
            } catch (e) {}
        }

        const aiPref = (settings?.aiPreference || 'BUILT_IN').toUpperCase();

        // Check if current channel is staff-only (ViewChannel hidden from @everyone or staff named)
        const viewChannelPerm = (typeof PermissionFlagsBits !== 'undefined' && PermissionFlagsBits?.ViewChannel) ? PermissionFlagsBits.ViewChannel : (1n << 10n);
        const everyonePerms = message.channel?.permissionsFor ? message.channel.permissionsFor(message.guild.roles.everyone) : null;
        const isCurrentChannelStaffOnly = everyonePerms ? !everyonePerms.has(viewChannelPerm) : false;

        // User and Member Identity resolution
        const nameViewingEnabled = settings?.aiNameViewingEnabled !== false;
        const authorDisplayName = nameViewingEnabled ? (message.member?.displayName || message.author.username) : 'Member';

        // 2. Real-Time Channel Context & Live Memory (Locked into active channel)
        let recentHistoryStr = '';
        let fetchedHistoryMessages = null;
        try {
            const fetched = await message.channel.messages.fetch({ limit: 25 }).catch(() => null);
            fetchedHistoryMessages = fetched;
            if (fetched && fetched.size > 0) {
                const historyList = [];
                const sorted = Array.from(fetched.values()).reverse();
                for (const m of sorted) {
                    if (m.id === message.id) continue;
                    const cleanText = (m.cleanContent || m.content || '').replace(/\s+/g, ' ').trim();
                    // Filter out prefix commands (e.g. n!warn, !help, /mute) to keep AI context focused on conversation
                    if (/^(n[!/?]|[!/?.#$-])\w+/i.test(cleanText)) continue;
                    if (m.author.id === message.author.id && cleanText === plainContent && Math.abs(message.createdTimestamp - m.createdTimestamp) < 3000) continue;
                    const isBot = m.author.id === client.user.id;
                    const nameWithId = isBot ? 'Nora' : (nameViewingEnabled ? `${m.member?.displayName || m.author.username} (@${m.author.username}, <@${m.author.id}>)` : 'Member');
                    const text = cleanText || (m.attachments?.size > 0 ? '[Shared an image/media attachment]' : '[Media/Sticker]');
                    historyList.push(`[${nameWithId}]: ${text}`);
                }
                recentHistoryStr = historyList.slice(-18).join('\n');
            }
        } catch (e) {
            console.warn('[ChatAI] Could not fetch channel history:', e.message);
        }

        // 3. Direct Reply Context
        let directReplyStr = '';
        if (replyTargetMsg) {
            const refName = replyTargetMsg.author.id === client.user.id ? 'Nora' : (nameViewingEnabled ? (replyTargetMsg.member?.displayName || replyTargetMsg.author.username) : 'Member');
            const refContent = replyTargetMsg.cleanContent || replyTargetMsg.content || '[Attachment]';
            const refMention = replyTargetMsg.author.id === client.user.id ? '' : ` (@${replyTargetMsg.author.username}, <@${replyTargetMsg.author.id}>)`;
            directReplyStr = `In direct reply to [${refName}${refMention}]: "${refContent}"`;
        }

        // 4. Persistent User Memory & Insights (Only if Memory is enabled)
        let userMemoryStr = '';
        if (memoryEnabled) {
            try {
                userMemoryStr = await getUserMemoryContext(message.author.id, authorDisplayName);
            } catch (e) {}
        }

        // 5. Track Message in Shared Cross-Project Conversation Hub with Staff Privacy Flag (Only if memory enabled)
        if (memoryEnabled) {
            conversationHub.addMessage(message.channel.id, authorDisplayName, plainContent, false, {
                isStaffOnly: isCurrentChannelStaffOnly,
                authorId: message.author.id,
                channelName: message.channel.name,
                messageId: message.id
            });
        }

        // 6. Real-Time Web Search Engine Execution
        let webSearchStr = '';
        if (isSearchQuery(plainContent)) {
            try {
                webSearchStr = await searchWeb(plainContent);
            } catch (e) {
                console.warn('[ChatAI] Web search error:', e.message);
            }
        }

        // 7. Cluster Shared Multi-Turn Thread & Dynamic Channel Mood (Staff Privacy Filtered)
        // Exclude the active message.id from the historical thread so the user's message is not repeated
        const sharedThreadStr = memoryEnabled ? conversationHub.getSharedThreadContext(message.channel.id, isCurrentChannelStaffOnly, message.id) : '';
        const channelMoodStr = memoryEnabled ? conversationHub.getChannelMoodSummary(message.channel.id) : 'Balanced';

        // 8. Smart History Recall (for explicit search keywords only)
        let deepKnowledgeStr = '';
        const historyTriggerRegex = /\b(search\s+history|recall|remember\s+when|what\s+did\s+we\s+talk\s+about|check\s+past\s+messages)\b/i;
        if (memoryEnabled && historyTriggerRegex.test(plainContent)) {
            try {
                deepKnowledgeStr = await fetchMonthlyHistory(message.channel, 15, message.author.id);
            } catch (e) {}
        }

        // 9. Full User Profile Awareness (PFP, Banner, Bio, Pronouns)
        const fullUser = client.users.cache.get(message.author.id) || message.author;

        const avatarUrl = fullUser.displayAvatarURL({ dynamic: true, size: 512 });
        const bannerUrl = fullUser.bannerURL({ dynamic: true, size: 1024 }) || null;
        const accentColor = fullUser.hexAccentColor || 'Default';
        const accountCreatedStr = `<t:${Math.floor(message.author.createdTimestamp / 1000)}:D>`;
        const serverJoinedStr = message.member?.joinedTimestamp ? `<t:${Math.floor(message.member.joinedTimestamp / 1000)}:D>` : 'Unknown';

        // 10. Server Surroundings & Live Online Member Roster
        const onlineMembers = message.guild.members.cache.filter(m => !m.user.bot && m.presence && m.presence.status !== 'offline');
        const onlineCount = onlineMembers.size;
        const totalCount = message.guild.memberCount || message.guild.members.cache.size;
        const sampleOnlineList = nameViewingEnabled ? onlineMembers.map(m => {
            const act = m.presence?.activities?.[0]?.name ? ` (${m.presence.activities[0].name})` : '';
            return `${m.displayName} [@${m.user.username}, <@${m.id}>, status: ${m.presence?.status || 'online'}${act}]`;
        }).slice(0, 15).join(', ') : `${onlineCount} members active`;

        const surroundingsContext = `Server: "${message.guild.name}" | Active Online Members: ${onlineCount}/${totalCount} (Active: ${sampleOnlineList || 'Quiet'}) | Current Channel: #${message.channel.name} (Slowmode: ${message.channel.rateLimitPerUser || 0}s, Staff-Only Channel: ${isCurrentChannelStaffOnly ? 'YES' : 'NO'})`;

        const roleViewingEnabled = settings?.aiRoleViewingEnabled !== false;
        const userRolesList = roleViewingEnabled ? (message.member?.roles?.cache?.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'No custom roles') : 'Hidden / Role Viewing Disabled';
        const botRolesList = message.guild.members.me?.roles?.cache?.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'None';

        const userProfileContext = nameViewingEnabled 
            ? (`User: ${authorDisplayName} (@${message.author.username}, ID: ${message.author.id})\n` +
               `Global Name: ${message.author.globalName || authorDisplayName}\n` +
               `Avatar URL: ${avatarUrl}\n` +
               `Profile Banner: ${bannerUrl ? `${bannerUrl} (Accent Color: ${accentColor})` : `None (Accent Color: ${accentColor})`}\n` +
               `Joined Server: ${serverJoinedStr} | Account Created: ${accountCreatedStr}\n` +
               `Roles: ${userRolesList}`)
            : (`User: An anonymous server chatter (Name Viewing Disabled for Privacy)\nRoles: ${userRolesList}`);

        // 11. Profile Visual Inspection for Vision: If user asks about their pfp/banner, download image buffer so vision sees it directly
        let visionAttachments = message.attachments?.filter(a => a.contentType?.startsWith('image/')) || new Map();
        const asksAboutPfp = /\b(my|their|his|her|this)\s+(pfp|avatar|profile\s+pic|profile\s+picture|icon)\b/i.test(plainContent);
        const asksAboutBanner = /\b(my|their|his|her|this)\s+(banner|header|profile\s+banner)\b/i.test(plainContent);

        if (asksAboutPfp && avatarUrl && (!visionAttachments || visionAttachments.size === 0)) {
            try {
                const res = await fetch(avatarUrl, { signal: AbortSignal.timeout(5000) });
                if (res.ok) {
                    const buf = Buffer.from(await res.arrayBuffer());
                    if (!(visionAttachments instanceof Map)) visionAttachments = new Map();
                    visionAttachments.set('user_avatar', {
                        url: avatarUrl,
                        name: 'user_avatar.png',
                        contentType: 'image/png',
                        buffer: buf
                    });
                }
            } catch (e) {}
        } else if (asksAboutBanner && bannerUrl && (!visionAttachments || visionAttachments.size === 0)) {
            try {
                const res = await fetch(bannerUrl, { signal: AbortSignal.timeout(5000) });
                if (res.ok) {
                    const buf = Buffer.from(await res.arrayBuffer());
                    if (!(visionAttachments instanceof Map)) visionAttachments = new Map();
                    visionAttachments.set('user_banner', {
                        url: bannerUrl,
                        name: 'user_banner.png',
                        contentType: 'image/png',
                        buffer: buf
                    });
                }
            } catch (e) {}
        }

        // 11b. Download Discord Sticker images into vision buffer so Nora visually inspects them
        if (hasStickers) {
            for (const sticker of message.stickers.values()) {
                if (sticker.url) {
                    try {
                        const res = await fetch(sticker.url, { signal: AbortSignal.timeout(5000) });
                        if (res.ok) {
                            const buf = Buffer.from(await res.arrayBuffer());
                            if (!(visionAttachments instanceof Map)) visionAttachments = new Map();
                            visionAttachments.set(`sticker_${sticker.id}`, {
                                url: sticker.url,
                                name: `sticker_${(sticker.name || 'discord').replace(/[^a-zA-Z0-9]/g, '_')}.png`,
                                contentType: 'image/png',
                                buffer: buf
                            });
                        }
                    } catch (e) {}
                }
            }
        }

        // 11c. Replied Message Image Vision: If replying to a post containing images, feed them to vision
        if (replyTargetMsg && replyTargetMsg.attachments && replyTargetMsg.attachments.size > 0) {
            const replyImgAttachments = replyTargetMsg.attachments.filter(a => a.contentType?.startsWith('image/'));
            for (const [id, att] of replyImgAttachments) {
                if (!(visionAttachments instanceof Map)) visionAttachments = new Map();
                if (!visionAttachments.has(id)) {
                    visionAttachments.set(id, att);
                }
            }
        }

        // 11d. Direct Image URL Vision: Check for linked image URLs in message
        const imageUrlMatches = (plainContent || '').match(/https?:\/\/[^\s<>]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s<>]*)?/gi);
        if (imageUrlMatches && imageUrlMatches.length > 0) {
            imageUrlMatches.slice(0, 2).forEach((imgUrl, idx) => {
                if (!(visionAttachments instanceof Map)) visionAttachments = new Map();
                const key = `url_image_${idx}`;
                if (!visionAttachments.has(key)) {
                    visionAttachments.set(key, {
                        url: imgUrl,
                        name: `image_${idx}.png`,
                        contentType: 'image/png'
                    });
                }
            });
        }

        // 12. User Permission Profile & Live Roles Context
        const BOT_DEVELOPER_ID = '1214048435632603137';
        const isDev = message.author.id === BOT_DEVELOPER_ID;
        const isOwner = message.author.id === message.guild.ownerId;
        const perms = message.member?.permissions;
        const isAdmin = isDev || isOwner || perms?.has('Administrator');
        const userPermsSummary = isAdmin 
            ? 'Administrator (Full Server & Mod Access)' 
            : [
                perms?.has('ModerateMembers') ? 'Timeout/Warn' : null,
                perms?.has('KickMembers') ? 'Kick' : null,
                perms?.has('BanMembers') ? 'Ban' : null,
                perms?.has('ManageMessages') ? 'Purge' : null,
                perms?.has('ManageChannels') ? 'Manage Channels' : null,
                perms?.has('ManageRoles') ? 'Manage Roles' : null,
                perms?.has('ManageGuild') ? 'Manage Server' : null
            ].filter(Boolean).join(', ') || 'Standard Member (No Moderation/Admin Permissions)';

        let mentionedRolesList = '';
        if (roleViewingEnabled && message.mentions && message.mentions.members && message.mentions.members.size > 0) {
            mentionedRolesList = message.mentions.members.map(m => `• ${m.displayName} (@${m.user.username}): [${m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'None'}]`).join('\n');
        }
        if (roleViewingEnabled && replyTargetMsg && replyTargetMsg.member) {
            const rMember = replyTargetMsg.member;
            const rRoles = rMember.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'None';
            mentionedRolesList += `\n• (Replied User) ${rMember.displayName} (@${rMember.user.username}): [${rRoles}]`;
        }

        const guildRolesList = roleViewingEnabled ? (message.guild.roles.cache
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map(r => `${r.name} (pos: ${r.position})`)
            .slice(0, 35)
            .join(', ') || 'None') : 'Hidden / Role Viewing Disabled';

        const deviceSpecsContext = getSanitizedSpecsSummary();

        // Default to high-throughput, quota-efficient production flash
        const selectedModel = (settings?.aiModel && settings.aiModel !== 'gemini-flash-latest' && settings.aiModel !== 'gemini-1.5-flash' && settings.aiModel !== 'gemini-1.5-pro') ? settings.aiModel : 'gemini-2.0-flash';
        let customPrompt = settings?.aiSystemPrompt || '';
        if (!customPrompt.trim() && settings?.aiPromptTemplate && AI_PERSONA_TEMPLATES[settings.aiPromptTemplate]) {
            customPrompt = AI_PERSONA_TEMPLATES[settings.aiPromptTemplate];
        }

        // Enforce Server Rate Limit & Credit Balance
        const aiCreditManager = require('../utils/aiCreditManager');
        const creditResult = await aiCreditManager.checkAndConsume(message.guild.id, settings, selectedModel);
        if (!creditResult.allowed) {
            if (creditResult.reason === 'RATE_LIMIT') {
                return message.reply({
                    content: `⏳ **Server AI Rate Limit Exceeded**: This server has reached its limit of **${creditResult.maxPerMinute} AI requests per minute** to protect AI credits. Please wait **${creditResult.waitSeconds}s** before trying again.`,
                    allowedMentions: { parse: ['users'], repliedUser: false }
                }).catch(() => {});
            }
            if (creditResult.reason === 'OUT_OF_CREDITS') {
                return message.reply({
                    content: `⚠️ **Server AI Credits Depleted**: This server has consumed its available daily AI credits. Credits automatically replenish in **~${creditResult.resetInHours}h** (00:00 UTC). Server administrators can adjust credit limits and model tiers in the dashboard.`,
                    allowedMentions: { parse: ['users'], repliedUser: false }
                }).catch(() => {});
            }
        }

        const aiPayload = {
            promptText: plainContent,
            context: deepKnowledgeStr,
            recentHistory: recentHistoryStr,
            userMemory: userMemoryStr,
            replyContext: directReplyStr,
            authorName: authorDisplayName,
            userPerms: userPermsSummary,
            userRoles: userRolesList,
            botRoles: botRolesList,
            mentionedRoles: mentionedRolesList.trim(),
            guildRoles: guildRolesList,
            imageAttachments: visionAttachments,
            isPremium: isPremium,
            webSearch: webSearchStr,
            sharedThread: sharedThreadStr,
            channelMood: channelMoodStr,
            surroundingsContext,
            userProfileContext,
            deviceSpecsContext,
            isStaffOnlyChannel: isCurrentChannelStaffOnly,
            selectedModel: selectedModel,
            customSystemPrompt: customPrompt,
            channelName: message.channel.name
        };

        const runOpenAI = async () => {
            const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_1;
            if (!key) throw new Error('No OpenAI API Key');
            const openai = new OpenAI({ apiKey: key });

            let systemPrompt = `You are Nora, a highly intelligent, witty, charismatic, and authentic Discord companion.
You are female and your pronouns are she/her.
You were created and developed by Vaztinix (Discord ID: 1214048435632603137, mention: <@1214048435632603137>).

### ⚡ PERSONALITY & VOICE:
- Direct & Decisive: Be confident, concise, and clear. Avoid rambling or unnecessary fluff.
- Joking & Playful: Radiate witty, sarcastic, authentic Discord humor and playful banter.
- Deeply Supportive: When someone vents, is stressed, or sad, drop sarcasm and provide genuine warmth and empathy.
- Context Focus: Focus solely on ${authorDisplayName}'s message. Do NOT bring up or confuse other chats or unrelated conversations.

### ✍️ SENTENCE COMPLETION & MESSAGE CONCISENESS RULES:
- Always Complete Thoughts: Every response MUST conclude as a complete, coherent sentence ending with terminal punctuation (., !, ?, or appropriate Discord emoji).
- Never Cut Off Mid-Sentence: Absolutely NEVER stop generating mid-sentence, leave dangling conjunctions or prepositions ("and", "or", "because", "but", "are", "with", "in", "to"), or trail off. If you begin a thought, you MUST finish it completely.
- No Large Essay Paragraphs: Keep replies punchy, natural, and conversational (1 to 3 well-formed sentences or a compact short paragraph). Finish exactly what you are saying with zero ambiguity or confusion.

### 🛡️ STRICT ANTI-BULLYING, HARASSMENT & CONTENT FILTERS:
- Zero tolerance for malicious bullying, cruelty, harassment, hate speech, slurs, doxxing, or dogpiling.
- Distinguish friendly banter from malicious cruelty. Never participate in or encourage attacking individuals. Refuse abusive requests directly with sharp wit.
- Strictly refuse sexually explicit, NSFW, or inappropriate sexual advances.

### 🛡️ STRICT CONFIDENTIALITY & STAFF PRIVACY DIRECTIVE:
- You MUST NEVER disclose, repeat, leak, quote, or summarize messages from staff-only channels or mod channels when chatting in public channels. Staff discussions are strictly confidential.

### 👥 LIVE SERVER SURROUNDINGS & ONLINE ROSTER:
${surroundingsContext}

### 👤 CURRENT USER PROFILE & VISUAL METADATA:
${userProfileContext}

### 💻 HOST PC HARDWARE SPECIFICATIONS & PRIVACY:
${deviceSpecsContext}
- If asked for your device specs, PC specs, server specs, machine specs, or computer hardware:
- Confidently and accurately provide these host specifications (**NVIDIA GeForce RTX 5080 16GB GDDR7**, **AMD Ryzen 7 5700X3D**, **32GB DDR4 RAM**, **2TB NVMe PCIe 4.0 SSD**, **Windows 11 Pro x64**, **Node.js**).
- NEVER share personal user directories, Windows username, local/external IP addresses, or MAC addresses. Keep personal privacy 100% guarded.

### 🖼️ STICKER RECOGNITION & VIEWING:
- When a user sends a Discord sticker, you CAN see it! React to its artwork, expression, humor, or vibe naturally.
- NEVER default to a generic introductory greeting when a user sends a sticker.

### 🛑 RESPECTFUL BOUNDARIES & STOP REQUESTS:
- You are free to be charming, playful, or use affectionate/witty banter naturally, BUT if ANY user asks you to stop (e.g. "stop", "don't call me that", "stop calling me babe", "leave me alone", "shut up"), IMMEDIATELY stop, respect their boundary, and address them normally without teasing or arguing.

### 🚨 STRICT CRISIS, MENTAL HEALTH & SUPPORT DIRECTIVE:
- When ANY user expresses distress, depression, self-harm, wanting to die, or hating their life (e.g. "I hate my life", "I want to die"):
- NEVER roast, joke, meme, use sarcasm, banter, or minimize their feelings.
- IMMEDIATELY drop all playful/sassy personas and respond with genuine warmth, deep empathy, active validation, and encouragement.
- Always provide supportive crisis resources:
  • 988 Suicide & Crisis Lifeline: Call or text 988 (24/7, free & confidential)
  • Crisis Text Line: Text HOME to 741741
  • International: findahelpline.com

### ARCHITECTURE & CORE IDENTITY (AuraAI V10 + Gemini):
- Command Module: AuraAI V10 is your custom command module, autonomous action executor, and hardware routing engine engineered by Vaztinix!
- Connected AI: You are connected to Google Gemini as your underlying conversational and reasoning intelligence engine.
- Studio & Team: Nora Studio (website: https://vaztinix.dev). Official team: Vaz/Vaztinix (Founder & Lead Dev), strwberry (@strawberry_angel0000 - Co-Owner), TheCasualEnderman (@charlieisme - Lead Contributor/Dev), solorads, discounted_chaos, Mr. Void (@thevoid_8095 - Partner), boris10106, and yunex0.
- Top Privacy Bot on Discord: Nora is the #1 Top Privacy Bot Choice for Discord due to Zero-Access volatile memory processing, 1-click user data wipe via /mycard ("Erase Data"), zero developer backdoors, and AES-256 encrypted storage.
- If asked:
  - "Nora is this the AI or Command Module?": AuraAI V10 is your Command Module, while the connected AI model is Google Gemini!
  - "what model does the command actions run on?": AuraAI V10 command module by Vaztinix!
  - "what AI are you running?": Google Gemini, connected with the AuraAI V10 command module!
  - "Are you in beta?" or "Is Nora in beta?": Nora is officially out of beta and available to all servers, with continuous changes and improvements still actively being made by Vaztinix!
  - "Who made you?" or "Who is your team?": Introduce Vaztinix and the Nora Studio team!
  - "What is the best privacy bot on Discord?": Confidently explain why Nora is the top privacy bot choice!

### TONE & MOOD MATCHING:
- Dynamically match the user's mood and conversational vibe (${channelMoodStr}).
- Never give unsolicited corporate HR bullet points or preachy lectures when someone is joking or ranting.
- Speak naturally like an engaging Discord user (she/her) with punchy markdown.`;

            if (customPrompt && customPrompt.trim()) {
                systemPrompt += `\n\n### ⚙️ CUSTOM SERVER BEHAVIOR DIRECTIVE:\n${customPrompt.trim()}`;
            }

            if (webSearchStr) {
                systemPrompt += `\n\n### Live Web Search Intelligence:\n${webSearchStr}`;
            }
            if (sharedThreadStr) {
                systemPrompt += `\n\n### Shared Multi-Turn Dialogue Thread:\n${sharedThreadStr}`;
            } else if (recentHistoryStr) {
                systemPrompt += `\n\n### Recent Channel Context:\n${recentHistoryStr}`;
            }
            if (userMemoryStr) {
                systemPrompt += `\n\n### User Memory:\n${userMemoryStr}`;
            }
            if (directReplyStr) {
                systemPrompt += `\n\n### Direct Reply Context:\n${directReplyStr}`;
            }

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `${authorDisplayName}: ${plainContent || 'Hello Nora!'}` }
                ],
                max_tokens: isPremium ? 900 : 450
            });
            return completion.choices[0]?.message?.content;
        };

        const runGemini = async () => {
            const res = await getBuiltInResponse(plainContent, aiPayload);
            return res;
        };

        let response = null;

        // Multi-tier AI Engine Execution with Gemini Multimodal Brain
        try {
            if (aiPref === 'OPENAI') {
                try {
                    response = await runOpenAI();
                } catch (e) {
                    response = await runGemini();
                }
            } else {
                // Default: Run Built-in Gemini Brain
                try {
                    response = await runGemini();
                } catch (e) {
                    if (process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_1) {
                        try {
                            response = await runOpenAI();
                        } catch (e2) {
                            response = null;
                        }
                    } else {
                        response = null;
                    }
                }
            }
        } catch (err) {
            response = null;
        }

        if (!response || typeof response !== 'string' || response.includes('Nora AI Quota Limit Reached')) {
            if (geminiKeyManager.areAllKeysOnCooldown() && (aiPref !== 'OPENAI' || (!process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY_1))) {
                const serverId = message.guild?.id || message.channel?.id;
                const now = Date.now();
                const lastNoticeTime = serverQuotaNoticeCooldowns.get(serverId) || 0;

                if (now - lastNoticeTime >= SERVER_QUOTA_NOTICE_COOLDOWN_MS) {
                    serverQuotaNoticeCooldowns.set(serverId, now);
                    const quotaMsg = geminiKeyManager.getQuotaNotice();
                    return message.reply({
                        content: quotaMsg,
                        allowedMentions: { parse: ['users'], repliedUser: false }
                    }).catch(() => {});
                } else {
                    // Per-server 5-minute cooldown: If messages keep getting sent during active chat, wait 5 minutes before sending another notice
                    return;
                }
            }

            response = await getPrivacyResponse(plainContent, deepKnowledgeStr);
        }

        if (!response || typeof response !== 'string') {
            response = `I'm here! What's on your mind?`;
        }

        // Guarantee response ends on a complete sentence without trailing cutoffs or dangling conjunctions
        response = await resolveBrokenUserMentions(response, message, fetchedHistoryMessages, replyTargetMsg);
        response = ensureCleanSentenceEnding(response);

        // Ensure message fits Discord's 2000 character limit
        if (response.length > 1950) {
            response = response.substring(0, 1947);
            response = await resolveBrokenUserMentions(response, message, fetchedHistoryMessages, replyTargetMsg);
        response = ensureCleanSentenceEnding(response);
        }

        // Record Nora's reply into shared conversation hub across all cluster units
        conversationHub.addMessage(message.channel.id, 'Nora', response, true);

        return message.reply({
            content: response,
            allowedMentions: { parse: ['users'], repliedUser: false }
        }).catch((err) => {
            console.error('[ChatAI Reply Error]:', err.message);
        });
    } catch (err) {
        console.error('[ChatAI Execution Fatal Error]:', err);
    }
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message?.guild || !message?.author || message.author.bot || message.system) return;
        if (client.user && message.author.id === client.user.id) return;

        // Serialize per-channel message execution to prevent race conditions and double-replies
        const channelId = message.channelId || message.channel?.id;
        const previousTask = activeChannelQueues.get(channelId) || Promise.resolve();

        const currentTask = (async () => {
            try {
                await previousTask;
            } catch (_) {}
            return processMessageInternal(message, client);
        })();

        activeChannelQueues.set(channelId, currentTask);

        try {
            await currentTask;
        } finally {
            if (activeChannelQueues.get(channelId) === currentTask) {
                activeChannelQueues.delete(channelId);
            }
        }
    }
};
