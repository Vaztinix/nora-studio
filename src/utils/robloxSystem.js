const axios = require('axios');
const RobloxVerify = require('../database/models/RobloxVerify');
const settingsCache = require('./settingsCache');

/**
 * Roblox System Service
 * Handles background presence tracking, group rank synchronization, and live game joinability.
 */
module.exports = {
    start: (client) => {
        console.log('[Roblox System] Initializing Autonomous Identity Tracker...');
        
        // Loop every 5 minutes to avoid hitting Roblox rate limits too hard
        setInterval(() => syncAllGuilds(client), 300000);

        // Polling check for in-game presence every 60 seconds
        setInterval(() => checkAllPresences(client), 60000);
        
        // Initial sync after 30 seconds
        setTimeout(() => syncAllGuilds(client), 30000);
        setTimeout(() => checkAllPresences(client), 45000);
    },

    syncGuild: async (client, guildId) => {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const settings = await settingsCache.get(guildId);
        if (!settings || !settings.robloxVerifyEnabled) return;

        const verifiedRecords = await RobloxVerify.findAll({ where: { userId: { [require('sequelize').Op.ne]: null }, status: 'VERIFIED' } });
        if (!verifiedRecords.length) return;

        // Group bindings are [{ groupId, rank, roleId }]
        let groupBindings = [];
        try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) {}
        if (!groupBindings || groupBindings.length === 0) return;

        // Organize records by Discord userId
        const userRecordsMap = new Map();
        for (const record of verifiedRecords) {
            if (!userRecordsMap.has(record.userId)) {
                userRecordsMap.set(record.userId, []);
            }
            userRecordsMap.get(record.userId).push(record);
        }

        // For each member who is in this guild, resolve their active Roblox account and sync roles
        for (const [userId, records] of userRecordsMap.entries()) {
            const member = guild.members.cache.get(userId);
            if (!member) continue;

            // Find active record
            let activeRecord = records.find(r => r.isActive);
            if (!activeRecord && records.length > 0) {
                // Fallback: set the first verified record as active
                activeRecord = records[0];
                await activeRecord.update({ isActive: true });
                // Ensure other records for this user are inactive
                for (let i = 1; i < records.length; i++) {
                    await records[i].update({ isActive: false });
                }
            }

            if (activeRecord && activeRecord.robloxId) {
                await syncRobloxRolesWithBackoff(member, activeRecord.robloxId, groupBindings);
            }
        }
    },

    syncGroupRanks: async (member, robloxId, bindings) => {
        // Fallback backward-compatible sync
        await syncRobloxRolesWithBackoff(member, robloxId, bindings);
    },

    syncRobloxRolesWithBackoff: async (member, robloxId, bindings) => {
        await syncRobloxRolesWithBackoff(member, robloxId, bindings);
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

async function syncRobloxRolesWithBackoff(member, robloxId, bindings, attempts = 1, delay = 1000) {
    try {
        const res = await axios.get(`https://groups.roblox.com/v2/users/${robloxId}/groups/roles`, { timeout: 5000 });
        const userGroups = res.data.data || [];

        for (const binding of bindings) {
            if (!binding.groupId || !binding.roleId) continue;
            const userGroup = userGroups.find(g => g.group.id.toString() === binding.groupId.toString());
            const role = member.guild.roles.cache.get(binding.roleId);
            if (!role) continue;

            const hasRole = member.roles.cache.has(role.id);
            // Rank match is true if user is in group and rank matches
            // If rank is configured as any/member or specific rank
            const rankMatch = userGroup && userGroup.role.rank.toString() === binding.rank.toString();

            if (rankMatch && !hasRole) {
                await member.roles.add(role, 'Nora Roblox Group Sync').catch(() => {});
            } else if (!rankMatch && hasRole) {
                await member.roles.remove(role, 'Nora Roblox Group Sync').catch(() => {});
            }
        }
        console.log(`[Roblox Group Sync] Successfully synced roles for User ${member.id} / Roblox ${robloxId}`);
    } catch (e) {
        if (attempts < 5) {
            const nextDelay = delay * 2;
            console.warn(`[Roblox Group Sync] Transient error fetching group roles for Roblox ID ${robloxId}. Retrying attempt ${attempts + 1} in ${nextDelay}ms. Error: ${e.message}`);
            setTimeout(() => {
                syncRobloxRolesWithBackoff(member, robloxId, bindings, attempts + 1, nextDelay);
            }, nextDelay);
        } else {
            console.error(`[Roblox Group Sync] Failed to sync roles for Roblox ID ${robloxId} after 5 attempts. Skipping.`);
        }
    }
}

const lastSeenSession = new Map();
global.liveRobloxSessions = new Map();

async function checkAllPresences(client) {
    try {
        const GuildSettings = require('../database/models/GuildSettings');
        const activeGuilds = await GuildSettings.findAll({ where: { robloxJoinGameEnabled: true } });
        if (activeGuilds.length === 0) return;

        const activeGuildIds = activeGuilds.map(g => g.guildId);

        // Fetch verified active accounts
        const verified = await RobloxVerify.findAll({ where: { status: 'VERIFIED', isActive: true } });
        if (verified.length === 0) return;

        // Group by user's mutual guilds that have presence enabled
        const trackingUsers = [];
        for (const record of verified) {
            let shouldTrack = false;
            for (const guildId of activeGuildIds) {
                const guild = client.guilds.cache.get(guildId);
                if (guild && guild.members.cache.has(record.userId)) {
                    shouldTrack = true;
                    break;
                }
            }
            if (shouldTrack) {
                trackingUsers.push(record);
            }
        }

        if (trackingUsers.length === 0) return;

        const robloxIds = trackingUsers.map(u => parseInt(u.robloxId, 10)).filter(id => !isNaN(id));
        if (robloxIds.length === 0) return;

        const response = await axios.post('https://presence.roblox.com/v1/presence/users', {
            userIds: robloxIds
        }, {
            headers: { 'Content-Type': 'application/json' }
        }).catch(() => null);

        if (!response || !response.data || !response.data.userPresences) return;

        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        for (const presence of response.data.userPresences) {
            const robloxId = presence.userId.toString();
            const record = trackingUsers.find(u => u.robloxId === robloxId);
            if (!record) continue;

            if (presence.userPresenceType === 2 && presence.gameId && presence.placeId) {
                const gameId = presence.gameId;
                const placeId = presence.placeId;
                const username = presence.lastUserName || `User_${robloxId}`;

                const sessionInfo = {
                    userId: record.userId,
                    robloxId,
                    username,
                    placeId,
                    gameId,
                    lastSeen: Date.now()
                };
                global.liveRobloxSessions.set(robloxId, sessionInfo);

                if (lastSeenSession.get(robloxId) === gameId) continue;
                lastSeenSession.set(robloxId, gameId);

                for (const guildId of activeGuildIds) {
                    const guild = client.guilds.cache.get(guildId);
                    if (!guild || !guild.members.cache.has(record.userId)) continue;

                    const settings = activeGuilds.find(g => g.guildId === guildId);
                    if (!settings) continue;

                    let channel = guild.systemChannel || guild.channels.cache.find(c => c.name.includes('general') || c.name.includes('chat'));
                    if (!channel) continue;

                    const embed = new EmbedBuilder()
                        .setTitle('🎮 Roblox Join Alert!')
                        .setDescription(`**${username}** is now in-game! Click below to join their session instantly.`)
                        .addFields(
                            { name: 'Game ID', value: `\`${placeId}\``, inline: true },
                            { name: 'Discord User', value: `<@${record.userId}>`, inline: true }
                        )
                        .setColor(0x00b4d8)
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Join via Web')
                            .setURL(`https://www.roblox.com/games/start?placeId=${placeId}&mainPlaceId=${placeId}&gameInstanceId=${gameId}`)
                            .setStyle(ButtonStyle.Link),
                        new ButtonBuilder()
                            .setLabel('Join via App (Deep-link)')
                            .setURL(`https://roblox.com/navigation/game?placeId=${placeId}&gameId=${gameId}`)
                            .setStyle(ButtonStyle.Link)
                    );

                    await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
                }
            } else {
                global.liveRobloxSessions.delete(robloxId);
            }
        }
    } catch (err) {
        console.error('[Roblox System] Presence tracking error:', err.message);
    }
}

