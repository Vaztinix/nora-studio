const { ChannelType } = require('discord.js');

/**
 * 🛰️ Aura Historical Recall Engine
 * Fetches messages from a specific channel within a 30-day time window.
 */
async function fetchServerKnowledge(client, guild, limit = 25, searchFilter = null) {
    const context = [];
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
    
    for (const [id, channel] of channels) {
        try {
            const messages = await channel.messages.fetch({ limit: 50 });
            const filtered = messages.filter(m => {
                const timestamp = m.createdTimestamp || m.createdAt.getTime();
                if (timestamp < thirtyDaysAgo) return false;
                if (searchFilter && !m.content?.toLowerCase().includes(searchFilter.toLowerCase())) return false;
                return true;
            });

            for (const [mid, msg] of filtered) {
                if (context.length >= limit) break;
                context.push({
                    channel: channel.name,
                    author: msg.author.username,
                    content: msg.content,
                    date: msg.createdAt.toLocaleString(),
                    timestamp: msg.createdTimestamp || msg.createdAt.getTime()
                });
            }
        } catch (e) {
            // Permission or network fault
        }
        if (context.length >= limit) break;
    }

    return context;
}

/**
 * 📚 Aura Monthly Deep Search
 * Targeted scan for a specific user within 30 days.
 */
async function fetchMonthlyHistory(channel, days = 30, targetUserId = null) {
    let context = [];
    let lastId = null;
    const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);

    try {
        // We perform a looped fetch to reach back further if needed
        for (let i = 0; i < 5; i++) { // Max 500 messages scan per request for safety
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            const filtered = messages.filter(m => {
                const ts = m.createdTimestamp;
                if (ts < threshold) return false;
                if (targetUserId && m.author.id !== targetUserId) return false;
                return true;
            });

            filtered.forEach(m => context.push(`${m.author.username}: ${m.content}`));
            lastId = messages.last().id;

            if (messages.last().createdTimestamp < threshold) break;
            if (context.length >= 25) break; 
        }
    } catch (e) {
        console.error('[Aura History Engine Failure]:', e.message);
    }

    return context.join('\n');
}

module.exports = { fetchServerKnowledge, fetchMonthlyHistory };
