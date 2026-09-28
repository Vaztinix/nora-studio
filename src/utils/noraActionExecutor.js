const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits, 
    AttachmentBuilder,
    ChannelType
} = require('discord.js');
const Case = require('../database/models/Case');
const Warning = require('../database/models/Warning');
const GuildSettings = require('../database/models/GuildSettings');
const UserLevel = require('../database/models/UserLevel');
const UserPrefs = require('../database/models/UserPrefs');
const { generateRankCard } = require('./rankCardGenerator');
const { getTotalXPForLevel } = require('./noraLeveling');

const BOT_DEVELOPER_ID = '1214048435632603137';

/**
 * Parses time string (e.g., '10m', '2h', '1d', '30s', '1 minute', '5 minutes') into minutes and milliseconds
 */
function parseDuration(input) {
    if (!input) return { minutes: 5, ms: 5 * 60 * 1000, display: '5 minutes' };
    const match = input.match(/(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?|w|weeks?)\b/i);
    if (!match) {
        const numOnly = parseInt(input, 10);
        if (!isNaN(numOnly) && numOnly > 0) {
            return { minutes: numOnly, ms: numOnly * 60 * 1000, display: `${numOnly} minute(s)` };
        }
        return { minutes: 5, ms: 5 * 60 * 1000, display: '5 minutes' };
    }

    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('s')) {
        const mins = Math.max(1, Math.ceil(val / 60));
        return { minutes: mins, ms: val * 1000, display: `${val} second(s)` };
    }
    if (unit.startsWith('m')) {
        return { minutes: val, ms: val * 60 * 1000, display: `${val} minute(s)` };
    }
    if (unit.startsWith('h')) {
        return { minutes: val * 60, ms: val * 60 * 60 * 1000, display: `${val} hour(s)` };
    }
    if (unit.startsWith('d')) {
        return { minutes: val * 1440, ms: val * 24 * 60 * 60 * 1000, display: `${val} day(s)` };
    }
    if (unit.startsWith('w')) {
        return { minutes: val * 10080, ms: val * 7 * 24 * 60 * 60 * 1000, display: `${val} week(s)` };
    }

    return { minutes: 5, ms: 5 * 60 * 1000, display: '5 minutes' };
}

/**
 * 🎯 Intelligently extracts the true target user from mentions, self-keywords, or explicit Discord IDs.
 * Strictly prevents random user guessing or fuzzy match hallucinations.
 */
async function resolveTargetUser(message, raw) {
    const client = message.client;
    const lower = raw.toLowerCase();

    // 1. Mentions excluding the bot herself
    const nonBotMentions = message.mentions?.users?.filter(u => u.id !== client.user?.id);
    if (nonBotMentions && nonBotMentions.size > 0) {
        return nonBotMentions.first();
    }

    // 2. Self-targeting keywords ('me', 'myself')
    if (lower.match(/\b(me|myself)\b/i)) {
        return message.author;
    }

    // 3. Explicit Discord User ID match (17-20 digits)
    const idMatch = raw.match(/\b(\d{17,20})\b/);
    if (idMatch && idMatch[1] !== client.user?.id) {
        const cached = client.users.cache.get(idMatch[1]);
        if (cached) return cached;
        const fetched = await client.users.fetch(idMatch[1]).catch(() => null);
        if (fetched) return fetched;
    }

    // 4. If the ONLY mention was Nora herself (e.g. "@Nora mute @Nora" or "mute yourself")
    if (lower.match(/\b(mute|timeout|kick|ban|warn)\s+(@?nora|yourself)\b/i)) {
        return client.user;
    }

    return null;
}

/**
 * 🔍 Analyzes natural language message to extract utility or moderation execution intent
 */
