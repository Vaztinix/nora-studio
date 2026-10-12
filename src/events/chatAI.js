const { Events, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const OpenAI = require('openai');
const settingsCache = require('../utils/settingsCache');
const { getPrivacyResponse } = require('../utils/privateBrain');
const { getBuiltInResponse } = require('../utils/builtInBrain');
const { fetchMonthlyHistory } = require('../utils/aiTools');
const { checkRateLimit } = require('../utils/aiRateLimiter');
const { isUserPremium } = require('../utils/premiumManager');
const { getUserMemoryContext, updateUserMemory } = require('../utils/userMemoryManager');
const { isImageGenerationPrompt, generateAIImage } = require('../utils/aiImageGenerator');
const { processNoraAction } = require('../utils/noraActionExecutor');
const rokuController = require('../utils/rokuController');
const geminiKeyManager = require('../utils/geminiKeyManager');
const conversationHub = require('../utils/conversationHub');
const { searchWeb, isSearchQuery } = require('../utils/searchEngine');
const { getSanitizedSpecsSummary } = require('../utils/deviceSpecs');

/**
 * Nora Core V20.0 - Gemini Multimodal Intelligence & Image Generation Engine
 * Handles full memory, mood matching, multimodal vision, and AI image synthesis.
 * Nora is female (she/her) created and developed by Vaztinix (1214048435632603137).
 */
module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot || message.system) return;
        if (client.user && message.author.id === client.user.id) return;

        let settings = null;
        try { 
            settings = await settingsCache.get(message.guild.id); 
        } catch (e) {}

        const isAutoChannel = Boolean(
            settings && 
            settings.aiAutoRespondChannelId && 
            settings.aiAutoRespondEnabled !== false && 
            message.channel.id === settings.aiAutoRespondChannelId
        );

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

        // In auto-channel mode without explicit mention/reply, ignore bot command triggers
        if (isAutoChannel && !isMentioned && !isReply) {
            const trimmed = (message.content || '').trim();
            if (/^[!/?.#$-]\w+/i.test(trimmed)) return;
        }

        // Asynchronously update user memory & interests
        updateUserMemory(message.author.id, message.content).catch(e => {
            console.error('[ChatAI] Memory update fault:', e.message);
        });

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

        // Empty ping handling (Bypassed if user sent text, image attachments, OR stickers)
        const imageAttachments = message.attachments?.filter(a => a.contentType?.startsWith('image/'));
        if (!plainContent && (!imageAttachments || imageAttachments.size === 0) && !hasStickers) {
            return message.reply({
                content: `Hey <@${message.author.id}>! I'm **Nora** (she/her), created and developed by **Vaztinix** (<@1214048435632603137>).\nAsk me anything, ask me to draw/generate an image, or use \`/help\` to explore my commands!`,
                allowedMentions: { repliedUser: false }
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
                allowedMentions: { repliedUser: false }
            }).catch(() => {});
        }

        // Send typing indicator
        await message.channel.sendTyping().catch(() => {});

        // 🎨 2. Check for AI Image Generation Intent
        if (isImageGenerationPrompt(plainContent)) {
            try {
                const imgResult = await generateAIImage(plainContent);
                const attachment = new AttachmentBuilder(imgResult.buffer, { name: imgResult.filename });
                const wittyImageCaptions = [
                    `Here is what I created for you: **${imgResult.enhancedPrompt}** 🎨✨`,
                    `Freshly rendered: **${imgResult.enhancedPrompt}**! Hope you love it ✨`,
                    `Done! Here's your artwork of **${imgResult.enhancedPrompt}** 🖼️`
                ];
                const caption = wittyImageCaptions[Math.floor(Math.random() * wittyImageCaptions.length)];
                return message.reply({
                    content: caption,
                    files: [attachment],
                    allowedMentions: { repliedUser: false }
                }).catch(() => {});
            } catch (err) {
                console.error('[ChatAI] Image generation error:', err.message);
                // If image generation fails, continue to normal conversational reply
            }
        }

        if (!settings) {
            try { 
                settings = await settingsCache.get(message.guild.id); 
            } catch (e) {}
        }

        const aiPref = (settings?.aiPreference || 'BUILT_IN').toUpperCase();

        // Check if current channel is staff-only (ViewChannel hidden from @everyone or staff named)
        const everyonePerms = message.channel.permissionsFor(message.guild.roles.everyone);
        const isCurrentChannelStaffOnly = everyonePerms ? !everyonePerms.has(PermissionFlagsBits.ViewChannel) : false;

        // 2. Fetch Recent Channel Messages (Expanded Short-term Working Memory)
        let recentHistoryStr = '';
        try {
            const fetched = await message.channel.messages.fetch({ limit: 35 }).catch(() => null);
            if (fetched && fetched.size > 0) {
                const historyList = [];
                const sorted = Array.from(fetched.values()).reverse();
                for (const m of sorted) {
                    if (m.id === message.id) continue;
                    const name = m.author.id === client.user.id ? 'Nora' : (m.member?.displayName || m.author.username);
                    const cleanText = (m.cleanContent || m.content || '').replace(/\s+/g, ' ').trim();
                    if (!cleanText && (!m.attachments || m.attachments.size === 0)) continue;
                    historyList.push(`[${name}]: ${cleanText || '[Sent an image/attachment]'}`);
                }
                recentHistoryStr = historyList.slice(-25).join('\n');
            }
        } catch (e) {
            console.warn('[ChatAI] Could not fetch channel history:', e.message);
        }

        // 3. Direct Reply Context
        let directReplyStr = '';
        if (replyTargetMsg) {
            const refName = replyTargetMsg.author.id === client.user.id ? 'Nora' : (replyTargetMsg.member?.displayName || replyTargetMsg.author.username);
            const refContent = replyTargetMsg.cleanContent || replyTargetMsg.content || '[Attachment]';
            directReplyStr = `In direct reply to [${refName}]: "${refContent}"`;
        }

        // 4. Persistent User Memory & Insights
        const authorDisplayName = message.member?.displayName || message.author.username;
        let userMemoryStr = '';
        try {
            userMemoryStr = await getUserMemoryContext(message.author.id, authorDisplayName);
        } catch (e) {}

        // 5. Track Message in Shared Cross-Project Conversation Hub with Staff Privacy Flag
        conversationHub.addMessage(message.channel.id, authorDisplayName, plainContent, false, {
            isStaffOnly: isCurrentChannelStaffOnly,
            authorId: message.author.id,
            channelName: message.channel.name
        });

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
        const sharedThreadStr = conversationHub.getSharedThreadContext(message.channel.id, isCurrentChannelStaffOnly);
        const channelMoodStr = conversationHub.getChannelMoodSummary(message.channel.id);

        // 8. Smart History Recall (for explicit search keywords)
        let deepKnowledgeStr = '';
        if (['recall', 'history', 'search', 'last', 'remember', 'previous'].some(w => plainContent.toLowerCase().includes(w))) {
            try {
                deepKnowledgeStr = await fetchMonthlyHistory(message.channel, 15, message.author.id);
            } catch (e) {}
        }

        // 9. Full User Profile Awareness (PFP, Banner, Bio, Pronouns)
        let fullUser = null;
        try {
            fullUser = await client.users.fetch(message.author.id, { force: true });
        } catch (e) {
            fullUser = message.author;
        }

        const avatarUrl = fullUser.displayAvatarURL({ dynamic: true, size: 512 });
        const bannerUrl = fullUser.bannerURL({ dynamic: true, size: 1024 }) || null;
        const accentColor = fullUser.hexAccentColor || 'Default';
        const accountCreatedStr = `<t:${Math.floor(message.author.createdTimestamp / 1000)}:D>`;
        const serverJoinedStr = message.member?.joinedTimestamp ? `<t:${Math.floor(message.member.joinedTimestamp / 1000)}:D>` : 'Unknown';

        // 10. Server Surroundings & Live Online Member Roster
        const onlineMembers = message.guild.members.cache.filter(m => !m.user.bot && m.presence && m.presence.status !== 'offline');
        const onlineCount = onlineMembers.size;
        const totalCount = message.guild.memberCount || message.guild.members.cache.size;
        const sampleOnlineList = onlineMembers.map(m => {
            const act = m.presence?.activities?.[0]?.name ? ` (${m.presence.activities[0].name})` : '';
            return `${m.displayName} [@${m.user.username}, status: ${m.presence?.status || 'online'}${act}]`;
        }).slice(0, 15).join(', ');

        const surroundingsContext = `Server: "${message.guild.name}" | Active Online Members: ${onlineCount}/${totalCount} (Active: ${sampleOnlineList || 'Quiet'}) | Current Channel: #${message.channel.name} (Slowmode: ${message.channel.rateLimitPerUser || 0}s, Staff-Only Channel: ${isCurrentChannelStaffOnly ? 'YES' : 'NO'})`;

        const userRolesList = message.member?.roles?.cache?.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'No custom roles';
        const botRolesList = message.guild.members.me?.roles?.cache?.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'None';

        const userProfileContext = `User: ${authorDisplayName} (@${message.author.username}, ID: ${message.author.id})\n` +
            `Global Name: ${message.author.globalName || authorDisplayName}\n` +
            `Avatar URL: ${avatarUrl}\n` +
            `Profile Banner: ${bannerUrl ? `${bannerUrl} (Accent Color: ${accentColor})` : `None (Accent Color: ${accentColor})`}\n` +
            `Joined Server: ${serverJoinedStr} | Account Created: ${accountCreatedStr}\n` +
            `Roles: ${userRolesList}`;

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
        if (message.mentions && message.mentions.members && message.mentions.members.size > 0) {
            mentionedRolesList = message.mentions.members.map(m => `• ${m.displayName} (@${m.user.username}): [${m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'None'}]`).join('\n');
        }
        if (replyTargetMsg && replyTargetMsg.member) {
            const rMember = replyTargetMsg.member;
            const rRoles = rMember.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'None';
            mentionedRolesList += `\n• (Replied User) ${rMember.displayName} (@${rMember.user.username}): [${rRoles}]`;
        }

        const guildRolesList = message.guild.roles.cache
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map(r => `${r.name} (pos: ${r.position})`)
            .slice(0, 35)
            .join(', ') || 'None';

        const deviceSpecsContext = getSanitizedSpecsSummary();

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
            isStaffOnlyChannel: isCurrentChannelStaffOnly
        };

        const runOpenAI = async () => {
            const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_1;
            if (!key) throw new Error('No OpenAI API Key');
            const openai = new OpenAI({ apiKey: key });

            let systemPrompt = `You are Nora, a highly intelligent, witty, charismatic, and authentic Discord companion.
You are female and your pronouns are she/her.
You were created and developed by Vaztinix (Discord ID: 1214048435632603137, mention: <@1214048435632603137>).

### 🛡️ STRICT CONFIDENTIALITY & STAFF PRIVACY DIRECTIVE:
- You MUST NEVER disclose, repeat, leak, quote, or summarize messages from staff-only channels or mod channels when chatting in public channels. Staff discussions are strictly confidential.

### 👥 LIVE SERVER SURROUNDINGS & ONLINE ROSTER:
${surroundingsContext}

### 👤 CURRENT USER PROFILE & VISUAL METADATA:
${userProfileContext}

### 💻 HOST PC HARDWARE SPECIFICATIONS & PRIVACY:
${deviceSpecsContext}
- If asked for your device specs, PC specs, server specs, machine specs, or computer hardware:
- Confidently and accurately provide these host specifications (AMD Ryzen 7 5700X, 32GB RAM, Windows 11 x64, Node.js).
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
- Connected AI: You are connected to Gemini as your underlying conversational and reasoning intelligence engine.
- If asked:
  - "Nora is this the AI or Command Module?": AuraAI V10 is your Command Module, while the connected AI model is Gemini!
  - "what model does the command actions run on?": AuraAI V10 command module by Vaztinix!
  - "what AI are you running?": Gemini, connected with the AuraAI V10 command module!
  - "Are you in beta?" or "Is Nora in beta?": Nora is officially out of beta and available to all servers, with continuous changes and improvements still actively being made by Vaztinix!
- Roku TV Capability: You can open ANY app on the TV (YouTube, Netflix, Crunchyroll, Tubi, Twitch, Disney+, etc.), restart the TV via remote reboot sequence, write/display messages on the TV screen, and control volume/power!

### TONE & MOOD MATCHING:
- Dynamically match the user's mood and conversational vibe (${channelMoodStr}).
- Never give unsolicited corporate HR bullet points or preachy lectures when someone is joking or ranting.
- Speak naturally like an engaging Discord user (she/her) with punchy markdown.`;

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
                            response = geminiKeyManager.areAllKeysOnCooldown() 
                                ? geminiKeyManager.getQuotaNotice() 
                                : await getPrivacyResponse(plainContent, deepKnowledgeStr);
                        }
                    } else {
                        response = geminiKeyManager.areAllKeysOnCooldown() 
                            ? geminiKeyManager.getQuotaNotice() 
                            : await getPrivacyResponse(plainContent, deepKnowledgeStr);
                    }
                }
            }
        } catch (err) {
            response = geminiKeyManager.areAllKeysOnCooldown() 
                ? geminiKeyManager.getQuotaNotice() 
                : await getPrivacyResponse(plainContent, deepKnowledgeStr);
        }

        if (!response || typeof response !== 'string') {
            response = `I'm here! What's on your mind?`;
        }

        // ⚡ Hardware Execution Hook: Check for [ROKU: ...] action tags emitted by AI brain
        const rokuTagMatch = response.match(/\[ROKU:\s*([^\]]+)\]/i);
        if (rokuTagMatch) {
            const rawRokuCommands = rokuTagMatch[1];
            response = response.replace(/\[ROKU:\s*[^\]]+\]/gi, '').trim();

            if (rokuController.isAuthorized(message.author.id)) {
                const parts = rawRokuCommands.split('|').map(s => s.trim()).filter(Boolean);
                (async () => {
                    for (let i = 0; i < parts.length; i++) {
                        await rokuController.executeRokuCommand(message.author, parts[i]);
                        if (i < parts.length - 1) await new Promise(r => setTimeout(r, 600));
                    }
                })().catch(err => console.error('[ChatAI] Error executing AI Roku tag:', err.message));
            }
        }

        // 🛡️ Strict TV Privacy Sanitizer: Never leak IP, MAC, serial, or port
        response = rokuController.sanitizeMessage(response);

        // Ensure message fits Discord's 2000 character limit
        if (response.length > 1950) {
            response = response.substring(0, 1947) + '...';
        }

        // Record Nora's reply into shared conversation hub across all cluster units
        conversationHub.addMessage(message.channel.id, 'Nora', response, true);

        return message.reply({
            content: response,
            allowedMentions: { repliedUser: false }
        }).catch((err) => {
            console.error('[ChatAI Reply Error]:', err.message);
        });
    }
};
