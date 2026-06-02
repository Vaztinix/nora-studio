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

        // Fetch members to calculate real joins
        let membersList = [];
        try {
            const fetched = await guild.members.fetch();
            membersList = Array.from(fetched.values());
        } catch (e) {
            membersList = Array.from(guild.members.cache.values());
        }

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

        res.json({
            totalMembers: guild.memberCount,
            totalNoraUsers,
            totalVotes: levels.reduce((sum, r) => sum + (r.voteCount || 0), 0),
            totalTextActivity,
            totalVoiceActivity: Math.floor(totalTextActivity * 0.35),
            avgTextActivity,
            avgVoiceActivity: Math.floor(avgTextActivity * 0.35),
            activeVoiceUsers,
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
 * POST /api/guilds/:guildId/topgg/link-bot
 * Verify bot ownership on Top.gg and link it to this guild.
 */
router.post('/topgg/link-bot', async (req, res) => {
    try {
        const { guildId } = req.params;
        const { botId, legacyOwnerId } = req.body;
        
        if (!botId) {
            return res.status(400).json({ error: 'botId is required' });
        }
        const trimmedBotId = botId.toString().trim();
        const trimmedLegacyOwnerId = legacyOwnerId ? legacyOwnerId.toString().trim() : '';

        // Retrieve token from Authorization header to know who the user is
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        
        // Fetch user info from Discord API using axios
        const axios = require('axios');
        const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${token}` }
        }).catch(() => null);
        if (!userRes) return res.status(401).json({ error: 'Invalid Discord token' });
        const user = userRes.data;

        // 1. Fetch bot details from Top.gg API using axios
        const NORA_V0 = 'process.env.TOPGG_TOKEN || process.env.NORA_V0 || ''';
        const topggRes = await axios.get(`https://top.gg/api/bots/${trimmedBotId}`, {
            headers: { Authorization: NORA_V0 }
        }).catch(() => null);

        if (!topggRes) {
            return res.status(400).json({ error: 'Bot not found on Top.gg.' });
        }

        const botData = topggRes.data;
        const owners = botData.owners || [];

        // Verify if user.id is in owners, or legacyOwnerId matches, or verification code exists in description
        let isOwner = owners.includes(user.id);
        
        if (!isOwner && trimmedLegacyOwnerId) {
            isOwner = owners.includes(trimmedLegacyOwnerId);
        }

        // If not in owners list directly, check short description for the verification code
        if (!isOwner) {
            const expectedCode = `NORA-${guildId.slice(-4)}-${(trimmedLegacyOwnerId || user.id).slice(-4)}`.toUpperCase();
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
        settings.topggBotId = trimmedBotId;
        if (trimmedLegacyOwnerId) {
            settings.topggLegacyOwnerId = trimmedLegacyOwnerId;
        }
        await settings.save();

        res.json({ success: true, settings });
    } catch (e) {
        console.error('Error linking Top.gg bot:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/webhook-send
 * Send a broadcast announcement using a Discord Webhook.
 */
router.post('/webhook-send', async (req, res) => {
    try {
        const { guildId } = req.params;
        const { channelId, name, avatar, content, embedTitle, embedDesc, embedColor, embedImage, components } = req.body;

        if (!channelId) return res.status(400).json({ error: 'Missing channelId' });

        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found by bot.' });

        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(404).json({ error: 'Channel not found in this guild.' });

        if (!channel.isTextBased()) return res.status(400).json({ error: 'Selected channel is not a text-based channel.' });

        const botMember = guild.members.me || await guild.members.fetch(req.client.user.id).catch(() => null);
        if (!botMember) return res.status(500).json({ error: 'Failed to fetch bot member context.' });

        // Check view channel and manage webhooks permission
        const canView = channel.permissionsFor(botMember)?.has('ViewChannel');
        const canManageWebhooks = channel.permissionsFor(botMember)?.has('ManageWebhooks');

        if (!canView) {
            return res.status(403).json({ error: 'Nora does not have permission to view the selected channel.' });
        }
        if (!canManageWebhooks) {
            return res.status(403).json({ error: 'Nora does not have "Manage Webhooks" permission in the selected channel.' });
        }

        // Get or create webhook
        const webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find(wh => wh.owner.id === req.client.user.id);
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: name || 'Nora Broadcast',
                avatar: avatar || null,
                reason: 'Nora Broadcast Webhook Builder'
            });
        }

        // Build embeds
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const embeds = [];
        if (embedTitle || embedDesc || embedImage) {
            const embed = new EmbedBuilder();
            if (embedTitle) embed.setTitle(embedTitle);
            if (embedDesc) embed.setDescription(embedDesc);
            if (embedColor) {
                try {
                    embed.setColor(embedColor);
                } catch (_) {
                    embed.setColor('#aeefff');
                }
            } else {
                embed.setColor('#aeefff');
            }
            if (embedImage) embed.setImage(embedImage);
            embeds.push(embed);
        }

        // Build components (buttons)
        const messageComponents = [];
        if (components && Array.isArray(components) && components.length > 0) {
            const row = new ActionRowBuilder();
            components.forEach((btn, index) => {
                const button = new ButtonBuilder();
                if (btn.label) button.setLabel(btn.label);

                let style = ButtonStyle.Primary;
                if (btn.style === 'SUCCESS') style = ButtonStyle.Success;
                else if (btn.style === 'DANGER') style = ButtonStyle.Danger;
                else if (btn.style === 'SECONDARY') style = ButtonStyle.Secondary;
                else if (btn.style === 'LINK') style = ButtonStyle.Link;

                const isUrl = btn.url && (btn.url.startsWith('http://') || btn.url.startsWith('https://'));
                if (isUrl) {
                    button.setStyle(ButtonStyle.Link);
                    button.setURL(btn.url);
                } else {
                    button.setStyle(style === ButtonStyle.Link ? ButtonStyle.Primary : style);
                    button.setCustomId(`broadcast_btn_${index}_${Date.now()}`);
                }
                row.addComponents(button);
            });
            messageComponents.push(row);
        }

        // Send via webhook
        const sendPayload = {
            content: content || undefined,
            embeds,
            components: messageComponents
        };

        if (name) sendPayload.username = name;
        if (avatar) sendPayload.avatarURL = avatar;

        await webhook.send(sendPayload);

        res.json({ success: true });
    } catch (e) {
        console.error('Error sending broadcast:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/topgg/test
 * Triggers a test vote announcement message using the current configurations.
 */
router.post('/topgg/test', async (req, res) => {
    try {
        const { guildId } = req.params;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found by bot.' });

        const GuildSettings = require('../../database/models/GuildSettings');
        const settings = await GuildSettings.findOne({ where: { guildId } });
        if (!settings) return res.status(404).json({ error: 'Settings not found.' });

        if (!settings.topggVoteChannelId) {
            return res.status(400).json({ error: 'No notification channel selected. Please configure one first.' });
        }

        const channel = guild.channels.cache.get(settings.topggVoteChannelId);
        if (!channel) {
            return res.status(404).json({ error: 'Configured notification channel not found.' });
        }

        // Get user details from authorization token
        const authHeader = req.headers.authorization;
        let testUser = req.client.user;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const axios = require('axios');
            const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${token}` }
            }).catch(() => null);
            if (userRes && userRes.data) {
                const userData = userRes.data;
                testUser = await req.client.users.fetch(userData.id).catch(() => req.client.user);
            }
        }

        // Send simulated vote
        const { sendVoteNotification } = require('../../utils/topggWebhookHandler');
        await sendVoteNotification(guild, settings, testUser.id, true);

        res.json({ success: true });
    } catch (e) {
        console.error('Error sending Top.gg test vote:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
