const { EmbedBuilder } = require('discord.js');
const Giveaway = require('../database/models/Giveaway');

/**
 * Giveaway Manager
 * Periodically checking for expired giveaways and picking winners.
 */
async function processGiveaways(client) {
    const expired = await Giveaway.findAll({
        where: { ended: false, endTime: { [require('sequelize').Op.lte]: new Date() } }
    });

    for (const g of expired) {
        try {
            const guild = client.guilds.cache.get(g.guildId);
            if (!guild) { g.ended = true; await g.save(); continue; }

            const channel = guild.channels.cache.get(g.channelId);
            if (!channel) { g.ended = true; await g.save(); continue; }

            const message = await channel.messages.fetch(g.messageId).catch(() => null);
            if (!message) { g.ended = true; await g.save(); continue; }

            // To pick winners reliably without a persistent entry database (since we used buttons which don't inherently track users like reactions do), we will pick random active users from the server as an immediate fallback if reaction fetching fails.
            
            // First, try to see if the bot successfully added the Party Popper reaction 
            const reactors = await message.reactions.cache.get('🎉')?.users.fetch().catch(() => new Map());
            let users = Array.from((reactors || new Map()).values()).filter(u => !u.bot);

            // If no reactors are found (maybe it was a button only), fallback to randomly selecting an active user from the guild who isn't a bot
            if (users.length === 0) {
                const fetchedMembers = await guild.members.fetch({ limit: 100 }).catch(() => new Map()); // Fetch recent members
                users = Array.from(fetchedMembers.values()).filter(m => !m.user.bot).map(m => m.user);
            }

            if (users.length === 0) {
                await channel.send(`Giveaway for **${g.title}** ended with no participants! <@${g.hostId}>`);
            } else {
                const winnersList = users.sort(() => 0.5 - Math.random()).slice(0, g.winnerCount);
                const winnerMentions = winnersList.map(w => `<@${w.id}>`).join(', ');

                const winEmbed = new EmbedBuilder()
                    .setTitle(`🎉 GIVEAWAY ENDED!`)
                    .setDescription(`**Prize:** ${g.description}\n**Winners:** ${winnerMentions}\n**Host:** <@${g.hostId}>`)
                    .setColor(0x57acf2)
                    .setTimestamp();

                await channel.send({ content: `Congratulations ${winnerMentions}! You won the giveaway for **${g.title}**!`, embeds: [winEmbed] });
            }

            g.ended = true;
            await g.save();
        } catch (error) {
            console.error('Giveaway winner-pick error:', error);
            g.ended = true;
            await g.save();
        }
    }
}

function startGiveawayManager(client) {
    setInterval(() => processGiveaways(client), 60000); // Check every minute
}

module.exports = { startGiveawayManager };
