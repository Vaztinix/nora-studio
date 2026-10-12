const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const VoteReminder = require('../database/models/VoteReminder');
const { Op } = require('sequelize');

/**
 * 🗳️ Nora Top.gg Vote Reminder & Cooldown Manager
 * Automatically tracks voter cooldowns and sends a direct message to voters
 * as soon as they are eligible to vote again: 'You can vote for "Bot name" again.'
 */
class VoteReminderManager {
    constructor() {
        this.schedulerInterval = null;
        this.isProcessing = false;
    }

    /**
     * Record a vote and schedule the 12-hour eligibility reminder
     * @param {string} userId - Discord ID of the voter
     * @param {string} botId - Target Bot ID
     * @param {string} botName - Display name of the bot
     * @param {string} guildId - Server context if available
     * @param {number} cooldownHours - Cooldown hours (default 12)
     */
    async recordVote(userId, botId = null, botName = 'Nora', guildId = null, cooldownHours = 12) {
        if (!userId) return null;
        try {
            const now = new Date();
            const remindAt = new Date(now.getTime() + (cooldownHours * 60 * 60 * 1000));
            const safeBotName = botName || 'Nora';

            // Find existing pending reminder for this user and bot, or create new
            let reminder = await VoteReminder.findOne({
                where: {
                    userId: String(userId),
                    botId: botId ? String(botId) : null,
                    isReminded: false
                }
            });

            if (reminder) {
                reminder.votedAt = now;
                reminder.remindAt = remindAt;
                reminder.botName = safeBotName;
                reminder.guildId = guildId || reminder.guildId;
                await reminder.save();
            } else {
                reminder = await VoteReminder.create({
                    userId: String(userId),
                    botId: botId ? String(botId) : null,
                    botName: safeBotName,
                    guildId: guildId || null,
                    votedAt: now,
                    remindAt: remindAt,
                    isReminded: false
                });
            }

            console.log(`[VoteReminder] Scheduled 12h vote reminder for user ${userId} for "${safeBotName}" at ${remindAt.toISOString()}`);
            return reminder;
        } catch (err) {
            console.error('[VoteReminder] Failed to record vote reminder:', err.message);
            return null;
        }
    }

    /**
     * Check if a user can currently vote or get remaining cooldown
     * @param {string} userId 
     * @param {string} botId 
     * @returns {Promise<{ canVote: boolean, remainingMs?: number, remindAt?: Date, botName?: string }>}
     */
    async getVoteCooldown(userId, botId = null) {
        if (!userId) return { canVote: true };
        try {
            const now = new Date();
            const reminder = await VoteReminder.findOne({
                where: {
                    userId: String(userId),
                    botId: botId ? String(botId) : null,
                    remindAt: { [Op.gt]: now }
                },
                order: [['remindAt', 'DESC']]
            });

            if (reminder) {
                const remainingMs = reminder.remindAt.getTime() - now.getTime();
                return {
                    canVote: false,
                    remainingMs,
                    remindAt: reminder.remindAt,
                    botName: reminder.botName || 'Nora'
                };
            }

            return { canVote: true };
        } catch (err) {
            console.error('[VoteReminder] Error checking cooldown:', err.message);
            return { canVote: true };
        }
    }

    /**
     * Check all pending reminders and send direct message to eligible voters
     * @param {import('discord.js').Client} client 
     */
    async checkAndSendReminders(client) {
        if (!client || this.isProcessing) return;
        this.isProcessing = true;

        try {
            const now = new Date();
            const dueReminders = await VoteReminder.findAll({
                where: {
                    isReminded: false,
                    remindAt: { [Op.lte]: now }
                },
                limit: 25
            });

            if (dueReminders.length === 0) {
                this.isProcessing = false;
                return;
            }

            for (const reminder of dueReminders) {
                try {
                    // Mark as reminded first to prevent duplicate DMs if network hangs
                    reminder.isReminded = true;
                    await reminder.save();

                    const user = client.users.cache.get(reminder.userId) || await client.users.fetch(reminder.userId).catch(() => null);
                    if (!user) continue;

                    const botName = reminder.botName || client.user?.username || 'Nora';
                    const targetBotId = reminder.botId || client.user?.id || '740998573237825536';
                    const voteUrl = `https://top.gg/bot/${targetBotId}/vote`;

                    const embed = new EmbedBuilder()
                        .setTitle(`💖 Vote Cooldown Complete!`)
                        .setColor(0xFF3366) // Top.gg Signature Pink
                        .setDescription(
                            `Hey <@${user.id}>! Your 12-hour vote cooldown has ended.\n\n` +
                            `🎉 **You can vote for "${botName}" again!**\n\n` +
                            `• **Keep your vote streak alive!** 🔥\n` +
                            `• Earn bonus Leveling XP and server perks.\n` +
                            `• Help ${botName} reach more communities.`
                        )
                        .setFooter({ text: 'Top.gg Vote Reminder • Nora Assistant', iconURL: 'https://discord.do/wp-content/uploads/2023/08/Top.gg_.jpg' })
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel(`Vote for ${botName} on Top.gg`)
                            .setURL(voteUrl)
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('🗳️')
                    );

                    await user.send({
                        content: `You can vote for "${botName}" again! 💖`,
                        embeds: [embed],
                        components: [row]
                    }).catch(dmErr => {
                        console.log(`[VoteReminder] Could not DM user ${user.tag} (${user.id}): ${dmErr.message}`);
                    });

                    console.log(`[VoteReminder] Sent vote availability DM to user ${user.tag} (${user.id}) for "${botName}".`);
                } catch (userErr) {
                    console.error(`[VoteReminder] Error processing reminder for user ${reminder.userId}:`, userErr.message);
                }
            }
        } catch (err) {
            console.error('[VoteReminder] Error checking due reminders:', err.message);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Start the automated vote reminder daemon
     * @param {import('discord.js').Client} client 
     */
    startScheduler(client) {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
        }

        // Run an initial sweep 10 seconds after ready
        setTimeout(() => {
            this.checkAndSendReminders(client).catch(() => {});
        }, 10000);

        // Check every 60 seconds
        this.schedulerInterval = setInterval(() => {
            this.checkAndSendReminders(client).catch(() => {});
        }, 60000);

        console.log('[VoteReminder] 12-Hour Vote Reminder Scheduler online (checking every 60s).');
    }
}

const voteReminderManager = new VoteReminderManager();
module.exports = voteReminderManager;
