const { sendVoteNotification } = require('./topggWebhookHandler');
const noraLeveling = require('./noraLeveling');
const GuildSettings = require('../database/models/GuildSettings');
const TopggConnection = require('../database/models/TopggConnection');

class VoteQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
    }

    enqueue(payload) {
        this.queue.push(payload);
        this.processNext();
    }

    async processNext() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        const payload = this.queue.shift();
        try {
            await this.processVote(payload);
        } catch (err) {
            console.error('[VoteQueue] Error processing vote job:', err);
        } finally {
            this.isProcessing = false;
            // Process the next item on the next tick
            setImmediate(() => this.processNext());
        }
    }

    async processVote(payload) {
        const { bot, guild: serverId, user: userId, type, isWeekend, isTest } = payload;
        
        console.log(`[VoteQueue] Processing vote: user=${userId}, bot=${bot || '-'}, server=${serverId || '-'}`);

        // Find all TopggConnection records where targetId matches bot or guild/server
        const targetId = bot || serverId;
        if (!targetId) {
            console.warn('[VoteQueue] Target ID is missing from payload');
            return;
        }

        const connections = await TopggConnection.findAll({
            where: { targetId, verified: true }
        });

        if (connections.length === 0) {
            console.warn(`[VoteQueue] No verified connections found for targetId ${targetId}`);
            return;
        }

        for (const conn of connections) {
            try {
                const guildId = conn.guildId;
                const settings = await GuildSettings.findOne({ where: { guildId } });
                if (!settings) continue;

                // Award XP in the specific guild
                const userRecord = await noraLeveling.getOrInitializeUser(userId, guildId);
                if (userRecord) {
                    const xpBoost = settings.topggXpBoost || 1;
                    const count = (settings.topggDoubleXp && (isWeekend || [6, 0].includes(new Date().getDay()))) ? 2 : 1;
                    const baseXP = 50 * xpBoost * count;
                    
                    await noraLeveling.addExperience(userRecord, baseXP);
                    userRecord.voteCount = (userRecord.voteCount || 0) + 1;
                    userRecord.lastVoteTimestamp = new Date();
                    await userRecord.save();
                }

                // Assign Reward Role if configured
                if (settings.topggRewardRoleId) {
                    try {
                        const discordClient = require('../index').client; // get client from index
                        const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
                        if (guild) {
                            const member = await guild.members.fetch(userId).catch(() => null);
                            if (member && !member.roles.cache.has(settings.topggRewardRoleId)) {
                                const roleObj = guild.roles.cache.get(settings.topggRewardRoleId);
                                if (roleObj && guild.members.me.roles.highest.position > roleObj.position) {
                                    await member.roles.add(settings.topggRewardRoleId).catch(e => {
                                        console.error(`[VoteQueue] Failed to add reward role to user ${userId} in ${guildId}:`, e.message);
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        console.error('[VoteQueue] Error assigning reward role:', e.message);
                    }
                }

                // Send Notification alert
                const voteChannelId = settings.topggVoteChannelId || settings.voteLogChannelId;
                if (voteChannelId) {
                    const discordClient = require('../index').client;
                    const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
                    if (guild) {
                        await sendVoteNotification(guild, settings, userId, !!isTest).catch(err => {
                            console.error('[VoteQueue] Notification sending failed:', err.message);
                        });
                    }
                }
            } catch (err) {
                console.error(`[VoteQueue] Failed to process vote connection for guild ${conn.guildId}:`, err);
            }
        }
    }
}

module.exports = new VoteQueue();
