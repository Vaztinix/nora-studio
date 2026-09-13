const { Op } = require('sequelize');
const GuildActivityDaily = require('../database/models/GuildActivityDaily');
const UserLevel = require('../database/models/UserLevel');

/**
 * Nora Universal Activity Tracker
 * High-performance, persistent tracking of message volume, active users, 
 * voice engagement, and channel stats across all Discord servers.
 */
class ActivityTracker {
    constructor() {
        this.buffer = new Map(); // guildId -> { dateKey, messages, channels: {}, users: Set, hourly: [], joins, leaves }
        this.userMsgBuffer = new Map(); // "guildId:userId" -> count
        this.flushInterval = setInterval(() => this.flushAll(), 5000);
        this.bootstrappedGuilds = new Set(); // Prevent duplicate channel backfills in a single session
    }

    getDateKey(d = new Date()) {
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    getLastNDateKeys(days = 7) {
        const keys = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000);
            keys.push(this.getDateKey(d));
        }
        return keys;
    }

    _getGuildBuffer(guildId) {
        const today = this.getDateKey();
        if (!this.buffer.has(guildId) || this.buffer.get(guildId).dateKey !== today) {
            this.buffer.set(guildId, {
                dateKey: today,
                messages: 0,
                channels: {},
                users: new Set(),
                hourly: Array(24).fill(0),
                joins: 0,
                leaves: 0
            });
        }
        return this.buffer.get(guildId);
    }

    /**
     * Record an incoming non-bot message
     */
    recordMessage(message) {
        if (!message || !message.guild || !message.author || message.author.bot) return;

        const guildId = message.guild.id;
        const channelId = message.channel.id;
        const userId = message.author.id;
        const hour = new Date().getUTCHours();

        // 1. In-memory client cache for instant top-channel UI
        if (message.client) {
            if (!message.client.channelActivity) message.client.channelActivity = {};
            if (!message.client.channelActivity[guildId]) message.client.channelActivity[guildId] = {};
            message.client.channelActivity[guildId][channelId] = (message.client.channelActivity[guildId][channelId] || 0) + 1;
        }

        // 2. Buffer for daily aggregation
        const buf = this._getGuildBuffer(guildId);
        buf.messages += 1;
        buf.channels[channelId] = (buf.channels[channelId] || 0) + 1;
        buf.users.add(userId);
        buf.hourly[hour] = (buf.hourly[hour] || 0) + 1;

        // 3. User lifetime & weekly message counter buffer
        const userKey = `${guildId}:${userId}`;
        this.userMsgBuffer.set(userKey, (this.userMsgBuffer.get(userKey) || 0) + 1);

        // Immediate flush if buffer exceeds 50 messages to keep DB current
        if (buf.messages >= 50) {
            this.flushGuild(guildId).catch(err => console.error('[ActivityTracker] Flush error:', err.message));
        }
    }

    /**
     * Record member join event
     */
    recordJoin(guildId) {
        if (!guildId) return;
        const buf = this._getGuildBuffer(guildId);
        buf.joins += 1;
    }

    /**
     * Record member leave / kick / ban event
     */
    recordLeave(guildId) {
        if (!guildId) return;
        const buf = this._getGuildBuffer(guildId);
        buf.leaves += 1;
    }

    /**
     * Flush all buffered data to SQLite database
     */
    async flushAll() {
        const guildIds = Array.from(this.buffer.keys());
        for (const gId of guildIds) {
            await this.flushGuild(gId).catch(() => {});
        }
        await this.flushUserMessages().catch(() => {});
    }

    /**
     * Flush a single guild's pending buffer
     */
    async flushGuild(guildId) {
        const buf = this.buffer.get(guildId);
        if (!buf) return;
        if (buf.messages === 0 && buf.joins === 0 && buf.leaves === 0 && buf.users.size === 0) return;

        // Snapshot and reset current buffer
        const snapshot = {
            dateKey: buf.dateKey,
            messages: buf.messages,
            channels: { ...buf.channels },
            users: Array.from(buf.users),
            hourly: [...buf.hourly],
            joins: buf.joins,
            leaves: buf.leaves
        };

        buf.messages = 0;
        buf.channels = {};
        buf.users.clear();
        buf.hourly = Array(24).fill(0);
        buf.joins = 0;
        buf.leaves = 0;

        try {
            const [record] = await GuildActivityDaily.findOrCreate({
                where: { guildId, date: snapshot.dateKey },
                defaults: {
                    guildId,
                    date: snapshot.dateKey,
                    messageCount: 0,
                    joinsCount: 0,
                    leavesCount: 0,
                    channelsData: '{}',
                    activeUsersData: '[]',
                    hourlyActivity: JSON.stringify(Array(24).fill(0))
                }
            });

            // Merge channel counts
            let existingChannels = {};
            try { existingChannels = JSON.parse(record.channelsData || '{}'); } catch (_) {}
            for (const [chId, count] of Object.entries(snapshot.channels)) {
                existingChannels[chId] = (existingChannels[chId] || 0) + count;
            }

            // Merge unique active users
            let existingUsers = [];
            try { existingUsers = JSON.parse(record.activeUsersData || '[]'); } catch (_) {}
            const mergedUsersSet = new Set([...existingUsers, ...snapshot.users]);

            // Merge hourly distribution
            let existingHourly = Array(24).fill(0);
            try { existingHourly = JSON.parse(record.hourlyActivity || '[]'); } catch (_) {}
            if (!Array.isArray(existingHourly) || existingHourly.length !== 24) existingHourly = Array(24).fill(0);
            for (let h = 0; h < 24; h++) {
                existingHourly[h] = (existingHourly[h] || 0) + (snapshot.hourly[h] || 0);
            }

            await record.update({
                messageCount: (record.messageCount || 0) + snapshot.messages,
                joinsCount: (record.joinsCount || 0) + snapshot.joins,
                leavesCount: (record.leavesCount || 0) + snapshot.leaves,
                channelsData: JSON.stringify(existingChannels),
                activeUsersData: JSON.stringify(Array.from(mergedUsersSet)),
                hourlyActivity: JSON.stringify(existingHourly)
            });
        } catch (err) {
            console.error(`[ActivityTracker] Failed to flush guild ${guildId}:`, err.message);
        }
    }

    /**
     * Flush user message counters
     */
    async flushUserMessages() {
        if (this.userMsgBuffer.size === 0) return;
        const entries = Array.from(this.userMsgBuffer.entries());
        this.userMsgBuffer.clear();

        for (const [key, count] of entries) {
            const [guildId, userId] = key.split(':');
            try {
                const [userRec] = await UserLevel.findOrCreate({
                    where: { userId, guildId },
                    defaults: { xp: 0, level: 0, totalXp: 0, messagesCount: 0, messagesWeek: 0 }
                });
                await userRec.update({
                    messagesCount: (userRec.messagesCount || 0) + count,
                    messagesWeek: (userRec.messagesWeek || 0) + count,
                    lastMessageTimestamp: new Date()
                });
            } catch (_) {}
        }
    }

    /**
     * Bootstrap / backfill recent message activity directly from Discord channel history
     * Scans accessible text channels for messages created in the past 7 days.
     */
    async bootstrapFromChannels(guild) {
        if (!guild || this.bootstrappedGuilds.has(guild.id)) return null;
        this.bootstrappedGuilds.add(guild.id);

        try {
            const sevenDaysAgoMs = Date.now() - 7 * 86400000;
            const textChannels = Array.from(guild.channels.cache.filter(c => (c.type === 0 || c.type === 5 || (typeof c.isTextBased === 'function' && c.isTextBased() && (!c.isVoiceBased || !c.isVoiceBased())))).values());

            const dailyStats = new Map(); // dateKey -> { messages, channels: {}, users: Set, hourly: Array(24) }

            // Fetch recent messages in parallel with timeout protection
            await Promise.allSettled(textChannels.map(async (ch) => {
                try {
                    const perms = ch.permissionsFor?.(guild.members.me);
                    if (perms && (!perms.has('ViewChannel') || !perms.has('ReadMessageHistory'))) return;

                    const fetchPromise = ch.messages.fetch({ limit: 100 });
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
                    const messages = await Promise.race([fetchPromise, timeoutPromise]).catch(() => null);

                    if (!messages || messages.size === 0) return;

                    for (const [, msg] of messages) {
                        if (msg.author?.bot) continue;
                        const createdMs = msg.createdTimestamp;
                        if (createdMs < sevenDaysAgoMs) continue;

                        const dateKey = this.getDateKey(new Date(createdMs));
                        if (!dailyStats.has(dateKey)) {
                            dailyStats.set(dateKey, {
                                messages: 0,
                                channels: {},
                                users: new Set(),
                                hourly: Array(24).fill(0)
                            });
                        }

                        const d = dailyStats.get(dateKey);
                        d.messages += 1;
                        d.channels[ch.id] = (d.channels[ch.id] || 0) + 1;
                        if (msg.author?.id) d.users.add(msg.author.id);
                        const hr = new Date(createdMs).getUTCHours();
                        d.hourly[hr] = (d.hourly[hr] || 0) + 1;
                    }
                } catch (_) {}
            }));

            // Upsert the bootstrapped stats into database
            for (const [dateKey, d] of dailyStats.entries()) {
                const [record] = await GuildActivityDaily.findOrCreate({
                    where: { guildId: guild.id, date: dateKey },
                    defaults: {
                        guildId: guild.id,
                        date: dateKey,
                        messageCount: d.messages,
                        channelsData: JSON.stringify(d.channels),
                        activeUsersData: JSON.stringify(Array.from(d.users)),
                        hourlyActivity: JSON.stringify(d.hourly)
                    }
                });

                // If existing record was lower, update with scanned real data
                if (record.messageCount < d.messages) {
                    let existingCh = {};
                    try { existingCh = JSON.parse(record.channelsData || '{}'); } catch (_) {}
                    for (const [cId, cnt] of Object.entries(d.channels)) {
                        existingCh[cId] = Math.max(existingCh[cId] || 0, cnt);
                    }

                    let existingU = [];
                    try { existingU = JSON.parse(record.activeUsersData || '[]'); } catch (_) {}
                    const mergedU = new Set([...existingU, ...Array.from(d.users)]);

                    await record.update({
                        messageCount: Math.max(record.messageCount || 0, d.messages),
                        channelsData: JSON.stringify(existingCh),
                        activeUsersData: JSON.stringify(Array.from(mergedU))
                    });
                }
            }

            console.log(`[ActivityTracker] Successfully bootstrapped 7-day message analytics for guild: ${guild.name} (${guild.id})`);
        } catch (e) {
            console.error(`[ActivityTracker] Bootstrap failed for guild ${guild.id}:`, e.message);
        }
    }

    /**
     * Retrieve accurate weekly statistics and 7-day breakdown for a guild
     */
    async getWeeklyStats(guild, days = 7) {
        if (!guild) return { totalWeeklyMessages: 0, chartData: [], topChannelId: null, peakHourUTC: 0, uniqueActiveUsers: 0, activityTrend: 0 };

        const guildId = guild.id;

        // Flush any pending in-memory buffer first
        await this.flushGuild(guildId);

        const dateKeys = this.getLastNDateKeys(days);

        // Fetch DB records for the last 7 days
        let records = await GuildActivityDaily.findAll({
            where: {
                guildId,
                date: { [Op.in]: dateKeys }
            }
        });

        // If records are empty or sum is 0, attempt a live channel scan to populate accurate initial data
        const currentSum = records.reduce((sum, r) => sum + (r.messageCount || 0), 0);
        if (currentSum === 0 && !this.bootstrappedGuilds.has(guildId)) {
            await this.bootstrapFromChannels(guild);
            records = await GuildActivityDaily.findAll({
                where: {
                    guildId,
                    date: { [Op.in]: dateKeys }
                }
            });
        }

        const recordMap = new Map(records.map(r => [r.date, r]));

        let totalWeeklyMessages = 0;
        const allActiveUsers = new Set();
        const combinedChannels = {};
        const combinedHourly = Array(24).fill(0);
        const chartData = [];

        // Member list for join calculation fallback
        const membersList = Array.from(guild.members?.cache?.values?.() || []);

        for (let i = days - 1; i >= 0; i--) {
            const dateObj = new Date(Date.now() - i * 86400000);
            const dateKey = this.getDateKey(dateObj);
            const r = recordMap.get(dateKey);

            const msgCount = r ? (r.messageCount || 0) : 0;
            totalWeeklyMessages += msgCount;

            // Active users for this day
            let dayUsers = [];
            if (r && r.activeUsersData) {
                try { dayUsers = JSON.parse(r.activeUsersData); } catch (_) {}
            }
            dayUsers.forEach(u => allActiveUsers.add(u));

            // Channels aggregation
            if (r && r.channelsData) {
                try {
                    const chMap = JSON.parse(r.channelsData);
                    for (const [chId, cnt] of Object.entries(chMap)) {
                        combinedChannels[chId] = (combinedChannels[chId] || 0) + cnt;
                    }
                } catch (_) {}
            }

            // Hourly aggregation
            if (r && r.hourlyActivity) {
                try {
                    const hrArr = JSON.parse(r.hourlyActivity);
                    if (Array.isArray(hrArr)) {
                        hrArr.forEach((cnt, idx) => {
                            if (idx < 24) combinedHourly[idx] += (cnt || 0);
                        });
                    }
                } catch (_) {}
            }

            // Joins count (combine DB logged joins with member joinedAt cache)
            let joins = r ? (r.joinsCount || 0) : 0;
            if (joins === 0 && membersList.length > 0) {
                const dayStart = new Date(dateObj);
                dayStart.setUTCHours(0, 0, 0, 0);
                const dayEnd = dayStart.getTime() + 86400000;
                joins = membersList.filter(m => {
                    if (!m.joinedAt) return false;
                    const jTime = new Date(m.joinedAt).getTime();
                    return jTime >= dayStart.getTime() && jTime < dayEnd;
                }).length;
            }

            chartData.push({
                date: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                dateKey,
                joins,
                activity: msgCount > 0 ? msgCount : dayUsers.length // Show real message volume or active users
            });
        }

        // Determine Top Channel
        let topChannelId = null;
        let topChannelCount = 0;
        for (const [chId, cnt] of Object.entries(combinedChannels)) {
            if (cnt > topChannelCount) {
                topChannelCount = cnt;
                topChannelId = chId;
            }
        }

        // Determine Peak Hour UTC
        let peakHourUTC = 0;
        let maxHourlyMessages = -1;
        for (let h = 0; h < 24; h++) {
            if (combinedHourly[h] > maxHourlyMessages) {
                maxHourlyMessages = combinedHourly[h];
                peakHourUTC = h;
            }
        }

        // Calculate Activity Trend (compare last 3 days with 3 days prior)
        const last3DaysMsgs = chartData.slice(-3).reduce((sum, d) => sum + d.activity, 0);
        const prior3DaysMsgs = chartData.slice(-6, -3).reduce((sum, d) => sum + d.activity, 0);

        let activityTrend = 0;
        if (prior3DaysMsgs > 0) {
            activityTrend = parseFloat((((last3DaysMsgs - prior3DaysMsgs) / prior3DaysMsgs) * 100).toFixed(1));
        } else if (last3DaysMsgs > 0) {
            activityTrend = 100.0;
        } else {
            activityTrend = 0.0;
        }

        return {
            totalWeeklyMessages,
            uniqueActiveUsers: allActiveUsers.size,
            chartData,
            topChannelId,
            topChannelCount,
            peakHourUTC: maxHourlyMessages > 0 ? peakHourUTC : null,
            activityTrend
        };
    }
}

// Export singleton instance
const activityTracker = new ActivityTracker();
module.exports = activityTracker;
