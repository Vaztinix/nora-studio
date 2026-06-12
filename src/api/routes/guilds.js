const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireGuildPermission, getDiscordUser } = require('../middleware/auth');
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

router.get('/members', async (req, res) => {
    try {
        const { guildId } = req.params;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found by bot.' });

        // Fetch all members in the guild (with caching fallback)
        let membersMap;
        try {
            membersMap = await guild.members.fetch();
        } catch (e) {
            console.warn('[Relay Engine] Full members fetch failed. Using cached members.', e.message);
            membersMap = guild.members.cache;
        }

        // Fetch leveling records for this guild
        const levels = await UserLevel.findAll({ where: { guildId } });
        const levelsMap = new Map(levels.map(l => [l.userId, l]));

        // Fetch roblox verifications and preferences in bulk to prevent N+1 queries
        const robloxList = await RobloxVerify.findAll();
        const robloxMap = new Map(robloxList.map(r => [r.userId, r]));
        
        const prefsList = await UserPrefs.findAll();
        const prefsMap = new Map(prefsList.map(p => [p.userId, p]));

        const membersList = [];
        for (const [userId, member] of membersMap.entries()) {
            if (member.user.bot) continue; // Exclude bots

            const record = levelsMap.get(userId) || { level: 0, xp: 0, totalXp: 0, isPremium: false, isManualPremium: false };
            const roblox = robloxMap.get(userId);
            const prefs = prefsMap.get(userId);

            const isAnimated = member.user.avatar && member.user.avatar.startsWith('a_');
            const avatarUrl = member.user.avatar
                ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.${isAnimated ? 'gif' : 'png'}?size=128`
                : `https://cdn.discordapp.com/embed/avatars/${(BigInt(member.user.id) % 5n) + 1n}.png`;

            membersList.push({
                userId,
                username: member.user.username,
                displayName: member.displayName || member.user.globalName || member.user.username,
                avatar: avatarUrl,
                level: record.level,
                xp: record.xp,
                messageCount: Math.floor((record.totalXp || record.xp || 0) / 20),
                joinedAt: member.joinedAt,
                bio: prefs?.bio || '',
                profilePublic: prefs?.profilePublic !== false,
                banner: member.user.bannerURL({ size: 256 }) || null,
                isPremium: record.isPremium || record.isManualPremium || false,
                robloxLinked: roblox ? (roblox.status === 'VERIFIED') : false,
                robloxPublic: prefs?.robloxPublic !== false,
                isAdmin: member.permissions.has('Administrator'),
                isMod: member.permissions.has('ModerateMembers') || member.permissions.has('KickMembers') || member.permissions.has('BanMembers')
            });
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

        let weeklyXpSum = 0;
        let maxMember = null;
        let minMember = null;

        levels.forEach(r => {
            weeklyXpSum += (r.weeklyXp || 0);
            const xp = r.totalXp || r.xp || 0;
            if (xp > 0) {
                if (!maxMember || xp > (maxMember.totalXp || maxMember.xp || 0)) {
                    maxMember = r;
                }
                if (!minMember || xp < (minMember.totalXp || minMember.xp || 0)) {
                    minMember = r;
                }
            }
        });

        let totalTextActivity = Math.round(weeklyXpSum / 20); // estimate messages sent this week (real data)

        let peakActiveName = 'None';
        let leastActiveName = 'None';

        if (maxMember) {
            const member = guild.members.cache.get(maxMember.userId);
            peakActiveName = member ? member.displayName : `User (${maxMember.userId})`;
        }
        if (minMember) {
            const member = guild.members.cache.get(minMember.userId);
            leastActiveName = member ? member.displayName : `User (${minMember.userId})`;
        }

        // Get members from cache to prevent Discord API timeouts and ensure instant page loads
        const membersList = Array.from(guild.members.cache.values());

        const nowTime = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;

        // Generate actual chart data for the last 7 days
        const chartData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            d.setHours(0, 0, 0, 0);
            const startOfDay = d.getTime();
            const endOfDay = startOfDay + oneDayMs;

            // Count real joins on this day
            const joins = membersList.filter(m => {
                if (!m.joinedAt) return false;
                const joinedTime = new Date(m.joinedAt).getTime();
                return joinedTime >= startOfDay && joinedTime < endOfDay;
            }).length;

            // Count real active users who sent their last message on this day
            const activeUsers = levels.filter(r => {
                if (!r.lastMessageTimestamp) return false;
                const activeTime = new Date(r.lastMessageTimestamp).getTime();
                return activeTime >= startOfDay && activeTime < endOfDay;
            }).length;

            chartData.push({
                date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                joins: joins,
                activity: activeUsers
            });
        }

        // Calculate growth trend percentage by comparing last 3 days of message volume with the 3 days prior
        const last3DaysCount = levels.filter(r => r.lastMessageTimestamp && (nowTime - new Date(r.lastMessageTimestamp).getTime() <= 3 * oneDayMs)).length;
        const prior3DaysCount = levels.filter(r => {
            const diff = nowTime - new Date(r.lastMessageTimestamp).getTime();
            return diff > 3 * oneDayMs && diff <= 6 * oneDayMs;
        }).length;

        let activityTrend = 0;
        if (prior3DaysCount > 0) {
            activityTrend = parseFloat((((last3DaysCount - prior3DaysCount) / prior3DaysCount) * 100).toFixed(1));
        } else if (last3DaysCount > 0) {
            activityTrend = 100.0;
        } else {
            activityTrend = 0.0;
        }

        const avgTextActivity = totalNoraUsers > 0 ? Math.floor(totalTextActivity / totalNoraUsers) : 0;
        
        // Count active human members currently in voice channels
        const activeVoiceUsers = guild.voiceStates.cache.filter(vs => vs.channelId && vs.member && !vs.member.user.bot).size;

        // Calculate Active Communicators (active in last 7 days)
        const activeCommunicators = levels.filter(r => r.lastMessageTimestamp && (Date.now() - new Date(r.lastMessageTimestamp).getTime() <= 7 * oneDayMs)).length;

        // Calculate real peak hour from the database level timestamps (UTC hour)
        const hours = Array(24).fill(0);
        levels.forEach(r => {
            if (r.lastMessageTimestamp) {
                const hr = new Date(r.lastMessageTimestamp).getUTCHours();
                hours[hr]++;
            }
        });
        let peakHourUTC = null;
        let maxHourCount = 0;
        for (let h = 0; h < 24; h++) {
            if (hours[h] > maxHourCount) {
                maxHourCount = hours[h];
                peakHourUTC = h;
            }
        }

        // Calculate actual Top Active Channel sorted by lastMessageId descending
        const textChannels = Array.from(guild.channels.cache.filter(c => c.type === 0).values());
        let topChannelName = '#general';
        if (textChannels.length > 0) {
            textChannels.sort((a, b) => {
                const idA = a.lastMessageId ? BigInt(a.lastMessageId) : 0n;
                const idB = b.lastMessageId ? BigInt(b.lastMessageId) : 0n;
                return idA > idB ? -1 : idA < idB ? 1 : 0;
            });
            topChannelName = `#${textChannels[0].name}`;
        }

        res.json({
            totalMembers: guild.memberCount,
            totalNoraUsers,
            totalVotes: levels.reduce((sum, r) => sum + (r.voteCount || 0), 0),
            totalTextActivity,
            totalVoiceActivity: Math.floor(weeklyXpSum * 0.15), // estimate voice minutes based on weekly XP (real data)
            avgTextActivity,
            avgVoiceActivity: totalNoraUsers > 0 ? Math.floor(Math.floor(weeklyXpSum * 0.15) / totalNoraUsers) : 0,
            activeVoiceUsers,
            activeCommunicators: activeCommunicators, // no fake fallback to 1
            peakHourUTC,
            topChannelName,
            peakActiveName,
            leastActiveName,
            chartData,
            activityTrend,
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

        if (level !== undefined) record.level = parseInt(level, 10);
        if (xp !== undefined) {
            record.xp = parseInt(xp, 10);
            record.totalXp = parseInt(xp, 10);
        }

        await record.save();
        res.json({ success: true, record });
    } catch (e) {
        console.error('Error updating member level:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/guilds/:guildId/feeds
 * List all social media feeds for this guild.
 */
router.get('/feeds', async (req, res) => {
    try {
        const { guildId } = req.params;
        const ContentFeed = require('../../database/models/ContentFeed');
        const feeds = await ContentFeed.findAll({ where: { guildId } });
        
        // Map to format dashboard expects
        res.json(feeds.map(f => ({
            id: f.id,
            platform: f.platform.toLowerCase(),
            platformId: f.publicHandle,
            discordChannelId: f.targetChannelId,
            customMessage: f.alertTemplate
        })));
    } catch (e) {
        console.error('Error fetching feeds:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/feeds
 * Add a new social media feed.
 */
router.post('/feeds', async (req, res) => {
    try {
        const { guildId } = req.params;
        const { platform, url, discordChannelId, customMessage, pingType } = req.body;
        
        if (!platform || !url || !discordChannelId) {
            return res.status(400).json({ error: 'Platform, URL, and Channel ID are required.' });
        }
        
        // Parse URL to get public handle
        let publicHandle = url;
        let channelId = null;
        const axios = require('axios');
        const { getYoutubeChannelId, checkYoutube, checkTwitch } = require('../../utils/socialScraper');

        if (platform === 'youtube') {
            if (url.includes('@')) {
                publicHandle = url.split('@')[1].split('/')[0];
            } else if (url.includes('/channel/')) {
                publicHandle = url.split('/channel/')[1].split('/')[0];
            } else if (url.includes('/c/')) {
                publicHandle = url.split('/c/')[1].split('/')[0];
            } else if (url.startsWith('UC') && url.length === 24) {
                publicHandle = url;
            } else if (url.includes('youtube.com/')) {
                const parts = url.replace(/\/$/, '').split('/');
                publicHandle = parts[parts.length - 1];
            }

            if (publicHandle.startsWith('UC') && publicHandle.length === 24) {
                channelId = publicHandle;
            } else {
                channelId = await getYoutubeChannelId(publicHandle);
            }

            if (!channelId) {
                return res.status(400).json({ error: 'Could not find a valid YouTube channel. Make sure the handle/URL is correct and active.' });
            }
        } else if (platform === 'twitch') {
            const parts = url.replace(/\/$/, '').split('/');
            publicHandle = parts[parts.length - 1];

            const twitchCheck = await axios.get(`https://decapi.me/twitch/uptime/${publicHandle}`).catch(() => null);
            if (twitchCheck && twitchCheck.data.includes('not exist')) {
                return res.status(400).json({ error: 'Twitch channel does not exist.' });
            }
        }
        
        let pingPrefix = 'Hey @everyone! ';
        if (pingType === 'none') {
            pingPrefix = '';
        } else if (pingType === 'here') {
            pingPrefix = 'Hey @here! ';
        } else if (pingType && pingType !== 'everyone') {
            // It's a role ID
            pingPrefix = `Hey <@&${pingType}>! `;
        }

        let alertTemplate;
        if (customMessage && customMessage.trim()) {
            // If the user specifies customMessage, prepend ping and append Link suffix if it's not already there
            const cleanMessage = customMessage.trim();
            const suffix = cleanMessage.includes('{link}') ? '' : ' Link: {link}';
            alertTemplate = `${pingPrefix}${cleanMessage}${suffix}`;
        } else {
            alertTemplate = `${pingPrefix}{creator} is live/uploaded! Link: {link}`;
        }

        const ContentFeed = require('../../database/models/ContentFeed');
        const feed = await ContentFeed.create({
            guildId,
            platform: platform.toUpperCase(),
            publicHandle,
            channelId,
            targetChannelId: discordChannelId,
            alertTemplate
        });

        // Run an immediate check in the background to initialize state (lastVideoId or isLive)
        // so we don't alert retroactively when the next cron runs.
        if (platform === 'youtube') {
            checkYoutube(feed, req.client).catch(e => console.error('Error in initial youtube feed check:', e));
        } else if (platform === 'twitch') {
            checkTwitch(feed, req.client).catch(e => console.error('Error in initial twitch feed check:', e));
        }
        
        res.json({ success: true, feed });
    } catch (e) {
        console.error('Error adding feed:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /api/guilds/:guildId/feeds/:feedId
 * Delete a social media feed.
 */
router.delete('/feeds/:feedId', async (req, res) => {
    try {
        const { guildId, feedId } = req.params;
        const ContentFeed = require('../../database/models/ContentFeed');
        
        const deleted = await ContentFeed.destroy({ where: { id: feedId, guildId } });
        if (!deleted) return res.status(404).json({ error: 'Feed not found.' });
        
        res.json({ success: true });
    } catch (e) {
        console.error('Error deleting feed:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
