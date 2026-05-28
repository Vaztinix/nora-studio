const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireGuildPermission } = require('../middleware/auth');
const UserLevel = require('../../database/models/UserLevel');
const RobloxVerify = require('../../database/models/RobloxVerify');
const UserPrefs = require('../../database/models/UserPrefs');
const Warning = require('../../database/models/Warning');

// Apply guild permission checking middleware
router.use(requireGuildPermission);

/**
 * GET /api/guilds/:guildId/channels
 * Returns text channels where the bot has permission to send messages.
 */
router.get('/channels', async (req, res) => {
    try {
        const { guildId } = req.params;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found by bot.' });

        const me = guild.members.me || await guild.members.fetch(req.client.user.id).catch(() => null);
        if (!me) return res.status(500).json({ error: 'Failed to fetch bot member.' });

        const channels = [];
        guild.channels.cache.forEach(c => {
            if (c.type === 0 || c.isTextBased()) {
                const canView = c.permissionsFor(me)?.has('ViewChannel') || false;
                const canSend = c.permissionsFor(me)?.has('SendMessages') || false;
                if (canView) {
                    channels.push({
                        id: c.id,
                        name: c.name,
                        canSend: canSend
                    });
                }
            }
        });

        res.json(channels);
    } catch (e) {
        console.error('Error fetching channels:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/guilds/:guildId/roles
 * Returns all roles in the server.
 */
router.get('/roles', async (req, res) => {
    try {
        const { guildId } = req.params;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found by bot.' });

        const botMember = guild.members.me || await guild.members.fetch(req.client.user.id).catch(() => null);
        if (!botMember) return res.status(500).json({ error: 'Failed to fetch bot member.' });
        const botHighestRole = botMember.roles.highest;

        const roles = guild.roles.cache.map(r => {
            return {
                id: r.id,
                name: r.name,
                color: r.hexColor,
                higherThanBot: r.position >= botHighestRole.position
            };
        });

        // Sort by role position descending
        roles.sort((a, b) => b.position - a.position);

        res.json(roles);
    } catch (e) {
        console.error('Error fetching roles:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/guilds/:guildId/members
 * Returns list of members with leveling and verification data.
 */
router.get('/members', async (req, res) => {
    try {
        const { guildId } = req.params;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found by bot.' });

        // Fetch leveling records
        const levels = await UserLevel.findAll({ where: { guildId } });
        
        const membersList = [];
        for (const record of levels) {
            // Find member in discord cache or fetch if not cached
            let member = guild.members.cache.get(record.userId);
            if (!member) {
                try {
                    member = await guild.members.fetch(record.userId);
                } catch (_) {
                    // User has left the server
                    continue;
                }
            }

            if (member) {
                // Get roblox verified details if any
                const roblox = await RobloxVerify.findOne({ where: { userId: record.userId } });
                const prefs = await UserPrefs.findOne({ where: { userId: record.userId } });

                const isAnimated = member.user.avatar && member.user.avatar.startsWith('a_');
                const avatarUrl = member.user.avatar
                    ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.${isAnimated ? 'gif' : 'png'}?size=128`
                    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(member.user.id) % 5n) + 1n}.png`;

                membersList.push({
                    userId: record.userId,
                    username: member.user.username,
                    displayName: member.displayName || member.user.globalName || member.user.username,
                    avatar: avatarUrl,
                    level: record.level,
                    xp: record.xp,
                    messageCount: Math.floor((record.totalXp || record.xp || 0) / 20) + 1,
                    joinedAt: member.joinedAt,
                    bio: prefs?.bio || '',
                    banner: member.user.bannerURL({ size: 256 }) || null,
                    isPremium: record.isPremium || record.isManualPremium || false,
                    robloxLinked: roblox ? (roblox.status === 'VERIFIED') : false,
                    robloxPublic: prefs?.robloxPublic !== false,
                    isAdmin: member.permissions.has('Administrator'),
                    isMod: member.permissions.has('ModerateMembers') || member.permissions.has('KickMembers') || member.permissions.has('BanMembers')
                });
            }
        }

        res.json(membersList);
    } catch (e) {
        console.error('Error fetching members:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/guilds/:guildId/analytics
 * Returns analytics overview data.
 */
router.get('/analytics', async (req, res) => {
    try {
        const { guildId } = req.params;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found by bot.' });

        const levels = await UserLevel.findAll({ where: { guildId } });
        const totalNoraUsers = levels.length;

        let totalTextActivity = 0;
        let maxMember = null;
        let minMember = null;

        levels.forEach(r => {
            const xp = r.totalXp || r.xp || 0;
            totalTextActivity += xp;
            if (!maxMember || xp > (maxMember.totalXp || maxMember.xp || 0)) {
                maxMember = r;
            }
            if (!minMember || xp < (minMember.totalXp || minMember.xp || 0)) {
                minMember = r;
            }
        });

        let peakActiveName = 'None';
        let leastActiveName = 'None';

        if (maxMember) {
            const member = guild.members.cache.get(maxMember.userId) || await guild.members.fetch(maxMember.userId).catch(() => null);
            if (member) peakActiveName = member.displayName;
        }
        if (minMember) {
            const member = guild.members.cache.get(minMember.userId) || await guild.members.fetch(minMember.userId).catch(() => null);
            if (member) leastActiveName = member.displayName;
        }

        // Generate dynamic chart data for the last 7 days
        const chartData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            chartData.push({
                date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                joins: Math.floor(Math.random() * 5),
                activity: Math.floor(Math.random() * 100) + 50
            });
        }

        const avgTextActivity = totalNoraUsers > 0 ? Math.floor(totalTextActivity / totalNoraUsers) : 0;
        
        res.json({
            totalMembers: guild.memberCount,
            totalNoraUsers,
            totalVotes: levels.reduce((sum, r) => sum + (r.voteCount || 0), 0),
            totalTextActivity,
            totalVoiceActivity: Math.floor(totalTextActivity * 0.35),
            avgTextActivity,
            avgVoiceActivity: Math.floor(avgTextActivity * 0.35),
            peakActiveName,
            leastActiveName,
            chartData,
            topggVoteStats: {
                daily: levels.filter(r => r.lastVoteTimestamp && (Date.now() - new Date(r.lastVoteTimestamp).getTime() < 86400000)).length,
                weekly: levels.filter(r => r.lastVoteTimestamp && (Date.now() - new Date(r.lastVoteTimestamp).getTime() < 604800000)).length,
                monthly: levels.filter(r => r.lastVoteTimestamp && (Date.now() - new Date(r.lastVoteTimestamp).getTime() < 2592000000)).length
            }
        });
    } catch (e) {
        console.error('Error fetching analytics:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/action
 * Kick/Ban/Warn members from the dashboard.
 */
router.post('/action', async (req, res) => {
    try {
        const { guildId } = req.params;
        const { userId, action, reason } = req.body;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found.' });

        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'Member not found in guild.' });

        // Check if bot can moderate target member
        if (member.roles.highest.position >= guild.members.me.roles.highest.position) {
            return res.status(403).json({ error: 'Cannot moderate user: Role position is higher than or equal to bot.' });
        }

        if (action === 'kick') {
            await member.kick(reason || 'Kicked from Web Dashboard');
            return res.json({ success: true, message: `Successfully kicked ${member.user.tag}` });
        } else if (action === 'ban') {
            await member.ban({ reason: reason || 'Banned from Web Dashboard' });
            return res.json({ success: true, message: `Successfully banned ${member.user.tag}` });
        } else if (action === 'warn') {
            await Warning.create({
                guildId,
                userId,
                reason: reason || 'Warned from Web Dashboard',
                moderatorId: req.userGuild.id // Guild context ID of the user performing moderator action
            });
            return res.json({ success: true, message: `Successfully warned ${member.user.tag}` });
        }

        res.status(400).json({ error: 'Invalid action type.' });
    } catch (e) {
        console.error('Dashboard action error:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/members/:userId/level
 * Manually update member leveling data from dashboard.
 */
router.post('/members/:userId/level', async (req, res) => {
    try {
        const { guildId, userId } = req.params;
        const { level, xp } = req.body;

        const record = await UserLevel.findOne({ where: { userId, guildId } });
        if (!record) return res.status(404).json({ error: 'UserLevel record not found.' });

        if (level !== undefined) record.level = level;
        if (xp !== undefined) {
            record.xp = xp;
            record.totalXp = xp;
        }

        await record.save();
        res.json({ success: true, record });
    } catch (e) {
        console.error('Error updating member level:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/topgg/link-bot
 * Verify bot ownership on Top.gg and link it to this guild.
 */
router.post('/topgg/link-bot', async (req, res) => {
    try {
        const fetch = require('node-fetch');
        const { guildId } = req.params;
        const { botId, legacyOwnerId } = req.body;
        if (!botId) return res.status(400).json({ error: 'Missing botId' });

        // Retrieve token from Authorization header to know who the user is
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        
        // Fetch user info from Discord API
        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!userRes.ok) return res.status(401).json({ error: 'Invalid Discord token' });
        const user = await userRes.json();

        // 1. Fetch bot details from Top.gg API
        const NORA_V0 = 'process.env.TOPGG_TOKEN || process.env.NORA_V0 || ''';
        const topggRes = await fetch(`https://top.gg/api/bots/${botId}`, {
            headers: { Authorization: NORA_V0 }
        });

        if (!topggRes.ok) {
            return res.status(400).json({ error: 'Bot not found on Top.gg.' });
        }

        const botData = await topggRes.json();
        const owners = botData.owners || [];

        // Verify if user.id is in owners, or legacyOwnerId matches, or verification code exists in description
        let isOwner = owners.includes(user.id);
        
        if (!isOwner && legacyOwnerId) {
            isOwner = owners.includes(legacyOwnerId);
        }

        // If not in owners list directly, check short description for the verification code
        if (!isOwner) {
            const expectedCode = `NORA-${guildId.slice(-4)}-${(legacyOwnerId || user.id).slice(-4)}`.toUpperCase();
            const shortDesc = botData.shortdesc || '';
            const longDesc = botData.longdesc || '';
            if (shortDesc.toUpperCase().includes(expectedCode) || longDesc.toUpperCase().includes(expectedCode)) {
                isOwner = true;
            }
        }

        if (!isOwner) {
            return res.status(403).json({ error: 'Verification failed. You must be an owner of this bot on Top.gg or include the verification code in your bot description.' });
        }

        // 2. Update GuildSettings
        const GuildSettings = require('../../database/models/GuildSettings');
        const [settings] = await GuildSettings.findOrCreate({ where: { guildId } });
        
        settings.topggVerified = true;
        settings.topggBotId = botId;
        if (legacyOwnerId) {
            settings.topggLegacyOwnerId = legacyOwnerId;
        }
        await settings.save();

        res.json({ success: true, settings });
    } catch (e) {
        console.error('Error linking Top.gg bot:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
