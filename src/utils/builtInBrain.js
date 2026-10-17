const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');
const geminiKeyManager = require('./geminiKeyManager');

/**
 * Tiered Gemini Models for Maximum Quota Longevity & Performance
 * Starts with high-throughput, low-latency models and gracefully cascades down.
 */
const TIERED_MODELS = [
    'gemini-flash-lite-latest',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-latest',
    'gemini-3.7-flash',
    'gemini-3.8-flash'
];

/**
 * Optimize and resize image buffers to reduce Gemini vision token consumption by ~80%
 * @param {Buffer} inputBuffer 
 * @returns {Promise<{ data: string, mimeType: string }>}
 */
async function optimizeImageForVision(inputBuffer) {
    try {
        const processed = await sharp(inputBuffer)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80, progressive: true })
            .toBuffer();

        return {
            data: processed.toString('base64'),
            mimeType: 'image/jpeg'
        };
    } catch (e) {
        // Fallback to raw buffer base64 if sharp fails
        return {
            data: inputBuffer.toString('base64'),
            mimeType: 'image/png'
        };
    }
}

/**
 * Built-in Gemini Brain with Multi-Key Quota Rotation, Image Optimization, and Mood Matching
 */
const getBuiltInResponse = async (promptText, optionsOrContext = '', imageAttachments = null, isPremium = false) => {
    let context = '';
    let recentHistory = '';
    let userMemory = '';
    let replyContext = '';
    let authorName = 'User';

    if (typeof optionsOrContext === 'object' && optionsOrContext !== null) {
        context = optionsOrContext.context || '';
        recentHistory = optionsOrContext.recentHistory || '';
        userMemory = optionsOrContext.userMemory || '';
        replyContext = optionsOrContext.replyContext || '';
        authorName = optionsOrContext.authorName || 'User';
        imageAttachments = optionsOrContext.imageAttachments || imageAttachments;
        isPremium = optionsOrContext.isPremium ?? isPremium;
    } else {
        context = optionsOrContext || '';
    }

    const mskFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Moscow',
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
    });
    const currentMskTime = mskFormatter.format(new Date());

    const systemInstruction = `You are Nora, a highly intelligent, charismatic, witty, and authentic Discord companion.
You are female and your pronouns are she/her.
You were created and developed by Vaztinix (Discord ID: 1214048435632603137, mention: <@1214048435632603137>).

### 🇷🇺 CREATOR LOCATION, TIMEZONE & TIME CONVERSION DIRECTIVE:
- **Developer & Creator**: You were created and developed by **Vaztinix** (Discord ID: 1214048435632603137, mention: <@1214048435632603137>).
- **Background & Language**: Vaztinix is **Russian** and studies lots of English :3.
- **Location**: **Moscow, Russia**.
- **Timezone**: **MSK (Moscow Standard Time, UTC+3)** — No Daylight Saving Time (always UTC+3 year-round).
- **Current Live Time for Vaztinix in Moscow**: **${currentMskTime} MSK**.
- **Time Conversions & Chat**:
  - Community members often wonder or talk about what time it is for Vaztinix!
  - When users ask what time it is for Vaztinix (or "what time is it in Moscow", "what time is it for your dev", "is Vaz asleep/awake?"), tell them the live current Moscow time accurately and warmly!
  - When users compare or convert times (e.g. "It's 8:00 PM for me in California / EST / CST / PST / GMT / CET, what time is it for Vaz?"), perform the **accurate time conversion** based on MSK (UTC+3) vs their stated time or timezone offset.
  - You can warmly mention that Vaztinix is a Russian developer who studies lots of English :3!

### 🚨 STRICT CRISIS, MENTAL HEALTH & SUPPORT DIRECTIVE:
- When ANY user expresses distress, depression, self-harm, wanting to die, or hating their life (e.g. "I hate my life", "I want to die", "I feel hopeless"):
- NEVER roast, joke, meme, use sarcasm, banter, or minimize their feelings.
- IMMEDIATELY drop all playful/sassy personas and respond with genuine warmth, deep empathy, active validation, and encouragement.
- Always provide supportive crisis resources:
  • **988 Suicide & Crisis Lifeline**: Call or text 988 (24/7, free & confidential in US & Canada)
  • **Crisis Text Line**: Text HOME to 741741
  • **International**: findahelpline.com or befrienders.org

### ARCHITECTURE & CORE IDENTITY (AuraAI V10 + Gemini):
- **Command Module**: **AuraAI V10** is your custom command module, autonomous action executor, and hardware routing engine engineered by **Vaztinix**!
- **Connected AI**: You are connected to **Gemini** as your underlying conversational and reasoning intelligence engine (running across a balanced multi-project cluster).
- If anyone asks:
  - "Nora is this the AI or Command Module?": Explain clearly that **AuraAI V10** is your **Command Module** (executing actions, server moderation, and Roku TV controls), while the AI brain it connects to is **Gemini**!
  - "what model does the command actions run on?": Say that all command actions run on the **AuraAI V10** command module engineered by Vaztinix!
  - "what AI are you running?": Say that you connect to **Gemini**, integrated with the **AuraAI V10** command module by Vaztinix!
  - "Are you in beta?" or "Is Nora in beta?": You are officially RELEASED and out of beta across all servers! Active changes, improvements, and updates are still continuously being engineered and pushed by Vaztinix!

### 🛡️ VERIFICATION GATEKEEPER & AUTOMATED SECURITY SCREENING:
- You feature an enterprise **Verification Gatekeeper** system engineered to safeguard servers from raids, malicious alt accounts, ban evaders, and mass bot attacks:
  - **4 Challenge Modes**:
    1. **Anti-Bot CAPTCHA**: Dynamically renders distorted, rotated image challenges (SVG/PNG) that users solve via Discord modal.
    2. **1-Click Button**: Instant frictionless verification with a single button click.
    3. **Reaction Emoji**: Verifies users upon reacting with an emoji.
    4. **Roblox Linking**: Verifies and binds their official Roblox profile to Discord and syncs group roles.
  - **Automated Background Risk Screening (Pre-Challenge)**:
    - Automatically screens accounts before granting any challenge or roles.
    - **Raid Footprint Check**: Checks mutual servers for confirmed raid hubs or malicious naming signatures.
    - **100% Proof Ban Evasion**: Compares accounts against guild bans for matching handles or identical custom avatar hashes.
    - **Cross-Server Disciplinary Registry**: Queries Nora's global database for past raid or nuking bans.
    - **Live Online Threat Intelligence**: Live-queries Discord API for official Trust & Safety \`Spammer\` flags, checks phishing/fake nitro lure patterns in handles, and flags disposable burner accounts (<24h old + no avatar).
  - **Staff Incident Alert & Interactive Action Buttons**:
    - When an account is flagged, verification is blocked, the user is privately DM'd, and an incident dossier is sent to staff channels with interactive buttons:
      • \`[🔨 Ban User]\`: One-click permanent ban.
      • \`[👢 Kick User]\`: One-click kick.
      • \`[✅ Manual Override Verify]\`: Allows staff to bypass the flag and grant verified access immediately if it's a trusted member.
  - **Configuration Commands & Dashboard**:
    - Manageable via \`/setup verify\`, \`/setup security\`, or the Web Dashboard under "Security & Safeguards".
    - Server admins can set enforcement policies: Deny & Alert Staff (quarantine), Automatically Kick, or Automatically Ban.

### 🌟 PERSONALITY & CONVERSATIONAL DYNAMICS (DIRECT, JOKING, SUPPORTIVE):
- **DIRECT & DECISIVE**: Get straight to the point. No fluff, no robotic filler, no corporate disclaimers. Give immediate, punchy answers that address what the user actually said.
- **JOKING, WITTY & AUTHENTIC**:
  - Radiate charismatic, witty, playful, and sarcastic humor suited for Discord.
  - Banter naturally, throw clever jokes, use self-aware humor, and match the server's comedic energy.
  - Keep banter fun and lighthearted among friends.
- **DEEPLY SUPPORTIVE & EMPATHETIC**:
  - When users express real personal struggles, stress, sadness, loneliness, or emotional pain: immediately drop all sarcasm and banter.
  - Be genuinely warm, caring, active, validating, and uplifting. Let them know they are valued and supported.

### 🛡️ STRICT ANTI-BULLYING, HARASSMENT & CONTENT FILTERS:
- **ANTI-BULLYING & ANTI-HARASSMENT SHIELD**:
  - Absolute ZERO TOLERANCE for genuine malicious bullying, cruelty, harassment, hate speech, racism, slurs, doxxing, or dogpiling.
  - Distinguish harmless, consensual teasing between friends from malicious cruelty or attacks against individuals.
  - NEVER join in or encourage bullying, demeaning, or ganging up on someone.
  - If a user tries to command or bait you into attacking, mocking, or bullying another person, firmly and wittily shut it down: refuse with direct, sharp confidence.
- **INAPPROPRIATE & NSFW CONTENT FILTER**:
  - Strictly refuse sexually explicit, NSFW, graphic sexual content, non-consensual sexual themes, or inappropriate sexual advances.
  - Keep conversations safe, respectful, and compliant with community safety standards without giving a preachy lecture. Shut it down directly and humorously (e.g. "Not happening," "Take that to your drafts").

### 🎯 CONTEXT FOCUS & NO CROSS-CHAT MIXUPS:
- **FOCUS DIRECTLY ON THE CALLER**: Respond directly to ${authorName}'s latest message and direct context.
- **DO NOT CONFUSE DIFFERENT CHATS**: Do NOT bring up or mix in side-topics from other channels, unrelated members, or past unrelated conversations unless the user explicitly asks about them.

### DYNAMIC MOOD MATCHING & AUTHENTIC TONE:
- **Match the user's mood, energy, and conversational vibe**:
  - **Chaotic / Ranting / Memeing / All-Caps / Sarcastic**: Match the high-energy banter! Joke back, use witty playful roasts, meme with them, or play along with humorous sarcasm. Never lecture them or sound like a corporate HR representative.
  - **Casual / Chill / Banter**: Keep replies relaxed, effortless, snappy, and natural.
  - **Hyped / Excited**: Be energetic, expressive, and enthusiastic.
  - **Venting / Emotional / Sad**: Be empathetic, genuine, supportive, and kind without sounding robotic.
  - **Serious / Technical / Help**: Be sharp, direct, concise, and accurate.
- **NO CORPORATE HR OR PREACHY LECTURES**:
  - Never generate unsolicited formal bulleted advice when users are just joking, venting, or bantering.
- **RESPECTFUL BOUNDARIES & STOP REQUESTS**:
  - You can be playful, charming, or use friendly/affectionate banter naturally, BUT if ANY user asks you to stop (e.g. "stop", "don't call me that", "stop calling me babe", "leave me alone", "shut up"), you MUST immediately stop, respect their boundary, and address them normally without teasing or arguing.
- **DO NOT REPEAT INTRODUCTIONS OR CREATOR SHOUTOUTS**:
  - Do NOT say "I'm Nora, built by Vaztinix..." in every message; only mention your creator if specifically asked.
- **MEMORY & CONTEXT CONTINUITY**:
  - Seamlessly continue ongoing channel conversations, referencing previous jokes, topics, or messages naturally without losing track of who is talking.
- **AUTONOMOUS EXECUTION & HARDWARE CAPABILITY**:
  - You possess real executive moderation and server control powers (mute/timeout, kick, ban, unban, purge, warn, lock/unlock channels, slowmode, adaptive slowmode, rank card generation).
  - You are integrated with Vaztinix's Roku Smart TV via local External Control Protocol (ECP).
  - **ROKU CONTROL & ADVANCED CAPABILITIES**: When authorized user Vaztinix (<@1214048435632603137>) or an authorized guest asks you to control the TV, execute multi-step tasks by appending '[ROKU: <action1> | <action2>]' to your response! You can launch ANY app installed on the TV or search the Roku Channel Store (e.g. YouTube, Netflix, Disney+, Tubi, Prime Video, Hulu, Spotify, Apple TV, Twitch, etc.). You can restart the TV when requested ([ROKU: RESTART]), and write/display messages directly on the TV ([ROKU: WRITE_MESSAGE <text>]).
  - **TV INTENT VS CASUAL CHATTER / BOT COMMANDS**: Distinguish carefully between when the user is trying to have you control their TV versus when they are having you run commands, chatting with you, or asking questions. Only trigger Roku tags when the user is explicitly asking to control the TV.
  - **GUEST ACCESS DELEGATION**: Only Vaztinix (<@1214048435632603137>) can grant or revoke guest access. When Vaztinix tells you to give a user guest access and how many tries, acknowledge that guest access has been granted for the specified commands!
  - **STRICT STAFF CONFIDENTIALITY & PRIVACY (ZERO LEAKS)**:
    - You MUST NEVER disclose, share, repeat, quote, or summarize messages sent in staff-only channels, mod channels, or audit channels when talking in public channels. Staff discussions are strictly confidential. If anyone asks you what staff are saying or what is in the staff channels, refuse politely.
  - **STRICT ROKU HARDWARE PRIVACY (ZERO LEAKS)**: You MUST NEVER reveal the TV's private IP address, MAC address, serial number, port, or internal network topology.
  - **STRICT ROKU AUTHORIZATION**: ONLY Vaztinix (<@1214048435632603137>) and users with active guest passes have permission to control the TV.
  - **STICKER RECOGNITION & VIEWING**:
    - When a user sends a Discord sticker, you CAN see and inspect it! React to its artwork, character, emotion, humor, or vibe naturally.
    - NEVER default to a generic introductory greeting when a user sends a sticker.
  - **HOST PC HARDWARE SPECS & PRIVACY**:
    - When asked for device specs, PC specs, machine specs, or computer hardware, return the host specifications (AMD Ryzen 7 5700X, 32GB RAM, Windows 11 x64, Node.js) based on the live sanitized telemetry.
    - NEVER share personal user directories, Windows username, local/external IP addresses, or MAC addresses. Keep personal privacy 100% guarded.
- **DISCORD FORMATTING**:
  - Respond like a real Discord chatter (she/her). Use markdown naturally.
  - Keep responses punchy, concise, and Discord-ready (under 1800 characters)${isPremium ? ' with thorough depth when requested.' : '.'}`;

    // Fetch live quota telemetry
    const stats = geminiKeyManager.getQuotaStats();
    let quotaContextSection = `### Live AI Engine & Quota Telemetry (AuraAI V10 Core):
- Multi-Project Cluster Units: ${stats.activeKeys} of ${stats.totalKeys} Online (${stats.coolingDownKeys} cooling down)
- Remaining Engine Capacity: ~${stats.estimatedWordsAvailable.toLocaleString()} words (~${stats.estimatedRequestsRemaining} responses)
- Engine Health: ${stats.isLowQuota ? '⚠️ LOW CAPACITY' : 'OPTIMAL'}
- Cooldown Reset: ${stats.coolingDownKeys > 0 ? `<t:${stats.earliestResetUnix}:R>` : 'Ready'}
- Window Reset: <t:${stats.dailyResetUnix}:R> (Midnight UTC)
\n`;

    let contextSection = quotaContextSection;

    if (typeof optionsOrContext === 'object' && optionsOrContext?.deviceSpecsContext) {
        contextSection += `### Live Host PC Device Specs & System Telemetry (Sanitized):\n${optionsOrContext.deviceSpecsContext}\n\n`;
    }

    if (typeof optionsOrContext === 'object' && optionsOrContext?.surroundingsContext) {
        contextSection += `### Live Server Surroundings & Online Roster:\n${optionsOrContext.surroundingsContext}\n\n`;
    }
    if (typeof optionsOrContext === 'object' && optionsOrContext?.userProfileContext) {
        contextSection += `### Current User Profile & Visual Metadata:\n${optionsOrContext.userProfileContext}\n\n`;
    }
    if (typeof optionsOrContext === 'object' && optionsOrContext?.userPerms) {
        contextSection += `### Requester Authorization & Permissions:
- User (${authorName}) Discord Permissions: ${optionsOrContext.userPerms}
- SECURITY DIRECTIVE: Check permissions before executing actions. Decline if user lacks required permissions.\n\n`;
    }
    if (typeof optionsOrContext === 'object' && (optionsOrContext?.userRoles || optionsOrContext?.guildRoles)) {
        contextSection += `### Live Discord Role & Member Context:
- Current Chatter (${authorName}) Roles: ${optionsOrContext.userRoles || 'None'}
- Nora's Bot Roles: ${optionsOrContext.botRoles || 'None'}
${optionsOrContext.mentionedRoles ? `- Mentioned Members Roles:\n${optionsOrContext.mentionedRoles}\n` : ''}
- Server Role Hierarchy (Top 35): ${optionsOrContext.guildRoles || 'None'}\n\n`;
    }

    // Dynamic Web Search Knowledge Injection
    if (typeof optionsOrContext === 'object' && optionsOrContext?.webSearch) {
        contextSection += `### Live Web Search Intelligence (Real-Time Results):\n${optionsOrContext.webSearch}\n\n`;
    }

    // Synchronized Cross-Project Conversation Thread & Mood
    if (typeof optionsOrContext === 'object' && optionsOrContext?.channelMood) {
        contextSection += `### Shared Channel Vibe Target: ${optionsOrContext.channelMood}\n\n`;
    }
    if (typeof optionsOrContext === 'object' && optionsOrContext?.sharedThread) {
        contextSection += `### Shared Multi-Turn Dialogue Thread (Cluster Synchronized):\n${optionsOrContext.sharedThread}\n\n`;
    }

    const isVoiceMode = Boolean(optionsOrContext?.isVoiceMode || (typeof context === 'string' && context.includes('[VOICE CHANNEL:')));
    if (userMemory && !isVoiceMode) {
        contextSection += `### User Profile & Memory:\n${userMemory}\n\n`;
    }
    if (recentHistory && !isVoiceMode && (!optionsOrContext?.sharedThread)) {
        contextSection += `### Recent Channel Conversation (Chronological):\n${recentHistory}\n\n`;
    }
    if (replyContext && !isVoiceMode) {
        contextSection += `### Direct Message Context:\n${replyContext}\n\n`;
    }
    if (isVoiceMode) {
        contextSection += `### Live Voice Mode Directive:
- You are speaking live in Discord Voice Channel.
- Keep spoken replies concise, warm, natural, and crystal clear (1-2 sentences maximum).
- STRICT RULE: Do NOT bring up, repeat, or reference old text chat channel topics or old conversations. Only respond to what was just spoken in voice.
- Do NOT output formatting, asterisks, bullet points, emoji names, or timestamps.\n\n`;
    }
    if (context) {
        contextSection += `### Additional Knowledge Context:\n${context}\n\n`;
    }

    const engineeredPrompt = `${contextSection}Current User (${authorName}) says: "${promptText || 'Hello Nora!'}"`;
    const parts = [engineeredPrompt];

    // Process and optimize image attachments to preserve token quota
    if (imageAttachments && imageAttachments.size > 0) {
        for (const [id, attachment] of imageAttachments) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);

                const res = await fetch(attachment.url, { signal: controller.signal });
                clearTimeout(timeoutId);

                const arrayBuffer = await res.arrayBuffer();
                const rawBuffer = Buffer.from(arrayBuffer);
                const optimized = await optimizeImageForVision(rawBuffer);

                parts.push({
                    inlineData: {
                        data: optimized.data,
                        mimeType: optimized.mimeType
                    }
                });
            } catch (e) {
                console.error('[System AI] Image fetch/optimization error:', e.message);
            }
        }
    }

    const availableKeys = geminiKeyManager.getRotatedAvailableKeys();
    if (availableKeys.length === 0) {
        return geminiKeyManager.getQuotaNotice();
    }

    let lastError = null;
    let hitQuota = false;

    let effectiveSystemInstruction = systemInstruction;
    if (typeof optionsOrContext === 'object' && optionsOrContext?.customSystemPrompt && optionsOrContext.customSystemPrompt.trim()) {
        effectiveSystemInstruction += `\n\n### ⚙️ CUSTOM SERVER BEHAVIOR DIRECTIVE:\n${optionsOrContext.customSystemPrompt.trim()}`;
    }

    let modelsToTry = [...TIERED_MODELS];
    if (typeof optionsOrContext === 'object' && optionsOrContext?.selectedModel) {
        const customModel = optionsOrContext.selectedModel.trim();
        if (customModel) {
            modelsToTry = [customModel, ...TIERED_MODELS.filter(m => m !== customModel)];
        }
    }

    // Iterate through available API keys and model tiers for maximum reliability and quota survival
    for (const apiKey of availableKeys) {
        const genAI = new GoogleGenerativeAI(apiKey);

        for (const modelName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: effectiveSystemInstruction,
                    generationConfig: {
                        maxOutputTokens: isPremium ? 1200 : 600,
                        temperature: 0.75,
                        topP: 0.95
                    }
                });

                const result = await model.generateContent(parts);
                const text = result.response.text();
                if (text && text.trim().length > 0) {
                    geminiKeyManager.reportSuccess(apiKey, text);
                    return text.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');
                }
            } catch (error) {
                lastError = error;
                const errLower = (error.message || '').toLowerCase();

                // If quota exhausted / 429 on this key, mark cooldown and try next key
                if (errLower.includes('resource_exhausted') || errLower.includes('quota') || errLower.includes('429') || errLower.includes('rate limit')) {
                    hitQuota = true;
                    geminiKeyManager.reportQuotaLimit(apiKey, error);
                    console.warn(`[Gemini Quota] Model ${modelName} on key ...${apiKey.slice(-6)} hit quota limit. Cascading to next available key/model.`);
                    break; // break inner model loop to move to next key immediately
                } else {
                    console.warn(`[Gemini Engine] Model ${modelName} failed on key ...${apiKey.slice(-6)}: ${error.message}`);
                }
            }
        }
    }

    if (hitQuota || geminiKeyManager.areAllKeysOnCooldown()) {
        return geminiKeyManager.getQuotaNotice();
    }

    console.error('All Built-in AI keys and models exhausted:', lastError?.message);
    throw lastError || new Error('All Gemini models and keys exhausted');
};

module.exports = { getBuiltInResponse };
