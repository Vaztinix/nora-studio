const { Events, PermissionFlagsBits } = require('discord.js');
const settingsCache = require('../utils/settingsCache');

// In-memory spam tracker (resets on bot restart, which is fine for basic anti-spam)
const userMessageLog = new Map();

// 🧹 Memory Sweep: Clean old data every 15 mins to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of userMessageLog.entries()) {
        if (Array.isArray(data)) {
            const fresh = data.filter(t => (now - t) < 30000); // Keep data slightly longer for dynamic checks
            if (fresh.length === 0) userMessageLog.delete(key);
            else userMessageLog.set(key, fresh);
        } else if (typeof data === 'number') {
            if ((now - data) > 10000) userMessageLog.delete(key); // clear ancient warning timestamps
        }
    }
}, 15 * 60 * 1000);

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author) return;
        if (message.author.id === client.user.id) return; // Ignore self

        // Get guild settings
        const settings = await settingsCache.get(message.guild.id);
        
        if (!settings.spamDetectionEnabled) return;

        // Admins and Managers bypass anti-spam
        if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

        // 🛡️ AutoMod Priority: Respect existing timeouts (likely from native AutoMod)
        if (message.member?.communicationDisabledUntilTimestamp > Date.now()) return;

        const userId = message.author.id;
        const guildId = message.guild.id;
        const key = `${guildId}-${userId}`;
        const now = Date.now();

        if (!userMessageLog.has(key)) {
            userMessageLog.set(key, []);
        }

        const timestamps = userMessageLog.get(key);
        timestamps.push(now);

        // Keep only messages from the last configured interval
        const recentTimestamps = timestamps.filter(t => (now - t) < (settings.spamInterval || 5000));
        userMessageLog.set(key, recentTimestamps);

        if (recentTimestamps.length > settings.spamThreshold) {
            try {
                // Delete the most recent message
                if (message.deletable) {
                    await message.delete().catch(() => {});
                }

                // Warn the user once? (Use a separate cooldown for warnings to avoid warning spam!)
                const warningKey = `${key}-warned`;
                const lastWarned = userMessageLog.get(warningKey);
                
                if (!lastWarned || (now - lastWarned) > 10000) { // 10s warning cooldown
                    const warnMsg = await message.channel.send(`Slow down <@${message.author.id}>! You are sending messages too quickly. Please stay calm and follow the rules.`);
                    setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
                    userMessageLog.set(warningKey, now);

                    // Optional: Brief timeout (requires Nora to have "Moderate Members" permission)
                    if (message.member?.moderatable) {
                        const duration = settings.antiSpamMuteDuration || 60000;
                        await message.member.timeout(duration, 'Suspicious Auto-Spam Detection');
                    }
                }
            } catch (err) {
                console.error('Spam Detection Error:', err);
            }
        }
    },
};
