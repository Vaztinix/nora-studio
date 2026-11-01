const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const settingsCache = require('./settingsCache');
const logger = require('./logger');

// Popular games recognized by Discord's Rich Presence for quick-pick autocomplete & UI
const POPULAR_DISCORD_GAMES = [
    'Roblox',
    'Rocket League',
    'Minecraft',
    'Fortnite',
    'Valorant',
    'League of Legends',
    'Counter-Strike 2',
    'Grand Theft Auto V',
    'Apex Legends',
    'Call of Duty',
    'Overwatch 2',
    'Genshin Impact',
    'Honkai: Star Rail',
    'Rainbow Six Siege',
    'Terraria',
    'Among Us',
    'Dead by Daylight',
    'Destiny 2',
    'Rust',
    'Helldivers 2',
    'Brawlhalla',
    'Warframe',
    'Dota 2',
    'Team Fortress 2',
    'Palworld',
    'World of Warcraft',
    'osu!',
    'Cyberpunk 2077',
    'Elden Ring'
];

// Anti-spam debounce map to prevent rapid bounce loops: key = `${guildId}:${userId}` -> timestamp
const moveDebounceMap = new Map();
const COOLDOWN_MS = 8000; // 8 second cooldown between automatic moves per member

/**
 * Extract active games from a user's Discord presence
 * Excludes custom status (ActivityType.Custom = 4)
 */
function extractUserGameActivities(presence) {
    if (!presence || !presence.activities || !Array.isArray(presence.activities)) return [];
    return presence.activities.filter(a => {
        if (!a || a.type === 4) return false; // Ignore custom status
        // Type 0 is Playing, 1 is Streaming, etc. Any activity with a game name qualifies
        return a.name && typeof a.name === 'string' && a.name.trim().length > 0;
    });
}

/**
 * Check if an activity matches a configured game rule (exact or case-insensitive contains)
 */
function matchesGameRule(activityName, ruleGameName) {
    if (!activityName || !ruleGameName) return false;
    const act = activityName.toLowerCase().trim();
    const rule = ruleGameName.toLowerCase().trim();
    return act === rule || act.includes(rule) || rule.includes(act);
}

/**
 * Parse and sanitize stored activity rules
 */
