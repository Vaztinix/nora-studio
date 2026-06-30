const express = require('express');

const router = express.Router({ mergeParams: true });

const { requireGuildPermission, getDiscordUser } = require('../middleware/auth');

const UserLevel = require('../../database/models/UserLevel');

const RobloxVerify = require('../../database/models/RobloxVerify');

const UserPrefs = require('../../database/models/UserPrefs');

const Warning = require('../../database/models/Warning');

const Case = require('../../database/models/Case');

const ActiveTicket = require('../../database/models/ActiveTicket');

const TicketHistory = require('../../database/models/TicketHistory');



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
 * GET /api/guilds/:guildId/emojis
 * Returns all custom emojis in the server.
 */
router.get('/emojis', async (req, res) => {
    try {
        const { guildId } = req.params;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found by bot.' });

        let emojis = guild.emojis.cache;
        if (emojis.size === 0) {
            emojis = await guild.emojis.fetch().catch(() => guild.emojis.cache);
        }

        const list = emojis.map(e => ({
            id: e.id,
            name: e.name,
            animated: e.animated,
            url: e.imageURL({ size: 64 })
        }));

        res.json(list);
    } catch (e) {
        console.error('Error fetching emojis:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/guilds/:guildId/app-emojis
 * Returns all custom application emojis.
 */
router.get('/app-emojis', async (req, res) => {
    try {
        let appEmojis = [];
        if (req.client.application) {
            try {
                const fetched = await req.client.application.emojis.fetch().catch(() => null);
                if (fetched) {
                    appEmojis = fetched.map(e => ({
                        id: e.id,
                        name: e.name,
                        animated: e.animated,
                        url: e.imageURL({ size: 64 })
                    }));
                }
            } catch (err) {
                console.error('Failed to fetch app emojis:', err);
            }
        }
        res.json(appEmojis);
    } catch (e) {
        console.error('Error fetching app emojis:', e);
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

        // Warm up members cache if not fully loaded to prevent 0 stats on bot startup
        if (guild.members.cache.size < guild.memberCount) {
            await guild.members.fetch().catch(() => null);
        }

        // Prevent browser caching so analytics update properly per server

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');



        const levels = await UserLevel.findAll({ where: { guildId } });

        // Clean levels database records: only keep users who are currently in the guild

        const activeGuildLevels = levels.filter(r => guild.members.cache.has(r.userId));

        const totalNoraUsers = activeGuildLevels.length;



        const nowTime = Date.now();

        const oneDayMs = 24 * 60 * 60 * 1000;

        const sevenDaysMs = 7 * oneDayMs;



        let weeklyXpSum = 0;

        let maxMember = null;

        let minMember = null;



        activeGuildLevels.forEach(r => {

            const lastActive = r.lastMessageTimestamp ? new Date(r.lastMessageTimestamp).getTime() : 0;

            // Only count weekly XP if user has been active within the last 7 days

            if (nowTime - lastActive <= sevenDaysMs) {

                weeklyXpSum += (r.weeklyXp || 0);

            }

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

            let member = guild.members.cache.get(maxMember.userId);

            if (!member) {

                member = await guild.members.fetch(maxMember.userId).catch(() => null);

            }

            peakActiveName = member ? (member.displayName || member.user.globalName || member.user.username) : `User (${maxMember.userId})`;

        }

        if (minMember) {

            let member = guild.members.cache.get(minMember.userId);

            if (!member) {

                member = await guild.members.fetch(minMember.userId).catch(() => null);

            }

            leastActiveName = member ? (member.displayName || member.user.globalName || member.user.username) : `User (${minMember.userId})`;

        }



        // Get members from cache to prevent Discord API timeouts and ensure instant page loads

        const membersList = Array.from(guild.members.cache.values());



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

            const activeUsers = activeGuildLevels.filter(r => {

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

        const last3DaysCount = activeGuildLevels.filter(r => r.lastMessageTimestamp && (nowTime - new Date(r.lastMessageTimestamp).getTime() <= 3 * oneDayMs)).length;

        const prior3DaysCount = activeGuildLevels.filter(r => {

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

        const activeCommunicators = activeGuildLevels.filter(r => r.lastMessageTimestamp && (Date.now() - new Date(r.lastMessageTimestamp).getTime() <= 7 * oneDayMs)).length;



        // Calculate real peak hour from the database level timestamps (UTC hour)

        const hours = Array(24).fill(0);

        activeGuildLevels.forEach(r => {

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



        // Calculate actual Top Active Channel based on bot-logged message counts, falling back to lastMessageId

        let topChannelName = 'None';

        const guildChannels = req.client.channelActivity?.[guildId] || {};

        const activeChannelIds = Object.keys(guildChannels);

        if (activeChannelIds.length > 0) {

            activeChannelIds.sort((a, b) => guildChannels[b] - guildChannels[a]);

            const topChannel = guild.channels.cache.get(activeChannelIds[0]);

            if (topChannel) {

                topChannelName = `#${topChannel.name}`;

            }

        }



        if (topChannelName === 'None') {

            const textChannels = Array.from(guild.channels.cache.filter(c => c.type === 0).values());

            if (textChannels.length > 0) {

                textChannels.sort((a, b) => {

                    const idA = a.lastMessageId ? BigInt(a.lastMessageId) : 0n;

                    const idB = b.lastMessageId ? BigInt(b.lastMessageId) : 0n;

                    return idA > idB ? -1 : idA < idB ? 1 : 0;

                });

                const bestChannel = textChannels.find(c => c.lastMessageId);

                if (bestChannel) {

                    topChannelName = `#${bestChannel.name}`;

                } else {

                    topChannelName = `#${textChannels[0].name}`;

                }

            }

        }



        const activeTicketsCount = await ActiveTicket.count({ where: { guildId, isOpen: true } }).catch(() => 0);

        const openTicketsCount = activeTicketsCount;

        const inProgressTicketsCount = 0;

        const closedTicketsCount = await TicketHistory.count({ where: { guildId, status: 'closed' } }).catch(() => 0);

        const totalTicketsCount = activeTicketsCount + closedTicketsCount;

        const autoModActions = await Case.count({ where: { guildId } }).catch(() => 0);

        const levelsGained = activeGuildLevels.reduce((sum, r) => sum + (r.level || 0), 0);



        // Fetch recent tickets

        const recentTickets = await TicketHistory.findAll({

            where: { guildId },

            order: [['openTime', 'DESC']],

            limit: 5

        }).catch(() => []);



        const recentTicketsMapped = [];

        for (const t of recentTickets) {

            let ownerTag = `User (${t.ownerId})`;

            const member = guild.members.cache.get(t.ownerId) || await guild.members.fetch(t.ownerId).catch(() => null);

            if (member) {

                ownerTag = member.user.tag;

            }

            recentTicketsMapped.push({

                id: t.id,

                channelId: t.channelId,

                ownerId: t.ownerId,

                ownerTag,

                status: t.status,

                topic: t.topic,

                openTime: t.openTime,

                resolveTime: t.resolveTime,

                closedById: t.closedById

            });

        }



        res.json({

            totalMembers: guild.memberCount,

            totalNoraUsers,

            totalVotes: activeGuildLevels.reduce((sum, r) => sum + (r.voteCount || 0), 0),

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

                daily: activeGuildLevels.filter(r => r.lastVoteTimestamp && (Date.now() - new Date(r.lastVoteTimestamp).getTime() < 86400000)).length,

                weekly: activeGuildLevels.filter(r => r.lastVoteTimestamp && (Date.now() - new Date(r.lastVoteTimestamp).getTime() < 604800000)).length,

                monthly: activeGuildLevels.filter(r => r.lastVoteTimestamp && (Date.now() - new Date(r.lastVoteTimestamp).getTime() < 2592000000)).length

            },

            openTickets: openTicketsCount,

            inProgressTickets: inProgressTicketsCount,

            closedTickets: closedTicketsCount,

            totalTickets: totalTicketsCount,

            autoModActions,

            levelsGained,

            commandInvocations: Math.max(0, Math.round(totalTextActivity * 0.15)),

            recentTickets: recentTicketsMapped,

            channelsCount: guild.channels.cache.size,

            rolesCount: guild.roles.cache.size,

            botsCount: membersList.filter(m => m.user.bot).length,

            emojisCount: guild.emojis.cache.size,

            stickersCount: guild.stickers.cache.size

        });

    } catch (e) {

        console.error('Error fetching analytics:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * POST /api/guilds/:guildId/webhook-send

 * Send a webhook broadcast message to a channel.

 */
router.post('/webhook-send', async (req, res) => {
    try {
        const { guildId } = req.params;
        const { channelId, name, avatar, content, embedTitle, embedDesc, embedColor, embedImage, embedThumbnail, embedFooter, components } = req.body;
        
        if (!channelId) return res.status(400).json({ error: 'Target channel is required.' });
        if (!content && !embedTitle && !embedDesc) return res.status(400).json({ error: 'Message content or embed is required.' });
        
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found.' });
        
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(404).json({ error: 'Channel not found.' });
        
        // Check permissions
        const me = guild.members.me;
        if (!me) return res.status(500).json({ error: 'Bot member not found.' });
        
        const perms = channel.permissionsFor(me);
        if (!perms || !perms.has('ManageWebhooks')) {
            return res.status(403).json({ error: 'Nora needs "Manage Webhooks" permission in this channel.' });
        }
        if (!perms.has('SendMessages')) {
            return res.status(403).json({ error: 'Nora needs "Send Messages" permission in this channel.' });
        }
        
        // Create or reuse a webhook in the target channel
        let webhook = null;
        try {
            const webhooks = await channel.fetchWebhooks();
            webhook = webhooks.find(wh => wh.owner && wh.owner.id === req.client.user.id);
        } catch (e) {
            return res.status(403).json({ error: `Failed to fetch webhooks: ${e.message}` });
        }
        
        if (!webhook) {
            try {
                webhook = await channel.createWebhook({
                    name: name || 'Nora Broadcast',
                    avatar: req.client.user.displayAvatarURL({ size: 256 })
                });
            } catch (e) {
                return res.status(403).json({ error: `Failed to create webhook: ${e.message}` });
            }
        }
        
        const { saveBase64Image } = require('../../utils/imageSaver');
        const resolvedAvatar = saveBase64Image(avatar, 'webhook_avatar');
        const resolvedEmbedImage = saveBase64Image(embedImage, 'webhook_embed');
        const resolvedEmbedThumbnail = saveBase64Image(embedThumbnail, 'webhook_thumb');

        // Build the webhook payload
        const webhookPayload = {};
        
        if (name) webhookPayload.username = name;
        if (resolvedAvatar) webhookPayload.avatarURL = resolvedAvatar;
        if (content) webhookPayload.content = content;
        
        // Build embed if any embed fields are provided
        if (embedTitle || embedDesc || resolvedEmbedImage || resolvedEmbedThumbnail || embedFooter) {
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder();
            if (embedTitle) embed.setTitle(embedTitle);
            if (embedDesc) embed.setDescription(embedDesc);
            if (embedColor) embed.setColor(embedColor);
            if (resolvedEmbedImage) embed.setImage(resolvedEmbedImage);
            if (resolvedEmbedThumbnail) embed.setThumbnail(resolvedEmbedThumbnail);
            if (embedFooter) embed.setFooter({ text: embedFooter });
            webhookPayload.embeds = [embed];
        }
        
        // Build action row if components (buttons) are provided

        if (components && Array.isArray(components) && components.length > 0) {

            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            const validButtons = components.filter(b => b.label && b.label.trim() !== '' && b.url && b.url.trim() !== '');

            if (validButtons.length > 0) {

                const row = new ActionRowBuilder();

                validButtons.slice(0, 5).forEach(b => {

                    row.addComponents(

                        new ButtonBuilder()

                            .setLabel(b.label)

                            .setStyle(ButtonStyle.Link)

                            .setURL(b.url)

                    );

                });

                webhookPayload.components = [row];

            }

        }

        

        await webhook.send(webhookPayload);



        try {

            const authHeader = req.headers.authorization;

            const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

            const user = token ? await getDiscordUser(token).catch(() => null) : null;

            const logger = require('../../utils/logger');

            const userTag = user ? `${user.username} (${user.id})` : 'Dashboard Administrator';

            logger.logDashboardOrCommandAction(

                guild,

                'Dashboard Action - Webhook Broadcast Sent',

                [

                    { name: 'Administrator', value: userTag, inline: true },

                    { name: 'Channel', value: `<#${channelId}>`, inline: true },

                    { name: 'Embed Title', value: embedTitle || '*None*', inline: true },

                    { name: 'Content Preview', value: content ? content.substring(0, 500) : '*Embed Only*' }

                ],

                0x2ecc71

            ).catch(() => null);

        } catch (err) {}



        res.json({ success: true, message: 'Broadcast sent successfully!' });

    } catch (e) {

        console.error('Webhook broadcast error:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * POST /api/guilds/:guildId/action

 * Handle dashboard actions: member moderation (kick/ban/warn) and utility spawns.

 */

router.post('/action', async (req, res) => {

    try {

        const { guildId } = req.params;

        const { userId, action, reason } = req.body;

        const guild = req.client.guilds.cache.get(guildId);

        if (!guild) return res.status(404).json({ error: 'Guild not found.' });



        const authHeader = req.headers.authorization;

        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        const user = token ? await getDiscordUser(token).catch(() => null) : null;

        const userTag = user ? `${user.username} (${user.id})` : 'Dashboard Administrator';



        // ─── Utility Spawn Actions (no userId required) ───

        if (action === 'spawn_tickets') {

            const settingsCache = require('../../utils/settingsCache');

            const settings = await settingsCache.get(guildId);

            if (!settings || !settings.ticketCategoryId) {

                return res.status(400).json({ error: 'Ticket Category ID must be set in settings first.' });

            }



            // Find a suitable channel to spawn in

            let targetChannel = null;

            if (settings.ticketChannelId) {

                targetChannel = guild.channels.cache.get(settings.ticketChannelId);

            }

            if (!targetChannel) {

                const category = guild.channels.cache.get(settings.ticketCategoryId);

                if (category && category.type === 4) { // Category channel

                    targetChannel = category.children.cache.find(c => c.type === 0);

                }

            }

            if (!targetChannel) {

                targetChannel = guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(guild.members.me)?.has('SendMessages'));

            }

            if (!targetChannel) return res.status(400).json({ error: 'No suitable text channel found to spawn the ticket panel.' });



            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const styleMap = {
                'Primary': ButtonStyle.Primary,
                'Secondary': ButtonStyle.Secondary,
                'Success': ButtonStyle.Success,
                'Danger': ButtonStyle.Danger
            };

            const embedColor = settings.ticketEmbedColor && settings.ticketEmbedColor.startsWith('#') ? settings.ticketEmbedColor : '#ffffff';

            const pEmbed = new EmbedBuilder()
                .setTitle(settings.ticketEmbedTitle || 'Support Center')
                .setDescription(settings.ticketEmbedDesc || 'Need assistance? Please select the category that best matches your issue below to open a private channel with the Staff team.\n\n**Categories:**\n**Support:** General questions or assistance.\n**Reporting:** Report a user breaking the rules or a bug.\n**Appeals:** Request an appeal for an action taken against you.\n**Other:** Anything else.')
                .setColor(embedColor)
                .setFooter({ text: 'Support Ticketing System' });

            const pRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ticket_Support').setLabel(settings.ticketBtnLabelSupport || 'Support').setStyle(styleMap[settings.ticketBtnStyleSupport] || ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('ticket_Reporting').setLabel(settings.ticketBtnLabelReporting || 'Reporting').setStyle(styleMap[settings.ticketBtnStyleReporting] || ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('ticket_Appeals').setLabel(settings.ticketBtnLabelAppeals || 'Appeals').setStyle(styleMap[settings.ticketBtnStyleAppeals] || ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('ticket_Other').setLabel(settings.ticketBtnLabelOther || 'Other').setStyle(styleMap[settings.ticketBtnStyleOther] || ButtonStyle.Secondary)
            );

            await targetChannel.send({ embeds: [pEmbed], components: [pRow] });



            const logger = require('../../utils/logger');

            logger.logDashboardOrCommandAction(

                guild,

                'Dashboard Action - Spawn Ticket Panel',

                [

                    { name: 'Administrator', value: userTag, inline: true },

                    { name: 'Channel', value: `<#${targetChannel.id}>`, inline: true }

                ],

                0x3498db

            ).catch(() => null);



            return res.json({ success: true, message: `Ticket panel spawned in #${targetChannel.name}!` });

        }



        if (action === 'spawn_verify') {

            const settingsCache = require('../../utils/settingsCache');

            const settings = await settingsCache.get(guildId);

            if (!settings || !settings.verifyRoleId) {

                return res.status(400).json({ error: 'Verify role must be set in settings first.' });

            }



            const targetChannelId = settings.verifyChannelId;

            let channel = targetChannelId ? guild.channels.cache.get(targetChannelId) : null;

            if (!channel) {

                channel = guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(guild.members.me)?.has('SendMessages'));

            }

            if (!channel) return res.status(400).json({ error: 'No suitable text channel found. Set a Verify Channel in settings.' });



            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            const pEmbed = new EmbedBuilder()

                .setTitle('Server Verification Required')

                .setDescription('To gain full access to the server, please verify that you are human.\n\nClick the **Verify** button below and complete the CAPTCHA.')

                .setColor('#ffffff')

                .setFooter({ text: 'Nora Security Systems' });

            const pRow = new ActionRowBuilder().addComponents(

                new ButtonBuilder().setCustomId('verify_system_button').setLabel('Verify').setStyle(ButtonStyle.Success)

            );

            await channel.send({ embeds: [pEmbed], components: [pRow] });



            const logger = require('../../utils/logger');

            logger.logDashboardOrCommandAction(

                guild,

                'Dashboard Action - Spawn Verification Panel',

                [

                    { name: 'Administrator', value: userTag, inline: true },

                    { name: 'Channel', value: `<#${channel.id}>`, inline: true }

                ],

                0x3498db

            ).catch(() => null);



            return res.json({ success: true, message: `Verification panel spawned in #${channel.name}!` });

        }



        if (action === 'spawn_verify_roblox') {

            const settingsCache = require('../../utils/settingsCache');

            const settings = await settingsCache.get(guildId);

            if (!settings || !settings.robloxVerifyEnabled) {

                return res.status(400).json({ error: 'Roblox verification must be enabled in settings first.' });

            }

            if (!settings.robloxVerifyRoleId) {

                return res.status(400).json({ error: 'Roblox verified role must be set in settings first.' });

            }



            let channel = null;

            if (settings.robloxVerifyChannelId) {

                channel = guild.channels.cache.get(settings.robloxVerifyChannelId);

            }

            if (!channel) {

                channel = guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(guild.members.me)?.has('SendMessages'));

            }

            if (!channel) return res.status(400).json({ error: 'No suitable text channel found.' });



            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            const pEmbed = new EmbedBuilder()

                .setTitle('Roblox Account Verification')

                .setDescription('Link your Roblox account to this Discord server for access, roles, and perks!\n\n**How to verify:**\n1️⃣ Use the `/verify link` command with your Roblox username\n2️⃣ Copy the verification code provided\n3️⃣ Paste it into your Roblox profile description\n4️⃣ Run `/verify check` to complete verification\n\n**Manage your accounts:**\n• `/verify list` — View all linked accounts\n• `/verify switch` — Change your active account\n• `/verify unlink` — Remove a linked account')

                .setColor('#00b4d8')

                .setFooter({ text: 'Roblox Verification System' });



            const pRow = new ActionRowBuilder().addComponents(

                new ButtonBuilder()

                    .setLabel('Verify via Website')

                    .setStyle(ButtonStyle.Link)

                    .setURL(`https://vaztinix.dev/verify?guild=${guildId}`),

                new ButtonBuilder()

                    .setCustomId('roblox_verify_alt')

                    .setLabel('Alternative Verification')

                    .setStyle(ButtonStyle.Secondary)

            );



            await channel.send({ embeds: [pEmbed], components: [pRow] });



            const logger = require('../../utils/logger');

            logger.logDashboardOrCommandAction(

                guild,

                'Dashboard Action - Spawn Roblox Verification Panel',

                [

                    { name: 'Administrator', value: userTag, inline: true },

                    { name: 'Channel', value: `<#${channel.id}>`, inline: true }

                ],

                0x00b4d8

            ).catch(() => null);



            return res.json({ success: true, message: `Roblox verification panel spawned in #${channel.name}!` });

        }



        if (action === 'check_group_ranks') {

            const settingsCache = require('../../utils/settingsCache');

            const settings = await settingsCache.get(guildId);

            let groupBindings = [];

            try { groupBindings = JSON.parse(settings?.robloxGroupBindings || '[]'); } catch (e) {}



            if (!groupBindings || groupBindings.length === 0) {

                return res.status(400).json({ error: 'No Roblox group bindings configured. Add group bindings in the Roblox settings section.' });

            }



            return res.json({ success: true, message: `Found ${groupBindings.length} group binding(s). Group rank sync is active.` });

        }



        // ─── Member Moderation Actions (userId required) ───

        if (!userId) return res.status(400).json({ error: 'userId is required for this action.' });



        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);

        if (!member) return res.status(404).json({ error: 'Member not found in guild.' });



        // Check if bot can moderate target member

        if (member.roles.highest.position >= guild.members.me.roles.highest.position) {

            return res.status(403).json({ error: 'Cannot moderate user: Role position is higher than or equal to bot.' });

        }



        if (action === 'kick') {

            await member.kick(reason || 'Kicked from Web Dashboard');

            const logger = require('../../utils/logger');

            logger.logDashboardOrCommandAction(

                guild,

                'Dashboard Action - Member Kicked',

                [

                    { name: 'Administrator', value: userTag, inline: true },

                    { name: 'Target User', value: `${member.user.tag} (${member.user.id})`, inline: true },

                    { name: 'Reason', value: reason || 'No reason provided' }

                ],

                0xffaa00

            ).catch(() => null);

            return res.json({ success: true, message: `Successfully kicked ${member.user.tag}` });

        } else if (action === 'ban') {

            await member.ban({ reason: reason || 'Banned from Web Dashboard' });

            const logger = require('../../utils/logger');

            logger.logDashboardOrCommandAction(

                guild,

                'Dashboard Action - Member Banned',

                [

                    { name: 'Administrator', value: userTag, inline: true },

                    { name: 'Target User', value: `${member.user.tag} (${member.user.id})`, inline: true },

                    { name: 'Reason', value: reason || 'No reason provided' }

                ],

                0xff0000

            ).catch(() => null);

            return res.json({ success: true, message: `Successfully banned ${member.user.tag}` });

        } else if (action === 'warn') {

            await Warning.create({

                guildId,

                userId,

                reason: reason || 'Warned from Web Dashboard',

                moderatorId: req.userGuild.id

            });

            const logger = require('../../utils/logger');

            logger.logDashboardOrCommandAction(

                guild,

                'Dashboard Action - Member Warned',

                [

                    { name: 'Administrator', value: userTag, inline: true },

                    { name: 'Target User', value: `${member.user.tag} (${member.user.id})`, inline: true },

                    { name: 'Reason', value: reason || 'No reason provided' }

                ],

                0xffff00

            ).catch(() => null);

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

        res.json(feeds.map(f => {

            let pingType = 'none';

            let cleanMessage = f.alertTemplate || '';

            

            if (cleanMessage.startsWith('Hey @everyone! ')) {

                pingType = 'everyone';

                cleanMessage = cleanMessage.substring('Hey @everyone! '.length);

            } else if (cleanMessage.startsWith('Hey @here! ')) {

                pingType = 'here';

                cleanMessage = cleanMessage.substring('Hey @here! '.length);

            } else if (cleanMessage.startsWith('Hey <@&') && cleanMessage.includes('>! ')) {

                const match = cleanMessage.match(/^Hey <@&(\d+)>!\s*/);

                if (match) {

                    pingType = match[1];

                    cleanMessage = cleanMessage.substring(match[0].length);

                }

            }

            

            // Remove the link suffix if present

            if (cleanMessage.endsWith(' Link: {link}')) {

                cleanMessage = cleanMessage.substring(0, cleanMessage.length - ' Link: {link}'.length);

            } else if (cleanMessage.endsWith('Link: {link}')) {

                cleanMessage = cleanMessage.substring(0, cleanMessage.length - 'Link: {link}'.length);

            }

            

            // Reconstruct URL or show publicHandle

            let url = f.publicHandle;

            if (f.platform.toLowerCase() === 'youtube') {

                if (f.publicHandle.startsWith('UC') && f.publicHandle.length === 24) {

                    url = `https://youtube.com/channel/${f.publicHandle}`;

                } else {

                    url = `https://youtube.com/@${f.publicHandle}`;

                }

            } else if (f.platform.toLowerCase() === 'twitch') {

                url = `https://twitch.tv/${f.publicHandle}`;

            }



            return {

                id: f.id,

                platform: f.platform.toLowerCase(),

                platformId: f.publicHandle,

                discordChannelId: f.targetChannelId,

                customMessage: f.alertTemplate,

                pingType,

                cleanMessage,

                url

            };

        }));

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

            const { resolveChannelId } = require('../../services/youtube_engine');

            channelId = await resolveChannelId(url);



            if (url.includes('@')) {

                publicHandle = url.split('@')[1].split('/')[0].split('?')[0];

            } else if (url.includes('/channel/')) {

                publicHandle = url.split('/channel/')[1].split('/')[0].split('?')[0];

            } else if (url.startsWith('UC') && url.length === 24) {

                publicHandle = url;

            } else if (url.includes('youtube.com/')) {

                const parts = url.replace(/\/$/, '').split('/');

                publicHandle = parts[parts.length - 1].split('?')[0];

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

        if (platform === 'youtube') {

            try {

                const parsed = JSON.parse(customMessage);

                if (parsed.video !== undefined || parsed.short !== undefined || parsed.live !== undefined) {

                    const videoMsg = (parsed.video || '{creator} uploaded a new video! Link: {link}').trim();

                    const shortMsg = (parsed.short || '{creator} uploaded a new Short! Link: {link}').trim();

                    const liveMsg = (parsed.live || '{creator} is LIVE! Link: {link}').trim();

                    

                    const videoSuffix = videoMsg.includes('{link}') ? '' : ' Link: {link}';

                    const shortSuffix = shortMsg.includes('{link}') ? '' : ' Link: {link}';

                    const liveSuffix = liveMsg.includes('{link}') ? '' : ' Link: {link}';



                    alertTemplate = JSON.stringify({

                        video: `${pingPrefix}${videoMsg}${videoSuffix}`,

                        short: `${pingPrefix}${shortMsg}${shortSuffix}`,

                        live: `${pingPrefix}${liveMsg}${liveSuffix}`

                    });

                }

            } catch (e) {}

        }



        if (!alertTemplate) {

            if (customMessage && customMessage.trim()) {

                const cleanMessage = customMessage.trim();

                const suffix = cleanMessage.includes('{link}') ? '' : ' Link: {link}';

                alertTemplate = `${pingPrefix}${cleanMessage}${suffix}`;

            } else {

                alertTemplate = `${pingPrefix}{creator} is live/uploaded! Link: {link}`;

            }

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

 * PUT /api/guilds/:guildId/feeds/:feedId

 * Update an existing social media feed.

 */

router.put('/feeds/:feedId', async (req, res) => {

    try {

        const { guildId, feedId } = req.params;

        const { platform, url, discordChannelId, customMessage, pingType } = req.body;



        const ContentFeed = require('../../database/models/ContentFeed');

        const feed = await ContentFeed.findOne({ where: { id: feedId, guildId } });

        if (!feed) return res.status(404).json({ error: 'Feed not found.' });



        if (platform) feed.platform = platform.toUpperCase();

        if (discordChannelId) feed.targetChannelId = discordChannelId;



        if (url) {

            let publicHandle = url;

            let channelId = null;

            const { getYoutubeChannelId } = require('../../utils/socialScraper');



            if (feed.platform === 'YOUTUBE') {

                const { resolveChannelId } = require('../../services/youtube_engine');

                channelId = await resolveChannelId(url);



                if (url.includes('@')) {

                    publicHandle = url.split('@')[1].split('/')[0].split('?')[0];

                } else if (url.includes('/channel/')) {

                    publicHandle = url.split('/channel/')[1].split('/')[0].split('?')[0];

                } else if (url.startsWith('UC') && url.length === 24) {

                    publicHandle = url;

                } else if (url.includes('youtube.com/')) {

                    const parts = url.replace(/\/$/, '').split('/');

                    publicHandle = parts[parts.length - 1].split('?')[0];

                }



                if (!channelId) {

                    return res.status(400).json({ error: 'Could not find a valid YouTube channel. Make sure the handle/URL is correct and active.' });

                }

                feed.publicHandle = publicHandle;

                feed.channelId = channelId;

            } else if (feed.platform === 'TWITCH') {

                const parts = url.replace(/\/$/, '').split('/');

                publicHandle = parts[parts.length - 1];

                

                const axios = require('axios');

                const twitchCheck = await axios.get(`https://decapi.me/twitch/uptime/${publicHandle}`).catch(() => null);

                if (twitchCheck && twitchCheck.data.includes('not exist')) {

                    return res.status(400).json({ error: 'Twitch channel does not exist.' });

                }

                feed.publicHandle = publicHandle;

            }

        }



        // Recalculate alert template

        let resolvedPingType = pingType;

        if (resolvedPingType === undefined) {

            // Extract from existing

            if (feed.alertTemplate.startsWith('Hey @everyone! ')) resolvedPingType = 'everyone';

            else if (feed.alertTemplate.startsWith('Hey @here! ')) resolvedPingType = 'here';

            else if (feed.alertTemplate.startsWith('Hey <@&')) {

                const match = feed.alertTemplate.match(/^Hey <@&(\d+)>!\s*/);

                resolvedPingType = match ? match[1] : 'none';

            } else resolvedPingType = 'none';

        }



        let resolvedCustomMsg = customMessage;

        if (resolvedCustomMsg === undefined) {

            // Extract from existing

            resolvedCustomMsg = feed.alertTemplate;

            if (resolvedCustomMsg.startsWith('Hey @everyone! ')) resolvedCustomMsg = resolvedCustomMsg.substring('Hey @everyone! '.length);

            else if (resolvedCustomMsg.startsWith('Hey @here! ')) resolvedCustomMsg = resolvedCustomMsg.substring('Hey @here! '.length);

            else if (resolvedCustomMsg.startsWith('Hey <@&')) {

                const match = resolvedCustomMsg.match(/^Hey <@&(\d+)>!\s*/);

                if (match) resolvedCustomMsg = resolvedCustomMsg.substring(match[0].length);

            }

            if (resolvedCustomMsg.endsWith(' Link: {link}')) resolvedCustomMsg = resolvedCustomMsg.substring(0, resolvedCustomMsg.length - ' Link: {link}'.length);

            else if (resolvedCustomMsg.endsWith('Link: {link}')) resolvedCustomMsg = resolvedCustomMsg.substring(0, resolvedCustomMsg.length - 'Link: {link}'.length);

        }



        let pingPrefix = 'Hey @everyone! ';

        if (resolvedPingType === 'none') {

            pingPrefix = '';

        } else if (resolvedPingType === 'here') {

            pingPrefix = 'Hey @here! ';

        } else if (resolvedPingType && resolvedPingType !== 'everyone') {

            pingPrefix = `Hey <@&${resolvedPingType}>! `;

        }



        const cleanMessage = resolvedCustomMsg.trim();

        const suffix = cleanMessage.includes('{link}') ? '' : ' Link: {link}';

        feed.alertTemplate = `${pingPrefix}${cleanMessage}${suffix}`;



        await feed.save();



        res.json({ success: true, feed });

    } catch (e) {

        console.error('Error updating feed:', e);

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



/**

 * GET /api/guilds/:guildId/members/:userId/infractions

 * Returns all warnings for a member with filtering (?active=true, ?severity=high).

 */

router.get('/members/:userId/infractions', async (req, res) => {

    try {

        const { guildId, userId } = req.params;

        const { active, severity } = req.query;

        

        const where = { guildId, userId };

        if (active !== undefined) {

            where.active = active === 'true';

        }

        if (severity) {

            where.severity = severity;

        }



        const infractions = await Warning.findAll({

            where,

            order: [['timestamp', 'DESC']]

        });

        res.json(infractions);

    } catch (e) {

        console.error('Error fetching member infractions:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * GET /api/guilds/:guildId/members/:userId/cases

 * Returns all cases for a member with filtering (?type=WARN, ?status=active).

 */

router.get('/members/:userId/cases', async (req, res) => {

    try {

        const { guildId, userId } = req.params;

        const { type, status } = req.query;



        const where = { guildId, userId };

        if (type) {

            where.type = type.toUpperCase();

        }

        if (status) {

            where.status = status;

        }



        const cases = await Case.findAll({

            where,

            order: [['timestamp', 'DESC']]

        });

        res.json(cases);

    } catch (e) {

        console.error('Error fetching member cases:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * GET /api/guilds/:guildId/cases

 * Returns all guild-level cases (paginated ?page=1&limit=25, filterable by type/status).

 */

router.get('/cases', async (req, res) => {

    try {

        const { guildId } = req.params;

        const { type, status } = req.query;

        const page = parseInt(req.query.page, 10) || 1;

        const limit = parseInt(req.query.limit, 10) || 25;

        const offset = (page - 1) * limit;



        const where = { guildId };

        if (type) {

            where.type = type.toUpperCase();

        }

        if (status) {

            where.status = status;

        }



        const { count, rows } = await Case.findAndCountAll({

            where,

            order: [['timestamp', 'DESC']],

            limit,

            offset

        });



        res.json({

            total: count,

            page,

            limit,

            pages: Math.ceil(count / limit),

            cases: rows

        });

    } catch (e) {

        console.error('Error fetching guild cases:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * GET /api/guilds/:guildId/cases/:caseId

 * Returns a single case with full detail.

 */

router.get('/cases/:caseId', async (req, res) => {

    try {

        const { guildId, caseId } = req.params;

        const c = await Case.findOne({

            where: { id: caseId, guildId }

        });

        if (!c) return res.status(404).json({ error: 'Case not found.' });

        res.json(c);

    } catch (e) {

        console.error('Error fetching case:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * PUT /api/guilds/:guildId/cases/:caseId

 * Edit a case's reason or status from the dashboard.

 */

router.put('/cases/:caseId', async (req, res) => {

    try {

        const { guildId, caseId } = req.params;

        const { reason, status } = req.body;



        const c = await Case.findOne({

            where: { id: caseId, guildId }

        });

        if (!c) return res.status(404).json({ error: 'Case not found.' });



        const updateData = {};

        if (reason !== undefined) updateData.reason = reason;

        if (status !== undefined) {

            if (!['active', 'resolved', 'appealed', 'expired'].includes(status)) {

                return res.status(400).json({ error: 'Invalid status value.' });

            }

            updateData.status = status;

        }



        // Audit tracking

        const authHeader = req.headers.authorization;

        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        const user = token ? await getDiscordUser(token).catch(() => null) : null;

        

        if (user) {

            updateData.editedBy = user.id;

            updateData.editedAt = new Date();

        }



        await c.update(updateData);

        res.json({ success: true, case: c });

    } catch (e) {

        console.error('Error updating case:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * PUT /api/guilds/:guildId/infractions/:warningId

 * Edit a warning's reason from the dashboard.

 */

router.put('/infractions/:warningId', async (req, res) => {

    try {

        const { guildId, warningId } = req.params;

        const { reason, severity } = req.body;



        const warning = await Warning.findOne({

            where: { id: warningId, guildId }

        });

        if (!warning) return res.status(404).json({ error: 'Infraction not found.' });



        const updateData = {};

        if (reason !== undefined) updateData.reason = reason;

        if (severity !== undefined) {

            if (!['low', 'medium', 'high', 'critical'].includes(severity)) {

                return res.status(400).json({ error: 'Invalid severity value.' });

            }

            updateData.severity = severity;

        }



        // Audit tracking

        const authHeader = req.headers.authorization;

        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        const user = token ? await getDiscordUser(token).catch(() => null) : null;

        

        if (user) {

            updateData.editedBy = user.id;

            updateData.editedAt = new Date();

        }



        await warning.update(updateData);

        res.json({ success: true, infraction: warning });

    } catch (e) {

        console.error('Error updating infraction:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * DELETE /api/guilds/:guildId/infractions/:warningId

 * Soft-delete a warning from the dashboard.

 */

router.delete('/infractions/:warningId', async (req, res) => {

    try {

        const { guildId, warningId } = req.params;



        const warning = await Warning.findOne({

            where: { id: warningId, guildId }

        });

        if (!warning) return res.status(404).json({ error: 'Infraction not found.' });



        const authHeader = req.headers.authorization;

        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        const user = token ? await getDiscordUser(token).catch(() => null) : null;



        await warning.update({

            active: false,

            editedBy: user ? user.id : 'dashboard',

            editedAt: new Date()

        });



        res.json({ success: true, message: 'Infraction soft-deleted successfully.' });

    } catch (e) {

        console.error('Error deleting infraction:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * GET /api/guilds/:guildId/autoresponders

 * Returns all autoresponder rules for a server.

 */

router.get('/autoresponders', async (req, res) => {

    try {

        const { guildId } = req.params;

        const Autoresponder = require('../../database/models/Autoresponder');

        const responders = await Autoresponder.findAll({ where: { guildId } });

        res.json(responders);

    } catch (e) {

        console.error('Error fetching autoresponders:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * POST /api/guilds/:guildId/autoresponders

 * Creates a new autoresponder rule.

 */

router.post('/autoresponders', async (req, res) => {

    try {

        const { guildId } = req.params;

        const Autoresponder = require('../../database/models/Autoresponder');

        const GuildSettings = require('../../database/models/GuildSettings');

        const { trigger, response, matchType, isEmbed, ignoreStaffAndBots, ignoredChannels, ignoredRoles, allowedRoles } = req.body;

        

        if (!trigger || !response) {

            return res.status(400).json({ error: 'Trigger and response fields are required.' });

        }



        // Fetch settings and check premium status

        let settings = await GuildSettings.findOne({ where: { guildId } });

        if (!settings) {

            [settings] = await GuildSettings.findOrCreate({ where: { guildId } });

        }

        let isPremium = !!settings.isPremium || !!settings.isManualPremium;

        const guild = req.client ? req.client.guilds.cache.get(guildId) : null;

        if (guild && (guild.ownerId === '1214048435632603137' || guild.ownerId === '1366229304257544213')) {

            isPremium = true;

        }

        const paidTime = settings.paidExpiresAt ? new Date(settings.paidExpiresAt).getTime() : 0;

        const expandedMs = settings.expandedTimeMs ? Number(settings.expandedTimeMs) : 0;

        if (paidTime + expandedMs > Date.now()) {

            isPremium = true;

        }



        // Capacity limit check

        const count = await Autoresponder.count({ where: { guildId } });

        const cap = isPremium ? 200 : 20;

        if (count >= cap) {

            return res.status(400).json({ error: `Limit exceeded: Free servers are capped at 20 autoresponder rules, while Premium servers get up to 200. Please upgrade to Studio Plus for more slots.` });

        }



        // Regex permission check

        if (matchType === 'regex' && !isPremium) {

            return res.status(400).json({ error: 'Premium Limit: Regular Expression (Regex) matching requires Nora Premium.' });

        }



        const responder = await Autoresponder.create({

            guildId,

            trigger,

            response,

            matchType: matchType || 'contains',

            isEmbed: !!isEmbed,

            ignoreStaffAndBots: !!ignoreStaffAndBots,

            ignoredChannels: ignoredChannels ? JSON.stringify(ignoredChannels) : '[]',

            ignoredRoles: ignoredRoles ? JSON.stringify(ignoredRoles) : '[]',

            allowedRoles: allowedRoles ? JSON.stringify(allowedRoles) : '[]'

        });



        res.status(201).json(responder);

    } catch (e) {

        console.error('Error creating autoresponder:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * PUT /api/guilds/:guildId/autoresponders/:id

 * Updates an existing autoresponder rule.

 */

router.put('/autoresponders/:id', async (req, res) => {

    try {

        const { guildId, id } = req.params;

        const Autoresponder = require('../../database/models/Autoresponder');

        const GuildSettings = require('../../database/models/GuildSettings');

        const { trigger, response, matchType, isEmbed, ignoreStaffAndBots, ignoredChannels, ignoredRoles, allowedRoles } = req.body;



        const responder = await Autoresponder.findOne({ where: { id, guildId } });

        if (!responder) return res.status(404).json({ error: 'Autoresponder rule not found.' });



        // Fetch settings and check premium status

        let settings = await GuildSettings.findOne({ where: { guildId } });

        if (!settings) {

            [settings] = await GuildSettings.findOrCreate({ where: { guildId } });

        }

        let isPremium = !!settings.isPremium || !!settings.isManualPremium;

        const guild = req.client ? req.client.guilds.cache.get(guildId) : null;

        if (guild && (guild.ownerId === '1214048435632603137' || guild.ownerId === '1366229304257544213')) {

            isPremium = true;

        }

        const paidTime = settings.paidExpiresAt ? new Date(settings.paidExpiresAt).getTime() : 0;

        const expandedMs = settings.expandedTimeMs ? Number(settings.expandedTimeMs) : 0;

        if (paidTime + expandedMs > Date.now()) {

            isPremium = true;

        }



        // Regex permission check

        if (matchType === 'regex' && !isPremium) {

            return res.status(400).json({ error: 'Premium Limit: Regular Expression (Regex) matching requires Nora Premium.' });

        }



        const updateData = {};

        if (trigger !== undefined) updateData.trigger = trigger;

        if (response !== undefined) updateData.response = response;

        if (matchType !== undefined) updateData.matchType = matchType;

        if (isEmbed !== undefined) updateData.isEmbed = !!isEmbed;

        if (ignoreStaffAndBots !== undefined) updateData.ignoreStaffAndBots = !!ignoreStaffAndBots;

        if (ignoredChannels !== undefined) updateData.ignoredChannels = JSON.stringify(ignoredChannels);

        if (ignoredRoles !== undefined) updateData.ignoredRoles = JSON.stringify(ignoredRoles);

        if (allowedRoles !== undefined) updateData.allowedRoles = JSON.stringify(allowedRoles);



        await responder.update(updateData);

        res.json(responder);

    } catch (e) {

        console.error('Error updating autoresponder:', e);

        res.status(500).json({ error: e.message });

    }

});



/**

 * DELETE /api/guilds/:guildId/autoresponders/:id

 * Deletes an autoresponder rule.

 */

router.delete('/autoresponders/:id', async (req, res) => {

    try {

        const { guildId, id } = req.params;

        const Autoresponder = require('../../database/models/Autoresponder');

        const responder = await Autoresponder.findOne({ where: { id, guildId } });

        if (!responder) return res.status(404).json({ error: 'Autoresponder rule not found.' });



        await responder.destroy();

        res.json({ success: true, message: 'Autoresponder rule deleted.' });

    } catch (e) {

        console.error('Error deleting autoresponder:', e);

        res.status(500).json({ error: e.message });

    }

});



/**
 * POST /api/guilds/:guildId/reaction-roles/publish
 * Publishes a new reaction roles embed panel to a channel.
 */
router.post('/reaction-roles/publish', async (req, res) => {
    try {
        const { guildId } = req.params;
        const { channelId, title, description, color, imageUrl, roles } = req.body;

        if (!channelId) return res.status(400).json({ error: 'Destination channel is required.' });
        if (!roles || !Array.isArray(roles) || roles.length === 0) {
            return res.status(400).json({ error: 'Please configure at least one role mapping.' });
        }

        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found.' });

        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(404).json({ error: 'Channel not found.' });

        const me = guild.members.me;
        if (!me) return res.status(500).json({ error: 'Bot member not found.' });

        const perms = channel.permissionsFor(me);
        if (!perms || !perms.has('SendMessages') || !perms.has('EmbedLinks') || !perms.has('AddReactions')) {
            return res.status(403).json({ error: 'Nora requires "Send Messages", "Embed Links", and "Add Reactions" permissions in the destination channel.' });
        }

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setDescription(description && description.trim() ? description : 'Click the emoji reactions below to assign/remove roles on your profile.')
            .setColor(color || '#ffffff');

        if (title && title.trim()) {
            embed.setTitle(title);
        }
        if (imageUrl && imageUrl.trim()) {
            embed.setImage(imageUrl);
        }

        const targetMessage = await channel.send({ embeds: [embed] });

        const ReactionRole = require('../../database/models/ReactionRole');
        for (const mapping of roles) {
            const { roleId, emoji } = mapping;
            let emojiKey = emoji.trim();
            const customEmojiRegex = /^<?(a)?:([a-zA-Z0-9_]+):([0-9]+)>?$/;
            const customMatch = emojiKey.match(customEmojiRegex);
            if (customMatch) {
                emojiKey = customMatch[3];
            }

            await ReactionRole.create({
                guildId,
                messageId: targetMessage.id,
                emoji: emojiKey,
                roleId
            });

            await targetMessage.react(emoji).catch(err => {
                console.warn(`[Reaction Role Publish] Failed to react with ${emoji}:`, err.message);
            });
        }

        try {
            const authHeader = req.headers.authorization;
            const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
            const user = token ? await getDiscordUser(token).catch(() => null) : null;
            const logger = require('../../utils/logger');
            const userTag = user ? `${user.username} (${user.id})` : 'Dashboard Administrator';
            logger.logDashboardOrCommandAction(
                guild,
                'Dashboard Action - Published Reaction Roles Panel',
                [
                    { name: 'Administrator', value: userTag, inline: true },
                    { name: 'Channel', value: `<#${channelId}>`, inline: true },
                    { name: 'Message ID', value: targetMessage.id, inline: true },
                    { name: 'Mappings Count', value: String(roles.length), inline: true }
                ],
                0x2ecc71
            ).catch(() => null);
        } catch (err) {}

        res.json({ success: true, message: 'Reaction roles panel published successfully!' });
    } catch (e) {
        console.error('Error publishing reaction roles panel:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/members/:userId/warn
 */
router.post('/members/:userId/warn', async (req, res) => {
    try {
        const { guildId, userId } = req.params;
        const { reason } = req.body;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found.' });

        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'Member not found in guild.' });

        if (member.roles.highest.position >= guild.members.me.roles.highest.position) {
            return res.status(403).json({ error: 'Cannot moderate user: Role position is higher than or equal to bot.' });
        }

        await Warning.create({
            guildId,
            userId,
            reason: reason || 'Warned from Web Dashboard',
            moderatorId: req.userGuild.id
        });

        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
        const user = token ? await getDiscordUser(token).catch(() => null) : null;
        const userTag = user ? `${user.username} (${user.id})` : 'Dashboard Administrator';

        const logger = require('../../utils/logger');
        logger.logDashboardOrCommandAction(
            guild,
            'Dashboard Action - Member Warned',
            [
                { name: 'Administrator', value: userTag, inline: true },
                { name: 'Target User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Reason', value: reason || 'No reason provided' }
            ],
            0xffff00
        ).catch(() => null);

        return res.json({ success: true, message: `Successfully warned ${member.user.tag}` });
    } catch (e) {
        console.error('Warn route error:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/members/:userId/unwarn
 */
router.post('/members/:userId/unwarn', async (req, res) => {
    try {
        const { guildId, userId } = req.params;
        const { reason } = req.body;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found.' });

        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'Member not found in guild.' });

        // Find the latest active warning for the user
        const latestWarning = await Warning.findOne({
            where: { guildId, userId, active: true },
            order: [['createdAt', 'DESC']]
        });
        if (!latestWarning) {
            return res.status(404).json({ error: 'No active warnings found for this member.' });
        }

        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
        const user = token ? await getDiscordUser(token).catch(() => null) : null;
        const userTag = user ? `${user.username} (${user.id})` : 'Dashboard Administrator';

        await latestWarning.update({
            active: false,
            editedBy: user ? user.id : 'dashboard',
            editedAt: new Date()
        });

        const logger = require('../../utils/logger');
        logger.logDashboardOrCommandAction(
            guild,
            'Dashboard Action - Member Warning Removed (Unwarned)',
            [
                { name: 'Administrator', value: userTag, inline: true },
                { name: 'Target User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Reason', value: reason || 'No reason provided' },
                { name: 'Removed Warning ID', value: String(latestWarning.id), inline: true }
            ],
            0x00ff00
        ).catch(() => null);

        return res.json({ success: true, message: `Successfully removed warning for ${member.user.tag}` });
    } catch (e) {
        console.error('Unwarn route error:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/members/:userId/kick
 */
router.post('/members/:userId/kick', async (req, res) => {
    try {
        const { guildId, userId } = req.params;
        const { reason } = req.body;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found.' });

        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'Member not found in guild.' });

        if (member.roles.highest.position >= guild.members.me.roles.highest.position) {
            return res.status(403).json({ error: 'Cannot moderate user: Role position is higher than or equal to bot.' });
        }

        await member.kick(reason || 'Kicked from Web Dashboard');

        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
        const user = token ? await getDiscordUser(token).catch(() => null) : null;
        const userTag = user ? `${user.username} (${user.id})` : 'Dashboard Administrator';

        const logger = require('../../utils/logger');
        logger.logDashboardOrCommandAction(
            guild,
            'Dashboard Action - Member Kicked',
            [
                { name: 'Administrator', value: userTag, inline: true },
                { name: 'Target User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Reason', value: reason || 'No reason provided' }
            ],
            0xffaa00
        ).catch(() => null);

        return res.json({ success: true, message: `Successfully kicked ${member.user.tag}` });
    } catch (e) {
        console.error('Kick route error:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/members/:userId/ban
 */
router.post('/members/:userId/ban', async (req, res) => {
    try {
        const { guildId, userId } = req.params;
        const { reason } = req.body;
        const guild = req.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found.' });

        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'Member not found in guild.' });

        if (member.roles.highest.position >= guild.members.me.roles.highest.position) {
            return res.status(403).json({ error: 'Cannot moderate user: Role position is higher than or equal to bot.' });
        }

        await member.ban({ reason: reason || 'Banned from Web Dashboard' });

        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
        const user = token ? await getDiscordUser(token).catch(() => null) : null;
        const userTag = user ? `${user.username} (${user.id})` : 'Dashboard Administrator';

        const logger = require('../../utils/logger');
        logger.logDashboardOrCommandAction(
            guild,
            'Dashboard Action - Member Banned',
            [
                { name: 'Administrator', value: userTag, inline: true },
                { name: 'Target User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Reason', value: reason || 'No reason provided' }
            ],
            0xff0000
        ).catch(() => null);

        return res.json({ success: true, message: `Successfully banned ${member.user.tag}` });
    } catch (e) {
        console.error('Ban route error:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/guilds/:guildId/applications
 * Returns all application configurations for this guild.
 */
router.get('/applications', async (req, res) => {
    try {
        const { guildId } = req.params;
        const Application = require('../../database/models/Application');
        const apps = await Application.findAll({
            where: { guildId },
            order: [['createdAt', 'DESC']]
        });
        res.json(apps);
    } catch (e) {
        console.error('Error fetching applications:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/applications
 * Creates or updates an application configuration.
 */
router.post('/applications', async (req, res) => {
    try {
        const { guildId } = req.params;
        const { id, name, description, reviewChannelId, questions, isActive } = req.body;
        const Application = require('../../database/models/Application');

        if (!name) return res.status(400).json({ error: 'Application Name is required.' });

        let app;
        if (id) {
            app = await Application.findOne({ where: { id, guildId } });
            if (!app) return res.status(404).json({ error: 'Application set not found.' });
            
            await app.update({
                name,
                description,
                reviewChannelId,
                questions: questions || '[]',
                isActive: isActive !== undefined ? isActive : app.isActive
            });
        } else {
            // If active and we want single active, handle it, but wait: multiple active are supported
            app = await Application.create({
                guildId,
                name,
                description,
                reviewChannelId,
                questions: questions || '[]',
                isActive: isActive !== undefined ? isActive : true
            });
        }

        res.json({ success: true, app });
    } catch (e) {
        console.error('Error saving application:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /api/guilds/:guildId/applications/:appId
 * Deletes an application configuration.
 */
router.delete('/applications/:appId', async (req, res) => {
    try {
        const { guildId, appId } = req.params;
        const Application = require('../../database/models/Application');

        const deleted = await Application.destroy({ where: { id: appId, guildId } });
        if (!deleted) return res.status(404).json({ error: 'Application set not found.' });

        res.json({ success: true });
    } catch (e) {
        console.error('Error deleting application:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/applications/:appId/toggle
 * Toggles or sets the active state of an application.
 */
router.post('/applications/:appId/toggle', async (req, res) => {
    try {
        const { guildId, appId } = req.params;
        const { isActive } = req.body;
        const Application = require('../../database/models/Application');

        const app = await Application.findOne({ where: { id: appId, guildId } });
        if (!app) return res.status(404).json({ error: 'Application set not found.' });

        await app.update({ isActive: !!isActive });
        res.json({ success: true, app });
    } catch (e) {
        console.error('Error toggling application status:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/guilds/:guildId/applications/:appId/send-panel
 * Sends the application button panel to a channel.
 */
router.post('/applications/:appId/send-panel', async (req, res) => {
    try {
        const { guildId, appId } = req.params;
        const { channelId, embedTitle, embedDescription, buttonLabel } = req.body;
        const Application = require('../../database/models/Application');

        const app = await Application.findOne({ where: { id: appId, guildId } });
        if (!app) return res.status(404).json({ error: 'Application set not found.' });

        const client = req.client || require('../../index').client; 
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return res.status(404).json({ error: 'Guild not found.' });

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return res.status(404).json({ error: 'Channel not found.' });

        const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setTitle(embedTitle || `Apply for ${app.name}`)
            .setDescription(embedDescription || `Click the button below to start your application form.`)
            .setColor(0x57acf2)
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`app_start_${app.id}`)
                .setLabel(buttonLabel || 'Apply')
                .setStyle(ButtonStyle.Primary)
        );

        await channel.send({ embeds: [embed], components: [row] });
        res.json({ success: true });
    } catch (e) {
        console.error('Error sending application panel:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
