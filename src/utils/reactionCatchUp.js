// ─────────────────────────────────────────────────────────────────────────────
// 🛡️ Nora Reaction Role & Verification Catch-Up Engine
// Automatically recovers and grants deserved roles to users who reacted while Nora was offline.
// Runs every 15 minutes silently with zero log clutter.
// ─────────────────────────────────────────────────────────────────────────────

const { PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const ReactionRole = require('../database/models/ReactionRole');
const { matchesEmoji } = require('./reactionRoleHelper');
const { grantVerificationRoles } = require('../bot/engines/verify');

let isSyncRunning = false;

/**
 * Fetches all users who reacted with a specific emoji (handling pagination up to 5,000 users)
 */
async function fetchAllReactionUsers(reaction) {
    const users = [];
    let lastId = null;
    let pageCount = 0;
    const MAX_PAGES = 50; // up to 5,000 users per reaction

    try {
        if (reaction.partial) {
            await reaction.fetch().catch(() => null);
        }

        while (pageCount < MAX_PAGES) {
            pageCount++;
            const options = { limit: 100 };
            if (lastId) options.after = lastId;

            const fetched = await reaction.users.fetch(options).catch(() => null);
            if (!fetched || fetched.size === 0) break;

            for (const user of fetched.values()) {
                users.push(user);
            }

            if (fetched.size < 100) break;
            lastId = fetched.lastKey();
        }
    } catch (_) {}

    return users;
}

/**
 * Helper to locate a message in a guild by ID
 */
async function findMessageInGuild(guild, messageId, preferredChannelId = null) {
    if (!guild || !messageId) return null;

    if (preferredChannelId) {
        try {
            const channel = guild.channels.cache.get(preferredChannelId) || await guild.channels.fetch(preferredChannelId).catch(() => null);
            if (channel && channel.isTextBased && channel.isTextBased()) {
                const msg = await channel.messages.fetch(messageId).catch(() => null);
                if (msg) return msg;
            }
        } catch (_) {}
    }

    // Fallback: search text channels in cache
    for (const [, channel] of guild.channels.cache) {
        if (channel.isTextBased && channel.isTextBased() && channel.id !== preferredChannelId) {
            try {
                const msg = await channel.messages.fetch(messageId).catch(() => null);
                if (msg) return msg;
            } catch (_) {}
        }
    }

    return null;
}

/**
 * Sweeps reaction verification for a single guild
 */
async function syncGuildVerification(guild) {
    try {
        if (!guild.members.me || !guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return;
        }

        const settings = await GuildSettings.findOne({ where: { guildId: guild.id } }).catch(() => null);
        if (!settings || !settings.verifyRoleId) return;
        if (settings.verificationType !== 'reaction' && !settings.verifyMessageId) return;

        const messageId = settings.verifyMessageId;
        if (!messageId) return;

        const message = await findMessageInGuild(guild, messageId, settings.verifyChannelId);
        if (!message) return;

        const triggerEmoji = settings.verifyEmoji || '✅';
        const targetReaction = message.reactions.cache.find(r => matchesEmoji(r.emoji, triggerEmoji));
        if (!targetReaction) return;

        const isPremium = settings.isPremium === true || settings.isManualPremium === true;
        const maxVerifiedRoles = isPremium ? 5 : 3;
        const targetRoleIds = (settings.verifyRoleId || '').split(',').map(r => r.trim()).filter(Boolean).slice(0, maxVerifiedRoles);
        if (!targetRoleIds.length) return;

        const users = await fetchAllReactionUsers(targetReaction);

        for (const user of users) {
            if (user.bot) continue;

            const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);
            if (!member) continue;

            // Check if member already has all verified roles
            const hasAllRoles = targetRoleIds.every(rId => member.roles.cache.has(rId));
            
            // Check unverified role status if configured
            let hasUnverified = false;
            if (settings.removeUnverifiedRoleOnVerify !== false) {
                if (settings.unverifiedRoleId) {
                    const unvIds = settings.unverifiedRoleId.split(',').map(r => r.trim()).filter(Boolean);
                    hasUnverified = unvIds.some(uId => member.roles.cache.has(uId));
                } else {
                    hasUnverified = member.roles.cache.some(r => r.name.toLowerCase() === 'unverified');
                }
            }

            if (!hasAllRoles || hasUnverified) {
                await grantVerificationRoles(member, settings, { silent: true }, 'Reaction Catch-up', { silent: true }).catch(() => {});
                // Gentle delay to avoid Discord REST rate limits
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    } catch (_) {}
}

/**
 * Sweeps custom reaction roles for a single guild
 */
async function syncGuildReactionRoles(guild) {
    try {
        if (!guild.members.me || !guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return;
        }

        const mappings = await ReactionRole.findAll({ where: { guildId: guild.id } }).catch(() => []);
        if (!mappings || mappings.length === 0) return;

        const botHighest = guild.members.me.roles.highest.position;

        // Group by message ID
        const messageGroups = {};
        for (const m of mappings) {
            if (!messageGroups[m.messageId]) messageGroups[m.messageId] = [];
            messageGroups[m.messageId].push(m);
        }

        for (const [messageId, group] of Object.entries(messageGroups)) {
            const message = await findMessageInGuild(guild, messageId);
            if (!message) continue;

            for (const mapping of group) {
                const role = guild.roles.cache.get(mapping.roleId) || await guild.roles.fetch(mapping.roleId).catch(() => null);
                if (!role || role.position >= botHighest) continue;

                const targetReaction = message.reactions.cache.find(r => matchesEmoji(r.emoji, mapping.emoji));
                if (!targetReaction) continue;

                const users = await fetchAllReactionUsers(targetReaction);

                for (const user of users) {
                    if (user.bot) continue;

                    const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);
                    if (!member) continue;

                    if (!member.roles.cache.has(role.id)) {
                        await member.roles.add(role).catch(() => {});
                        // Gentle delay
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                }
            }
        }
    } catch (_) {}
}

/**
 * Executes a full silent sweep of reaction roles & reaction verifications across all guilds
 */
async function runReactionCatchUp(client) {
    if (!client || !client.isReady || !client.isReady()) return;
    if (isSyncRunning) return;

    isSyncRunning = true;
    try {
        for (const [, guild] of client.guilds.cache) {
            await syncGuildVerification(guild);
            await syncGuildReactionRoles(guild);
        }
    } catch (_) {
    } finally {
        isSyncRunning = false;
    }
}

/**
 * Initializes the automated reaction catch-up scheduler (runs shortly after startup, and every 15 minutes)
 */
function startReactionCatchUpScheduler(client) {
    // Initial check after 15 seconds to let caches warm up
    setTimeout(() => {
        runReactionCatchUp(client).catch(() => {});
    }, 15000);

    // Every 15 minutes (900,000 ms)
    setInterval(() => {
        runReactionCatchUp(client).catch(() => {});
    }, 15 * 60 * 1000);
}

module.exports = {
    runReactionCatchUp,
    startReactionCatchUpScheduler
};
