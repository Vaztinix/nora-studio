const Reminder = require('../database/models/Reminder');
const Notification = require('../database/models/Notification');
const { sendPushToUser } = require('./pushManager');
const { Op } = require('sequelize');

let schedulerInterval = null;

/**
 * Initializes the background reminder checker loop.
 * @param {import('discord.js').Client} client 
 */
function initReminderScheduler(client) {
    if (schedulerInterval) clearInterval(schedulerInterval);

    schedulerInterval = setInterval(async () => {
        try {
            const now = Date.now();
            const pendingReminders = await Reminder.findAll({
                where: {
                    isTriggered: false,
                    triggerTime: { [Op.lte]: now }
                }
            }).catch(() => []);

            for (const reminder of pendingReminders) {
                reminder.isTriggered = true;
                await reminder.save().catch(() => {});

                const pushPayload = {
                    title: '⏰ Nora Reminder Alert!',
                    body: reminder.message,
                    icon: '/favicon.ico',
                    data: { url: '/dashboard' }
                };

                // 1. Send Web Push Notification to PWA / installed web app
                await sendPushToUser(reminder.userId, pushPayload);

                // 2. Log in Notification bell table for dashboard
                await Notification.create({
                    userId: reminder.userId,
                    title: '⏰ Reminder Alert',
                    content: reminder.message,
                    type: 'info',
                    read: false
                }).catch(() => {});

                // 3. Send Discord DM if client is active and user is reachable
                if (client && client.users) {
                    try {
                        const discordUser = await client.users.fetch(reminder.userId).catch(() => null);
                        if (discordUser) {
                            const { EmbedBuilder } = require('discord.js');
                            const embed = new EmbedBuilder()
                                .setTitle('⏰ Nora Scheduled Reminder')
                                .setDescription(`**Reminder:** ${reminder.message}`)
                                .setColor(0x7C3AED)
                                .setFooter({ text: 'Nora Web Dashboard & Reminders System' })
                                .setTimestamp();

                            await discordUser.send({ embeds: [embed] }).catch(() => {});
                        }
                    } catch (e) {}
                }
            }
        } catch (err) {
            console.error('[ReminderScheduler Error]:', err.message);
        }
    }, 10000); // Check every 10 seconds
}

module.exports = { initReminderScheduler };
