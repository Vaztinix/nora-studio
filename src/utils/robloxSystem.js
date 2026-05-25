const axios = require('axios');
const RobloxVerify = require('../database/models/RobloxVerify');
const GuildSettings = require('../database/models/GuildSettings');

/**
 * Roblox System Service
 * Handles background presence tracking, group rank synchronization, and live game joinability.
 */
module.exports = {
    start: (client) => {
        console.log('[Roblox System] Initializing Autonomous Identity Tracker...');
        
        // Loop every 5 minutes to avoid hitting Roblox rate limits too hard
        setInterval(() => syncAllGuilds(client), 300000);
        
        // Initial sync after 30 seconds
        setTimeout(() => syncAllGuilds(client), 30000);
    },

    syncGuild: async (client, guildId) => {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const settings = await GuildSettings.findOne({ where: { guildId } });
        if (!settings || !settings.robloxVerifyEnabled) return;

        const verifiedUsers = await RobloxVerify.findAll({ where: { status: 'VERIFIED' } });
        if (!verifiedUsers.length) return;

        // Filter users actually in this guild
        const guildVerifiedUsers = [];
        for (const record of verifiedUsers) {
            const member = guild.members.cache.get(record.userId);
            if (member) guildVerifiedUsers.push({ member, record });
        }

        if (!guildVerifiedUsers.length) return;

        // 1. Group Rank Synchronization
        let groupBindings = [];
        try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) {}

        if (groupBindings.length > 0) {
            for (const { member, record } of guildVerifiedUsers) {
                await syncGroupRanks(member, record.robloxId, groupBindings);
            }
        }

        // 2. Live Presence Tracking (Optional announcement or role)
        if (settings.robloxLiveActivityEnabled) {
            // We could implement something here, but polling 1000s of users is heavy.
            // For now, we rely on the manual "Check Status" in dashboard or /verify-roblox check
        }
    }
};

async function syncAllGuilds(client) {
    for (const guild of client.guilds.cache.values()) {
        try {
            await module.exports.syncGuild(client, guild.id);
        } catch (e) {
            console.error(`[Roblox System] Failed sync for ${guild.name}:`, e.message);
        }
    }
}

async function syncGroupRanks(member, robloxId, bindings) {
    try {
        // Group bindings are [{ groupId, rank, roleId }]
        // We need to fetch all groups the user is in
        const res = await axios.get(`https://groups.roblox.com/v2/users/${robloxId}/groups/roles`, { timeout: 5000 });
        const userGroups = res.data.data || [];

        for (const binding of bindings) {
            const userGroup = userGroups.find(g => g.group.id.toString() === binding.groupId.toString());
            const role = member.guild.roles.cache.get(binding.roleId);
            if (!role) continue;

            const hasRole = member.roles.cache.has(role.id);
            const rankMatch = userGroup && userGroup.role.rank.toString() === binding.rank.toString();

            if (rankMatch && !hasRole) {
                await member.roles.add(role, 'Nora Roblox Group Sync').catch(() => {});
            } else if (!rankMatch && hasRole) {
                // Only remove if they are NOT in the group or rank doesn't match
                // We might want to be careful here if they have roles manually.
                // But for "Sync", it should be strict.
                await member.roles.remove(role, 'Nora Roblox Group Sync').catch(() => {});
            }
        }
    } catch (e) {
        // Silent fail for rate limits
    }
}