async function detectIntent(message, plainContent) {
    const raw = (plainContent || '').trim();
    const lower = raw.toLowerCase();
    const client = message.client;

    // 1. Starboard Leaderboard (Checked BEFORE generic leaderboard)
    if (lower.match(/\b(starboard\s+(leaderboard|top|ranking|hall\s*of\s*fame|stats)|top\s+starred|star\s+leaderboard)\b/i) ||
        lower.match(/\b(starboard\s*lb|star\s*lb)\b/i)) {
        return {
            type: 'UTILITY',
            action: 'STARBOARD_LEADERBOARD'
        };
    }

    // 2. Server XP Leaderboard
    if (lower.match(/\b(open|show|view|get|display|see)?\s*(the\s+)?(server\s+)?(xp\s+|levels?\s+)?(leaderboard|top\s+(users|members|xp|levels))\b/i) || lower === 'lb' || lower === 'top') {
        return {
            type: 'UTILITY',
            action: 'LEADERBOARD'
        };
    }

    // 3. User Profile Card / MyCard (Dossier with badges, verify, warnings, stats)
    if (lower.match(/\b(open|show|view|check|get|display|send)?\s*(my\s+card|mycard|my\s+profile|user\s+profile|profile\s+card|dossier)\b/i) ||
        lower === 'mycard' || lower === 'profile' || lower === 'my card') {
        const nonBotMentions = message.mentions?.users?.filter(u => u.id !== client.user?.id);
        return {
            type: 'UTILITY',
            action: 'MYCARD',
            target: nonBotMentions?.first() || message.author
        };
    }

    // 4. Leveling Rank Card (Canvas image with XP bar & progress)
    if (lower.match(/\b(open|show|view|check|get|display|send)?\s*(rank\s*card|rank|my\s*rank|level\s*card|xp\s*card)\b/i) ||
        lower.match(/\b(what is|what's|how is)\s*(my\s+)?(level|rank|xp)\b/i) ||
        lower === 'rank') {
        const nonBotMentions = message.mentions?.users?.filter(u => u.id !== client.user?.id);
        return {
            type: 'UTILITY',
            action: 'CARD',
            target: nonBotMentions?.first() || message.author
        };
    }

    // 5. Utility: Avatar
    if (lower.match(/\b(avatar|pfp|icon)\b/i) && !lower.match(/\b(change|set|update)\b/i)) {
        const nonBotMentions = message.mentions?.users?.filter(u => u.id !== client.user?.id);
        return {
            type: 'UTILITY',
            action: 'AVATAR',
            target: nonBotMentions?.first() || message.author
        };
    }

    // 6. Utility: Ping
    if (lower.match(/^(ping|latency|bot ping)\b/i)) {
        return {
            type: 'UTILITY',
            action: 'PING'
        };
    }

    // 7. Utility: Bot Info / Server Info
    if (lower.match(/\b(bot\s*info|server\s*info|system\s*info|about\s*nora|nora\s*status)\b/i)) {
        return {
            type: 'UTILITY',
            action: 'INFO'
        };
    }

    // 8. Utility: AI Quota & Words Headroom (e.g. "what is the current quota", "how many words left", "quota status", "credits left")
    if (lower.match(/\b(what('s|\s+is)\s+(the\s+)?(current\s+)?(ai\s+)?(quota|credit|credits|limit)|how\s+much\s+(ai\s+)?(quota|credit|credits)|how\s+many\s+(more\s+)?(words?|credits?|tokens?|prompts?)|quota\s+status|ai\s+quota|check\s+quota|credits?\s+left|how\s+long\s+(until|before)\s+(a\s+)?(conversation|quota|reset))\b/i)) {
        return {
            type: 'UTILITY',
            action: 'AI_QUOTA'
        };
    }

    // --- Moderation Intent Detection ---

    // A. Mute / Timeout
    if (lower.match(/\b(mute|timeout|silence|shut\s*up)\b/i) && !lower.match(/\b(unmute|untimeout|remove\s+timeout|lift\s+timeout)\b/i)) {
        const target = await resolveTargetUser(message, raw);
        if (target) {
            const duration = parseDuration(raw);
            let reason = raw
                .replace(new RegExp(`(can you )?(please )?(now )?(mute|timeout|silence|shut up)`, 'gi'), '')
                .replace(new RegExp(`<@!?${target.id}>|\\b${target.id}\\b|me\\b|myself\\b`, 'gi'), '')
                .replace(/for \d+\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?|w|weeks?)/gi, '')
                .replace(/\d+\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?|w|weeks?)/gi, '')
                .replace(/as an? test/gi, 'Testing purposes')
                .replace(/reason:?/gi, '')
                .trim();
            if (!reason) reason = target.id === message.author.id ? 'Self-requested timeout' : 'Requested via Nora AI';

            return {
                type: 'MODERATION',
                action: 'MUTE',
                target: target,
                duration: duration,
                reason: reason
            };
        } else {
            return {
                type: 'MODERATION',
                action: 'TARGET_REQUIRED',
                requestedAction: 'Timeout / Mute'
            };
        }
    }

    // A2. Conversational Timeout Follow-up
    if (lower.match(/\b(forever|perm|permanent|banish him|banish them|do it|lock him in|lock him)\b/i) ||
        (message.reference && lower.match(/\b(\d+\s*(s|sec|m|min|minutes?|h|hr|hours?|d|days?|w|weeks?)|forever|perm)\b/i))) {
        let refMsg = null;
        if (message.reference?.messageId) {
            refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        }
        if (!refMsg) {
            const recent = await message.channel.messages.fetch({ limit: 5 }).catch(() => null);
            if (recent) {
                refMsg = recent.find(m => m.author.id === client.user?.id && (
                    m.content.toLowerCase().includes('timeout') || 
                    m.content.toLowerCase().includes('duration') || 
                    m.content.toLowerCase().includes('shadow realm') ||
                    m.content.toLowerCase().includes('cooldown') ||
                    m.content.toLowerCase().includes('verification interface')
                ));
            }
        }

        if (refMsg) {
            const target = await resolveTargetUser(message, (refMsg.content || '') + ' ' + raw);
            if (target && target.id !== client.user?.id) {
                const isForever = lower.includes('forever') || lower.includes('perm');
                const duration = isForever 
                    ? { minutes: 40320, ms: 40320 * 60 * 1000, display: '28 days (Max Timeout)' } 
                    : parseDuration(raw);

                return {
                    type: 'MODERATION',
                    action: 'MUTE',
                    target: target,
                    duration: duration,
                    reason: isForever ? 'Maximum timeout duration (Forever / Shadow realm)' : 'Requested in conversational flow with Nora'
                };
            }
        }
    }

    // B. Unmute / Untimeout
    if (lower.match(/\b(unmute|untimeout|lift\s*timeout|remove\s*timeout)\b/i)) {
        const target = await resolveTargetUser(message, raw);
        if (target) {
            return {
                type: 'MODERATION',
                action: 'UNMUTE',
                target: target,
                reason: 'Requested via Nora AI'
            };
        } else {
            return {
                type: 'MODERATION',
                action: 'TARGET_REQUIRED',
                requestedAction: 'Untimeout'
            };
        }
    }

    // C. Kick
    if (lower.match(/\b(kick|boot|remove\s+from\s+server)\b/i)) {
        const target = await resolveTargetUser(message, raw);
        if (target) {
            let reason = raw
                .replace(new RegExp(`(can you )?(please )?(kick|boot|remove from server)`, 'gi'), '')
                .replace(new RegExp(`<@!?${target.id}>|\\b${target.id}\\b`, 'gi'), '')
                .replace(/reason:?/gi, '')
                .trim();
            if (!reason) reason = 'Requested via Nora AI';

            return {
                type: 'MODERATION',
                action: 'KICK',
                target: target,
                reason: reason
            };
        } else {
            return {
                type: 'MODERATION',
                action: 'TARGET_REQUIRED',
                requestedAction: 'Kick'
            };
        }
    }

    // D. Ban
    if (lower.match(/\b(ban|permaban|hammer)\b/i) && !lower.match(/\b(unban|pardon)\b/i)) {
        const target = await resolveTargetUser(message, raw);
        if (target) {
            let reason = raw
                .replace(new RegExp(`(can you )?(please )?(ban|permaban|hammer)`, 'gi'), '')
                .replace(new RegExp(`<@!?${target.id}>|\\b${target.id}\\b`, 'gi'), '')
                .replace(/reason:?/gi, '')
                .trim();
            if (!reason) reason = 'Requested via Nora AI';

            return {
                type: 'MODERATION',
                action: 'BAN',
                target: target,
                targetId: target.id,
                reason: reason
            };
        } else {
            return {
                type: 'MODERATION',
                action: 'TARGET_REQUIRED',
                requestedAction: 'Ban'
            };
        }
    }

    // E. Unban
    if (lower.match(/\b(unban|pardon|lift\s*ban)\b/i)) {
        const target = await resolveTargetUser(message, raw);
        const idMatch = raw.match(/\b(\d{17,20})\b/);
        const finalId = target ? target.id : (idMatch ? idMatch[1] : null);
        if (finalId) {
            return {
                type: 'MODERATION',
                action: 'UNBAN',
                targetId: finalId,
                reason: 'Requested via Nora AI'
            };
        } else {
            return {
                type: 'MODERATION',
                action: 'TARGET_REQUIRED',
                requestedAction: 'Unban'
            };
        }
    }

    // F. Warn
    if (lower.match(/\b(warn|strike|issue\s*warning)\b/i)) {
        const target = await resolveTargetUser(message, raw);
        if (target) {
            let reason = raw
                .replace(new RegExp(`(can you )?(please )?(warn|strike|issue warning to)`, 'gi'), '')
                .replace(new RegExp(`<@!?${target.id}>|\\b${target.id}\\b`, 'gi'), '')
                .replace(/reason:?/gi, '')
                .trim();
            if (!reason) reason = 'Rule violation (via Nora AI)';

            return {
                type: 'MODERATION',
                action: 'WARN',
                target: target,
                reason: reason
            };
        } else {
            return {
                type: 'MODERATION',
                action: 'TARGET_REQUIRED',
                requestedAction: 'Warn'
            };
        }
    }

    // G. Purge / Clear
    if (lower.match(/\b(purge|clear|clean|delete\s+messages)\b/i)) {
        const numMatch = raw.match(/\b(\d+)\b/);
        let count = numMatch ? parseInt(numMatch[1], 10) : 10;
        if (count > 100) count = 100;
        if (count < 1) count = 1;

        return {
            type: 'MODERATION',
            action: 'PURGE',
            amount: count,
            reason: `Purged ${count} messages via Nora AI`
        };
    }

    // H. Lock / Unlock
    if (lower.match(/\b(lock\s*channel|lockdown|close\s*channel)\b/i)) {
        return {
            type: 'MODERATION',
            action: 'LOCK',
            channel: message.channel,
            reason: 'Channel lockdown via Nora AI'
        };
    }
    if (lower.match(/\b(unlock\s*channel|lift\s*lockdown|open\s*channel)\b/i)) {
        return {
            type: 'MODERATION',
            action: 'UNLOCK',
            channel: message.channel,
            reason: 'Channel unlocked via Nora AI'
        };
    }

    // I. Slowmode
    if (lower.match(/\b(slowmode|slow\s*mode)\b/i)) {
        if (lower.includes('off') || lower.includes('disable') || lower.includes('0')) {
            return {
                type: 'MODERATION',
                action: 'SLOWMODE',
                seconds: 0,
                channel: message.channel,
                reason: 'Slowmode disabled via Nora AI'
            };
        }
        const numMatch = raw.match(/\b(\d+)\s*(s|sec|seconds?|m|min|minutes?)?\b/i);
        let sec = 10;
        if (numMatch) {
            const val = parseInt(numMatch[1], 10);
            const unit = (numMatch[2] || '').toLowerCase();
            sec = unit.startsWith('m') ? val * 60 : val;
        }
        if (sec > 21600) sec = 21600;

        return {
            type: 'MODERATION',
            action: 'SLOWMODE',
            seconds: sec,
            channel: message.channel,
            reason: `Slowmode set to ${sec}s via Nora AI`
        };
    }

    return null;
}

/**
 * ⚡ Execute Utility actions directly
 */
async function executeUtility(message, client, intent) {
    const guild = message.guild;

    // 1. Starboard Leaderboard
    if (intent.action === 'STARBOARD_LEADERBOARD') {
        const { getTopStarredMembers } = require('../bot/engines/starboardEngine');
        const topMembers = await getTopStarredMembers(guild.id, 10).catch(() => []);

        const embed = new EmbedBuilder()
            .setTitle(`⭐ ${guild.name} — Starboard Leaderboard`)
            .setColor(0xFFA500)
            .setFooter({ text: 'Nora Starboard Leaderboard • Ranked by total stars received' })
            .setTimestamp();

        if (!topMembers || topMembers.length === 0) {
            embed.setDescription('No messages or members have received stars yet in this server! React with ⭐ to any entertaining message to start the starboard leaderboard.');
        } else {
            const medals = ['🥇', '🥈', '🥉'];
            const lines = topMembers.map((m, i) => {
                const medal = medals[i] || `\`#${i + 1}\``;
                return `${medal} <@${m.authorId}> — **${m.totalStars}** stars across **${m.postCount}** post${m.postCount === 1 ? '' : 's'}`;
            });
            embed.setDescription(lines.join('\n'));
        }

        return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    }

    // 2. MyCard (Comprehensive User Dossier Profile Card)
    if (intent.action === 'MYCARD') {
        const { buildMyCardPayload } = require('../commands/utility/mycard');
        const target = (intent.target && intent.target.id !== client.user?.id) ? intent.target : message.author;
        try {
            const payload = await buildMyCardPayload({
                interaction: {
                    guild,
                    user: message.author,
                    member: message.member,
                    client
                },
                targetUser: target
            });
            return message.reply({
                ...payload,
                allowedMentions: { repliedUser: false }
            });
        } catch (err) {
            console.error('[NoraAction] MyCard execution error:', err);
            intent.action = 'CARD';
        }
    }

    if (intent.action === 'CARD') {
        const target = (intent.target && intent.target.id !== client.user?.id) ? intent.target : message.author;
        const member = await guild.members.fetch(target.id).catch(() => null);

        const userLevel = await UserLevel.findOne({
            where: { userId: target.id, guildId: guild.id }
        });

        const targetXp = userLevel ? (userLevel.totalXp || 0) : 0;
        const higherCount = await UserLevel.count({
            where: {
                guildId: guild.id,
                totalXp: { [require('sequelize').Op.gt]: targetXp }
            }
        }).catch(() => 0);

        let currentLevel = userLevel ? userLevel.level || 0 : 0;
        let totalXpRaw = targetXp;
        let xpFloor = getTotalXPForLevel(currentLevel);
        let xpGoal = getTotalXPForLevel(currentLevel + 1);
        let xpInLevel = Math.max(0, totalXpRaw - xpFloor);
        let xpNeeded = Math.max(1, xpGoal - xpFloor);
        let rankIndex = higherCount + 1;

        const settings = await GuildSettings.findOne({ where: { guildId: guild.id } }).catch(() => null);
        const userPrefs = await UserPrefs.findOne({ where: { userId: target.id } }).catch(() => null);

        try {
            const imageBuffer = await Promise.race([
                generateRankCard({
                    username: target.username,
                    level: currentLevel,
                    currentXp: xpInLevel,
                    nextLevelXp: xpNeeded,
                    rank: rankIndex,
                    avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
                    showPfp: userPrefs?.showAvatarInRankCard !== false,
                    bgColor: settings?.levelingCardBgColor || '#090a10',
                    accentColor: userPrefs?.rankCardCustomColor || settings?.levelingCardAccentColor || '#6366f1',
                    borderColor: settings?.levelingCardBorderColor || '#232538',
                    isPremium: true,
                    userCustomBg: userPrefs?.rankCardBackgroundImage || null
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
            ]);

            const isGif = imageBuffer.slice(0, 3).toString() === 'GIF';
            const attachment = new AttachmentBuilder(imageBuffer, { name: isGif ? 'rank.gif' : 'rank.png' });

            return message.reply({
                content: `Here is the rank card for **${target.username}**! 🪪✨`,
                files: [attachment],
                allowedMentions: { repliedUser: false }
            });
        } catch (e) {
            const embed = new EmbedBuilder()
                .setTitle(`${target.username}'s Rank Profile`)
                .setThumbnail(target.displayAvatarURL({ dynamic: true }))
                .setColor(0x6366f1)
                .addFields(
                    { name: 'Rank', value: `#${rankIndex}`, inline: true },
                    { name: 'Level', value: `${currentLevel}`, inline: true },
                    { name: 'Total XP', value: `${totalXpRaw.toLocaleString()}`, inline: true }
                )
                .setTimestamp();
            return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        }
    }

    if (intent.action === 'LEADERBOARD') {
        const topUsers = await UserLevel.findAll({
            where: { guildId: guild.id },
            order: [['totalXp', 'DESC']],
            limit: 10
        });

        const lines = [];
        for (let i = 0; i < topUsers.length; i++) {
            const u = topUsers[i];
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `**#${i + 1}**`));
            lines.push(`${medal} <@${u.userId}> — Level **${u.level}** (${(u.totalXp || 0).toLocaleString()} XP)`);
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏆 Server XP Leaderboard | ${guild.name}`)
            .setDescription(lines.length > 0 ? lines.join('\n') : 'No XP records logged yet in this server!')
            .setColor(0x5865F2)
            .setFooter({ text: 'Keep chatting to climb the leaderboard!' })
            .setTimestamp();

        return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    }

    if (intent.action === 'AVATAR') {
        const target = (intent.target && intent.target.id !== client.user?.id) ? intent.target : message.author;
        const embed = new EmbedBuilder()
            .setTitle(`${target.username}'s Avatar`)
            .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setColor(0x5865F2)
            .setTimestamp();
        return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    }

    if (intent.action === 'PING') {
        const wsPing = client.ws.ping;
        return message.reply({
            content: `🏓 **Pong!** WebSocket Latency: \`${wsPing}ms\`. Nora engines operational! ✨`,
            allowedMentions: { repliedUser: false }
        });
    }

    if (intent.action === 'INFO') {
        const embed = new EmbedBuilder()
            .setTitle('✨ Nora Systems Core V20.0')
            .setDescription(`Created and developed by **Vaztinix** (<@${BOT_DEVELOPER_ID}>).\nRunning on Google Gemini Multimodal Engine with Autonomous Execution & Moderation Power.`)
            .addFields(
                { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
                { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
                { name: 'Architecture', value: 'Gemini 3.8/3.7 Multi-Key Pool', inline: true }
            )
            .setColor(0x5865F2)
            .setTimestamp();
        return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    }

    if (intent.action === 'AI_QUOTA') {
        const geminiKeyManager = require('./geminiKeyManager');
        const embed = geminiKeyManager.getQuotaStatusEmbed();
        return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    }
}

/**
 * 🛡️ Verifies Permissions and Role Hierarchy for Moderation
 */
async function checkModerationAuthority(message, client, intent) {
    const guild = message.guild;
    const author = message.author;
    const member = message.member;
    const me = guild.members.me;

    const isDeveloper = author.id === BOT_DEVELOPER_ID;
    const isGuildOwner = author.id === guild.ownerId;

    // Self-bot moderation attempt block
    if (intent.target && intent.target.id === client.user?.id) {
        return {
            allowed: false,
            reason: `Nice try, but I can't moderate myself! 😉 I'm here to help manage the server. Mention another user and I'll take care of it!`
        };
    }

    // 1. Permission checks based on action
    const reqPermMap = {
        'MUTE': PermissionFlagsBits.ModerateMembers,
        'UNMUTE': PermissionFlagsBits.ModerateMembers,
        'KICK': PermissionFlagsBits.KickMembers,
        'BAN': PermissionFlagsBits.BanMembers,
        'UNBAN': PermissionFlagsBits.BanMembers,
        'WARN': PermissionFlagsBits.ModerateMembers,
        'PURGE': PermissionFlagsBits.ManageMessages,
        'LOCK': PermissionFlagsBits.ManageChannels,
        'UNLOCK': PermissionFlagsBits.ManageChannels,
        'SLOWMODE': PermissionFlagsBits.ManageChannels,
        'ROLE_ADD': PermissionFlagsBits.ManageRoles,
        'ROLE_REMOVE': PermissionFlagsBits.ManageRoles
    };

    const permFriendlyNames = {
        'MUTE': 'Moderate Members (Timeout)',
        'UNMUTE': 'Moderate Members',
        'KICK': 'Kick Members',
        'BAN': 'Ban Members',
        'UNBAN': 'Ban Members',
        'WARN': 'Moderate Members',
        'PURGE': 'Manage Messages',
        'LOCK': 'Manage Channels',
        'UNLOCK': 'Manage Channels',
        'SLOWMODE': 'Manage Channels',
        'ROLE_ADD': 'Manage Roles',
        'ROLE_REMOVE': 'Manage Roles'
    };

    // Handle missing target intent
    if (intent.action === 'TARGET_REQUIRED') {
        let permKey = 'MUTE';
        const reqLower = (intent.requestedAction || '').toLowerCase();
        if (reqLower.includes('ban')) permKey = 'BAN';
        else if (reqLower.includes('kick')) permKey = 'KICK';
        else if (reqLower.includes('timeout') || reqLower.includes('mute') || reqLower.includes('warn')) permKey = 'MUTE';

        const reqPerm = reqPermMap[permKey];
        if (reqPerm && !isDeveloper && !isGuildOwner) {
            if (!member.permissions.has(reqPerm) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return {
                    allowed: false,
                    reason: `❌ **Permission Denied**: You do not have permission to ${intent.requestedAction.toLowerCase()} members on this server. (Requires \`${permFriendlyNames[permKey] || 'Moderator'}\`)`
                };
            }
        }

        return {
            allowed: false,
            reason: `⚠️ **Target User Required**: To **${intent.requestedAction.toLowerCase()}** someone, you must explicitly mention the user (e.g., \`@user\`) or provide their Discord User ID. For server security, I will never choose a random member.`
        };
    }

    const requiredPerm = reqPermMap[intent.action];
    if (requiredPerm && !isDeveloper && !isGuildOwner) {
        if (!member.permissions.has(requiredPerm) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
            return {
                allowed: false,
                reason: `❌ **Permission Denied**: You do not have permission to execute this moderation action. (Requires \`${permFriendlyNames[intent.action] || 'Moderator'}\`)`
            };
        }
    }

    // 2. Bot Permission Check
    if (requiredPerm && !me.permissions.has(requiredPerm) && !me.permissions.has(PermissionFlagsBits.Administrator)) {
        return {
            allowed: false,
            reason: `❌ **Bot Permission Error**: I lack the necessary permissions on this server to perform **${intent.action}**.`
        };
    }

    // 3. Target Hierarchy Checks (if targeting a member)
    if (intent.target && intent.target.id !== client.user?.id) {
        const targetUser = intent.target;
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (targetMember) {
            // Cannot punish server owner
            if (targetMember.id === guild.ownerId) {
                return {
                    allowed: false,
                    reason: `🛡️ **Security Guard**: Cannot perform punitive actions on the Server Owner.`
                };
            }

            // Target vs Requester hierarchy check (unless self-test or guild owner/dev)
            if (targetMember.id !== author.id && !isGuildOwner && !isDeveloper) {
                if (targetMember.roles.highest.position >= member.roles.highest.position) {
                    return {
                        allowed: false,
                        reason: `🛡️ **Role Hierarchy Error**: You cannot moderate <@${targetMember.id}> because their highest role is equal to or higher than yours.`
                    };
                }
            }

            // Target vs Bot hierarchy check (skip if target is requester themselves running a self-test and requester is below bot)
            if (targetMember.id !== author.id) {
                if (targetMember.roles.highest.position >= me.roles.highest.position) {
                    return {
                        allowed: false,
                        reason: `🛡️ **Bot Hierarchy Error**: I cannot moderate <@${targetMember.id}> because their highest role is equal to or higher than my highest role.`
                    };
                }
            } else {
                // If user is muting themselves, check if bot can manage them
                if (!targetMember.manageable && targetMember.id !== guild.ownerId && !isDeveloper) {
                    return {
                        allowed: false,
                        reason: `🛡️ **Bot Hierarchy Error**: I cannot moderate you because your highest role is higher than my highest bot role.`
                    };
                }
            }
        }
    }

    return { allowed: true };
}

/**
 * 🔘 Handles Moderation Action with Interactive Confirmation Buttons and Database Logging
 */
async function handleInteractiveModeration(message, client, intent) {
    const authCheck = await checkModerationAuthority(message, client, intent);
    if (!authCheck.allowed) {
        return message.reply({
            content: authCheck.reason,
            allowedMentions: { repliedUser: false }
        });
    }

    const actionId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const target = intent.target || { id: intent.targetId || 'N/A', username: 'Target' };

    // Format action labels & icons
    let actionTitle = 'Moderation Request';
    let actionDesc = '';
    let actionColor = 0xF59E0B; // Amber warning color

    if (intent.action === 'MUTE') {
        actionTitle = '🔇 Confirm Member Timeout';
        actionDesc = `Are you sure you want to time out **${target.username || target.tag}** for **${intent.duration.display}**?\n**Reason:** ${intent.reason}`;
    } else if (intent.action === 'UNMUTE') {
        actionTitle = '🔊 Confirm Untimeout';
        actionDesc = `Are you sure you want to remove timeout from **${target.username || target.tag}**?`;
        actionColor = 0x10B981;
    } else if (intent.action === 'KICK') {
        actionTitle = '👢 Confirm Kick Member';
        actionDesc = `Are you sure you want to kick **${target.username || target.tag}** from the server?\n**Reason:** ${intent.reason}`;
        actionColor = 0xEF4444;
    } else if (intent.action === 'BAN') {
        actionTitle = '🔨 Confirm Ban User';
        actionDesc = `Are you sure you want to ban **${target.username || target.tag}** (\`${target.id}\`)?\n**Reason:** ${intent.reason}`;
        actionColor = 0xDC2626;
    } else if (intent.action === 'UNBAN') {
        actionTitle = '🕊️ Confirm Unban User';
        actionDesc = `Are you sure you want to unban user ID **${intent.targetId}**?`;
        actionColor = 0x10B981;
    } else if (intent.action === 'WARN') {
        actionTitle = '⚠️ Confirm Issue Warning';
        actionDesc = `Are you sure you want to issue a formal warning to **${target.username || target.tag}**?\n**Reason:** ${intent.reason}`;
    } else if (intent.action === 'PURGE') {
        actionTitle = '🧹 Confirm Message Purge';
        actionDesc = `Are you sure you want to delete **${intent.amount}** recent messages in this channel?`;
    } else if (intent.action === 'LOCK') {
        actionTitle = '🔒 Confirm Channel Lockdown';
        actionDesc = `Are you sure you want to lock <#${intent.channel.id}> to prevent members from sending messages?`;
    } else if (intent.action === 'UNLOCK') {
        actionTitle = '🔓 Confirm Channel Unlock';
        actionDesc = `Are you sure you want to unlock <#${intent.channel.id}>?`;
    } else if (intent.action === 'SLOWMODE') {
        actionTitle = '⏱️ Confirm Slowmode Adjustment';
        actionDesc = `Are you sure you want to set channel slowmode to **${intent.seconds}s**?`;
    }

    const confirmEmbed = new EmbedBuilder()
        .setTitle(actionTitle)
        .setDescription(actionDesc)
        .setColor(actionColor)
        .addFields(
            { name: 'Initiated By', value: `<@${message.author.id}> (\`${message.author.tag}\`)`, inline: true },
            { name: 'Target', value: target.id ? `<@${target.id}> (\`${target.id}\`)` : 'Channel', inline: true }
        )
        .setFooter({ text: `⚠️ Only ${message.author.username} can confirm or abort. Auto-expires in 60s.` })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`nora_mod_confirm_${actionId}`)
            .setLabel('Confirm Execution')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId(`nora_mod_abort_${actionId}`)
            .setLabel('Abort Action')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('✖️')
    );

    const promptMessage = await message.reply({
        embeds: [confirmEmbed],
        components: [row],
        allowedMentions: { repliedUser: false }
    }).catch(err => {
        console.error('[NoraAction] Reply error:', err.message);
        return null;
    });

    if (!promptMessage) return;

    // Create Interactive Component Collector
    const collector = promptMessage.createMessageComponentCollector({
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        // Enforce strict initiator-only authorization
        if (interaction.user.id !== message.author.id) {
            return interaction.reply({
                content: `❌ Only the staff member who initiated this action (<@${message.author.id}>) has permission to confirm or abort it.`,
                ephemeral: true
            });
        }

        // Handle Abort
        if (interaction.customId === `nora_mod_abort_${actionId}`) {
            collector.stop('aborted');
            const abortEmbed = EmbedBuilder.from(confirmEmbed)
                .setTitle('🛑 Moderation Action Aborted')
                .setDescription(`The requested **${intent.action}** operation was safely cancelled by <@${message.author.id}>. No changes were made.`)
                .setColor(0x64748B);

            return interaction.update({
                embeds: [abortEmbed],
                components: []
            });
        }

        // Handle Confirm
        if (interaction.customId === `nora_mod_confirm_${actionId}`) {
            collector.stop('confirmed');
            await interaction.deferUpdate().catch(() => {});

            try {
                let executionResult = await performModerationAction(message.guild, message.author, intent);

                const successEmbed = new EmbedBuilder()
                    .setTitle(`✅ Action Executed: ${intent.action}`)
                    .setDescription(executionResult.description)
                    .setColor(0x10B981)
                    .addFields(
                        { name: 'Target', value: target.id ? `<@${target.id}> (\`${target.id}\`)` : 'Channel', inline: true },
                        { name: 'Moderator', value: `<@${message.author.id}>`, inline: true },
                        { name: 'Case Reference', value: executionResult.caseId ? `#${executionResult.caseId}` : 'Logged', inline: true }
                    )
                    .setFooter({ text: 'Nora Autonomous Moderation & Security System' })
                    .setTimestamp();

                await promptMessage.edit({
                    embeds: [successEmbed],
                    components: []
                }).catch(() => {});
            } catch (err) {
                console.error('[NoraAction] Execution error:', err);
                const errorEmbed = EmbedBuilder.from(confirmEmbed)
                    .setTitle('❌ Execution Error')
                    .setDescription(`Failed to execute **${intent.action}**: ${err.message}`)
                    .setColor(0xEF4444);

                await promptMessage.edit({
                    embeds: [errorEmbed],
                    components: []
                }).catch(() => {});
            }
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            const timeoutEmbed = EmbedBuilder.from(confirmEmbed)
                .setTitle('⏱️ Confirmation Expired')
                .setDescription('The moderation confirmation dialog timed out after 60 seconds without response. No changes were made.')
                .setColor(0x475569);

            promptMessage.edit({
                embeds: [timeoutEmbed],
                components: []
            }).catch(() => {});
        }
    });
}

/**
 * ⚙️ Physically executes the moderation task on Discord and logs to DB & channels
 */
async function performModerationAction(guild, moderator, intent) {
    const settings = await GuildSettings.findOne({ where: { guildId: guild.id } }).catch(() => null);
    let caseId = null;
    let description = '';

    if (intent.action === 'MUTE') {
        const member = await guild.members.fetch(intent.target.id);
        await member.timeout(intent.duration.ms, `${intent.reason} (Mod: ${moderator.tag})`);

        const caseRecord = await Case.create({
            guildId: guild.id,
            userId: intent.target.id,
            moderatorId: moderator.id,
            type: 'MUTE',
            reason: intent.reason,
            status: 'active',
            duration: intent.duration.ms
        });
        caseId = caseRecord.id;
        description = `**${intent.target.username}** has been timed out for **${intent.duration.display}**.\n**Reason:** ${intent.reason}`;

        // DM Target
        if (settings?.sendModDms !== false) {
            const dm = new EmbedBuilder()
                .setTitle(`🔇 Timed Out in ${guild.name}`)
                .setColor(0xF59E0B)
                .addFields(
                    { name: 'Duration', value: intent.duration.display, inline: true },
                    { name: 'Moderator', value: moderator.tag, inline: true },
                    { name: 'Reason', value: intent.reason }
                )
                .setTimestamp();
            await intent.target.send({ embeds: [dm] }).catch(() => {});
        }
    } else if (intent.action === 'UNMUTE') {
        const member = await guild.members.fetch(intent.target.id);
        await member.timeout(null, `Timeout removed by ${moderator.tag}`);

        const caseRecord = await Case.create({
            guildId: guild.id,
            userId: intent.target.id,
            moderatorId: moderator.id,
            type: 'UNMUTE',
            reason: intent.reason || 'Timeout removed',
            status: 'active'
        });
        caseId = caseRecord.id;
        description = `Timeout removed from **${intent.target.username}**.`;
    } else if (intent.action === 'KICK') {
        const member = await guild.members.fetch(intent.target.id);
        // DM Target before kicking
        if (settings?.sendModDms !== false) {
            const dm = new EmbedBuilder()
                .setTitle(`👢 Kicked from ${guild.name}`)
                .setColor(0xEF4444)
                .addFields(
                    { name: 'Moderator', value: moderator.tag, inline: true },
                    { name: 'Reason', value: intent.reason }
                )
                .setTimestamp();
            await intent.target.send({ embeds: [dm] }).catch(() => {});
        }

        await member.kick(`${intent.reason} (Mod: ${moderator.tag})`);
        const caseRecord = await Case.create({
            guildId: guild.id,
            userId: intent.target.id,
            moderatorId: moderator.id,
            type: 'KICK',
            reason: intent.reason,
            status: 'active'
        });
        caseId = caseRecord.id;
        description = `**${intent.target.username}** has been kicked from the server.\n**Reason:** ${intent.reason}`;
    } else if (intent.action === 'BAN') {
        const targetId = intent.targetId || intent.target.id;
        if (settings?.sendModDms !== false && intent.target.send) {
            const dm = new EmbedBuilder()
                .setTitle(`🔨 Banned from ${guild.name}`)
                .setColor(0xDC2626)
                .addFields(
                    { name: 'Moderator', value: moderator.tag, inline: true },
                    { name: 'Reason', value: intent.reason }
                )
                .setTimestamp();
            await intent.target.send({ embeds: [dm] }).catch(() => {});
        }

        await guild.members.ban(targetId, { reason: `${intent.reason} (Mod: ${moderator.tag})` });
        const caseRecord = await Case.create({
            guildId: guild.id,
            userId: targetId,
            moderatorId: moderator.id,
            type: 'BAN',
            reason: intent.reason,
            status: 'active'
        });
        caseId = caseRecord.id;
        description = `User **${intent.target.username || targetId}** has been permanently banned from the server.\n**Reason:** ${intent.reason}`;
    } else if (intent.action === 'UNBAN') {
        await guild.bans.remove(intent.targetId, `Unbanned by ${moderator.tag}`);
        const caseRecord = await Case.create({
            guildId: guild.id,
            userId: intent.targetId,
            moderatorId: moderator.id,
            type: 'UNBAN',
            reason: intent.reason,
            status: 'active'
        });
        caseId = caseRecord.id;
        description = `User ID **${intent.targetId}** has been unbanned.`;
    } else if (intent.action === 'WARN') {
        const warnRecord = await Warning.create({
            guildId: guild.id,
            userId: intent.target.id,
            moderatorId: moderator.id,
            reason: intent.reason,
            severity: 'medium',
            active: true
        });

        const caseRecord = await Case.create({
            guildId: guild.id,
            userId: intent.target.id,
            moderatorId: moderator.id,
            type: 'WARN',
            reason: intent.reason,
            status: 'active'
        });
        caseId = caseRecord.id;
        description = `Warning #${warnRecord.id} successfully recorded for **${intent.target.username}**.\n**Reason:** ${intent.reason}`;

        if (settings?.sendModDms !== false) {
            const dm = new EmbedBuilder()
                .setTitle(`⚠️ Warning in ${guild.name}`)
                .setColor(0xF59E0B)
                .addFields(
                    { name: 'Moderator', value: moderator.tag, inline: true },
                    { name: 'Reason', value: intent.reason }
                )
                .setTimestamp();
            await intent.target.send({ embeds: [dm] }).catch(() => {});
        }
    } else if (intent.action === 'PURGE') {
        const deleted = await intent.channel?.bulkDelete ? await intent.channel.bulkDelete(intent.amount, true) : null;
        description = `Successfully purged **${deleted?.size || intent.amount}** messages in <#${intent.channel?.id || guild.id}>.`;
    } else if (intent.action === 'LOCK') {
        await intent.channel.permissionOverwrites.edit(guild.roles.everyone, {
            SendMessages: false,
            AddReactions: false
        });
        description = `🔒 <#${intent.channel.id}> has been locked down.`;
    } else if (intent.action === 'UNLOCK') {
        await intent.channel.permissionOverwrites.edit(guild.roles.everyone, {
            SendMessages: null,
            AddReactions: null
        });
        description = `🔓 <#${intent.channel.id}> lockdown has been lifted.`;
    } else if (intent.action === 'SLOWMODE') {
        await intent.channel.setRateLimitPerUser(intent.seconds, `Slowmode updated by ${moderator.tag}`);
        description = `⏱️ Slowmode in <#${intent.channel.id}> set to **${intent.seconds}s**.`;
    }

    // Send ModLog to configured channel
    const modLogChannelId = settings?.modLogChannelId || settings?.loggingChannelId;
    if (modLogChannelId) {
        const logChan = guild.channels.cache.get(modLogChannelId);
        if (logChan) {
            const logEmbed = new EmbedBuilder()
                .setTitle(`🛡️ Nora Action Executed | ${intent.action} ${caseId ? `(Case #${caseId})` : ''}`)
                .setColor(0x5865F2)
                .setDescription(description)
                .addFields(
                    { name: 'Moderator', value: `${moderator.tag} (<@${moderator.id}>)`, inline: true },
                    { name: 'Channel', value: `<#${intent.channel?.id || logChan.id}>`, inline: true }
                )
                .setTimestamp();
            await logChan.send({ embeds: [logEmbed] }).catch(() => {});
        }
    }

    return { caseId, description };
}

/**
 * Main Entrypoint: Process Nora Action Execution Request
 * @returns {Promise<boolean>} true if an action was recognized and handled
 */
async function processNoraAction(message, client, plainContent) {
    const intent = await detectIntent(message, plainContent);
    if (!intent) return false;

    if (intent.type === 'UTILITY') {
        await executeUtility(message, client, intent);
        return true;
    }

    if (intent.type === 'MODERATION') {
        await handleInteractiveModeration(message, client, intent);
        return true;
    }

    return false;
}

module.exports = {
    detectIntent,
    processNoraAction,
    resolveTargetUser
};