function parseRules(rulesRaw) {
    if (!rulesRaw) return [];
    if (Array.isArray(rulesRaw)) return rulesRaw;
    try {
        const parsed = JSON.parse(rulesRaw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

/**
 * Core router: Evaluates a member's current game activities and routes them to the locked voice channel if needed
 */
async function evaluateMemberActivityAndRoute(member, currentVoiceChannelId, presence, settings) {
    if (!member || !member.guild || !currentVoiceChannelId) return false;
    if (member.user?.bot) return false;

    // Check debounce cooldown
    const debounceKey = `${member.guild.id}:${member.id}`;
    const lastMove = moveDebounceMap.get(debounceKey) || 0;
    const now = Date.now();
    if (now - lastMove < COOLDOWN_MS) {
        return false;
    }

    const rules = parseRules(settings.activityVcRules);
    if (!rules || rules.length === 0) return false;

    const gameActivities = extractUserGameActivities(presence);
    if (gameActivities.length === 0) return false;

    // Find the first rule matching any currently active game
    let matchedRule = null;
    let matchedActivity = null;

    for (const rule of rules) {
        if (!rule || !rule.gameName || !rule.channelId) continue;
        const matchingAct = gameActivities.find(a => matchesGameRule(a.name, rule.gameName));
        if (matchingAct) {
            matchedRule = rule;
            matchedActivity = matchingAct;
            break;
        }
    }

    if (!matchedRule) return false;

    // If user is already in the designated channel, nothing to do
    if (currentVoiceChannelId === matchedRule.channelId) {
        return false;
    }

    // Verify target channel exists in the guild and is a voice-capable channel
    const targetChannel = member.guild.channels.cache.get(matchedRule.channelId);
    if (!targetChannel || !targetChannel.isVoiceBased()) {
        return false;
    }

    // Check Nora's permissions
    const botMember = member.guild.members.me;
    if (!botMember) return false;

    if (!botMember.permissions.has(PermissionFlagsBits.MoveMembers)) {
        console.warn(`[Activity VC Lock] Nora lacks MoveMembers permission in guild ${member.guild.name} (${member.guild.id})`);
        return false;
    }

    // Check if target channel is full or accessible
    if (targetChannel.userLimit > 0 && targetChannel.members.size >= targetChannel.userLimit) {
        // Target channel is full
        return false;
    }

    // Record debounce timestamp before moving
    moveDebounceMap.set(debounceKey, now);

    try {
        const originChannel = member.guild.channels.cache.get(currentVoiceChannelId);
        const originName = originChannel ? originChannel.name : 'Unknown Voice';

        // Move member to the designated game channel
        await member.voice.setChannel(
            targetChannel,
            `Current User Activities: Playing ${matchedActivity.name} (Mapped to #${targetChannel.name})`
        );

        console.log(`[Activity VC Lock] Moved ${member.user.tag} from #${originName} to #${targetChannel.name} (Playing: ${matchedActivity.name}) in ${member.guild.name}`);

        // Optional DM notification to member
        if (settings.activityVcNotifyUser !== false) {
            try {
                const notifyEmbed = new EmbedBuilder()
                    .setTitle('🎮 Current User Activities — Channel Routed')
                    .setDescription(`You were moved to **#${targetChannel.name}** in **${member.guild.name}** because you are currently playing **${matchedActivity.name}**.`)
                    .addFields(
                        { name: 'Active Game', value: `\`${matchedActivity.name}\``, inline: true },
                        { name: 'Voice Channel', value: `<#${targetChannel.id}>`, inline: true }
                    )
                    .setColor(0x5865F2)
                    .setFooter({ text: 'Current User Activities VC Lock • Nora' })
                    .setTimestamp();

                await member.send({ embeds: [notifyEmbed] }).catch(() => {});
            } catch (_) {
                // Ignore closed DMs
            }
        }

        // Send server log if voice logging is active
        try {
            const logEmbed = new EmbedBuilder()
                .setTitle('🎮 Activity-Locked Voice Move')
                .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
                .setDescription(`**User:** <@${member.id}>\n**Game Detected:** \`${matchedActivity.name}\`\n**Action:** Moved from <#${currentVoiceChannelId}> ➔ <#${targetChannel.id}>`)
                .setColor(0x5865f2)
                .setTimestamp();

            await logger.sendEventLog(member.guild, 'voiceMoves', logEmbed, settings, targetChannel.id).catch(() => {});
        } catch (_) {}

        return true;
    } catch (err) {
        console.error(`[Activity VC Lock] Failed to move ${member.user.tag}:`, err.message);
        return false;
    }
}

/**
 * Handle PresenceUpdate event from Discord Gateway
 */
async function handlePresenceUpdate(oldPresence, newPresence) {
    if (!newPresence || !newPresence.guild || !newPresence.member) return;
    if (newPresence.member.user?.bot) return;

    try {
        const settings = await settingsCache.get(newPresence.guild.id);
        if (!settings || !settings.activityVcLockEnabled) return;

        // Check if member is currently in a voice channel
        const currentVoiceChannelId = newPresence.member.voice?.channelId;
        if (!currentVoiceChannelId) return;

        await evaluateMemberActivityAndRoute(newPresence.member, currentVoiceChannelId, newPresence, settings);
    } catch (err) {
        console.error('[Activity VC Lock] Error in handlePresenceUpdate:', err);
    }
}

/**
 * Handle VoiceStateUpdate event from Discord Gateway
 * (Checks user when they join or move between voice channels)
 */
async function handleVoiceStateUpdate(oldState, newState) {
    if (!newState || !newState.guild || !newState.member) return;
    if (newState.member.user?.bot) return;

    // Only inspect when member joins a voice channel or moves between channels
    if (!newState.channelId) return; // Disconnected from voice
    if (oldState.channelId === newState.channelId) return; // Mute / deafen only

    try {
        const settings = await settingsCache.get(newState.guild.id);
        if (!settings || !settings.activityVcLockEnabled) return;

        const presence = newState.member.presence;
        if (!presence) return;

        await evaluateMemberActivityAndRoute(newState.member, newState.channelId, presence, settings);
    } catch (err) {
        console.error('[Activity VC Lock] Error in handleVoiceStateUpdate:', err);
    }
}

module.exports = {
    POPULAR_DISCORD_GAMES,
    extractUserGameActivities,
    matchesGameRule,
    parseRules,
    evaluateMemberActivityAndRoute,
    handlePresenceUpdate,
    handleVoiceStateUpdate
};
