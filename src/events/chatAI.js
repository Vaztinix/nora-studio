const { Events, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
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
const geminiKeyManager = require('../utils/geminiKeyManager');

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
        
        if (!isMentioned && !isReply) return;

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

        // 🔒 Server & Channel Restrictions
        const ALLOWED_GUILD_ID = '1487342521133830174';
        const ALLOWED_CHANNEL_ID = '1510712052342329534';

        if (message.guild.id !== ALLOWED_GUILD_ID) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('request_nora_ai_beta_invite')
                    .setLabel('Request Beta Server Invite (DM)')
                    .setEmoji('✨')
                    .setStyle(ButtonStyle.Primary)
            );

            return message.reply({
                content: `✨ **Nora AI is Currently in Beta Testing**\n\nNora AI features are currently in private beta and testing is actively happening in **Milo's World**.\n\nClick the button below and I will send you a direct message with an invite to join the beta testing server!`,
                components: [row],
                allowedMentions: { repliedUser: false }
            }).catch(() => {});
        }

        if (message.channel.id !== ALLOWED_CHANNEL_ID) {
            return message.reply({
                content: `AI chat is only available in <#${ALLOWED_CHANNEL_ID}>! Please head over there to chat with me.`,
                allowedMentions: { repliedUser: false }
            }).catch(() => {});
        }

        // Empty ping handling
        const imageAttachments = message.attachments?.filter(a => a.contentType?.startsWith('image/'));
        if (!plainContent && (!imageAttachments || imageAttachments.size === 0)) {
            return message.reply({
                content: `Hey <@${message.author.id}>! I'm **Nora** (she/her), created and developed by **Vaztinix** (<@1214048435632603137>).\nAsk me anything, ask me to draw/generate an image, or use \`/help\` to explore my commands!`,
                allowedMentions: { repliedUser: false }
            }).catch(() => {});
        }

        // Rate limiter check
        const isPremium = isUserPremium(message.author.id);
        if (!checkRateLimit(message.author.id, isPremium)) {
            return message.reply({
                content: "⏳ Slow down a bit! You're chatting too fast. Please give me a moment to catch my breath.",
                allowedMentions: { repliedUser: false }
            }).catch(() => {});
        }

        // Send typing indicator
        await message.channel.sendTyping().catch(() => {});

        // ⚡ 1. Check for Nora Autonomous Action / Moderation / Utility Execution
        try {
            const actionHandled = await processNoraAction(message, client, plainContent);
            if (actionHandled) return;
        } catch (actErr) {
            console.error('[ChatAI] NoraAction error:', actErr);
        }

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

        let settings = null;
        try { 
            settings = await settingsCache.get(message.guild.id); 
        } catch (e) {}

        const aiPref = (settings?.aiPreference || 'BUILT_IN').toUpperCase();

        // 2. Fetch Recent Channel Messages (Short-term Working Memory)
        let recentHistoryStr = '';
        try {
            const fetched = await message.channel.messages.fetch({ limit: 12 }).catch(() => null);
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
                recentHistoryStr = historyList.slice(-10).join('\n');
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

        // 5. Smart History Recall (for explicit search keywords)
        let deepKnowledgeStr = '';
        if (['recall', 'history', 'search', 'last', 'remember', 'previous'].some(w => plainContent.toLowerCase().includes(w))) {
            try {
                deepKnowledgeStr = await fetchMonthlyHistory(message.channel, 15, message.author.id);
            } catch (e) {}
        }

        // 6. User Permission Profile
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

        const aiPayload = {
            promptText: plainContent,
            context: deepKnowledgeStr,
            recentHistory: recentHistoryStr,
            userMemory: userMemoryStr,
            replyContext: directReplyStr,
            authorName: authorDisplayName,
            userPerms: userPermsSummary,
            imageAttachments: imageAttachments,
            isPremium: isPremium
        };

        const runOpenAI = async () => {
            const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_1;
            if (!key) throw new Error('No OpenAI API Key');
            const openai = new OpenAI({ apiKey: key });

            let systemPrompt = `You are Nora, a highly intelligent, witty, charismatic, and authentic Discord companion.
You are female and your pronouns are she/her.
You were created and developed by Vaztinix (Discord ID: 1214048435632603137, mention: <@1214048435632603137>).

### TONE & MOOD MATCHING:
- Dynamically match the user's mood and conversational vibe (banter, chaotic humor, chill chat, excitement, or support).
- Never give unsolicited corporate HR bullet points or preachy lectures when someone is joking or ranting.
- Do NOT repeat "I'm Nora, built by Vaztinix..." in every message; only mention your creator if specifically asked.
- Speak naturally like an engaging Discord user (she/her) with punchy markdown and emojis where fitting.`;

            if (userMemoryStr) {
                systemPrompt += `\n\n### User Memory:\n${userMemoryStr}`;
            }
            if (recentHistoryStr) {
                systemPrompt += `\n\n### Recent Channel Context:\n${recentHistoryStr}`;
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
            return completion.choices[0].message.content;
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

        // Ensure message fits Discord's 2000 character limit
        if (response.length > 1950) {
            response = response.substring(0, 1947) + '...';
        }

        return message.reply({
            content: response,
            allowedMentions: { repliedUser: false }
        }).catch((err) => {
            console.error('[ChatAI Reply Error]:', err.message);
        });
    }
};
