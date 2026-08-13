const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Giveaway = require('../database/models/Giveaway');
const { Op } = require('sequelize');

/**
 * Parse flexible duration string (e.g., '30s', '10m', '2h', '1d', '1w') into milliseconds.
 * Returns null if invalid format or less than 5 seconds.
 */
function parseDuration(str) {
    if (!str || typeof str !== 'string') return null;
    const match = str.trim().match(/^(\d+)\s*([smhdw])$/i);
    if (!match) return null;

    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (isNaN(val) || val <= 0) return null;

    let ms = 0;
    switch (unit) {
        case 's': ms = val * 1000; break;
        case 'm': ms = val * 60 * 1000; break;
        case 'h': ms = val * 60 * 60 * 1000; break;
        case 'd': ms = val * 24 * 60 * 60 * 1000; break;
        case 'w': ms = val * 7 * 24 * 60 * 60 * 1000; break;
        default: return null;
    }

    if (ms < 5000) return null;
    return ms;
}

/**
 * Build giveaway message embed
 */
function buildGiveawayEmbed(g, isEnded = false, winners = []) {
    const endTimestamp = Math.floor(new Date(g.endTime).getTime() / 1000);
    const embed = new EmbedBuilder();

    if (isEnded) {
        embed.setTitle(`🎉 GIVEAWAY ENDED — ${g.title}`)
            .setColor(0x2ed573)
            .setFooter({ text: 'Nora Giveaway System • Ended' });

        let desc = g.description ? `${g.description}\n\n` : '';
        desc += `🏁 **Ended:** <t:${endTimestamp}:R>\n`;
        desc += `👑 **Host:** <@${g.hostId}>\n`;
        if (g.requiredRoleId) {
            desc += `🔒 **Required Role:** <@&${g.requiredRoleId}>\n`;
        }

        if (winners && winners.length > 0) {
            const winnerMentions = winners.map(w => `<@${w}>`).join(', ');
            desc += `\n🏆 **Winner(s):** ${winnerMentions}`;
        } else {
            desc += `\n🏆 **Winner(s):** No valid entries`;
        }

        embed.setDescription(desc);
    } else {
        embed.setTitle(`🎉 GIVEAWAY — ${g.title}`)
            .setColor(0xff4757)
            .setFooter({ text: 'Nora Giveaway System • Click button below to enter!' });

        let desc = g.description ? `${g.description}\n\n` : '';
        desc += `⏳ **Ends:** <t:${endTimestamp}:R> (<t:${endTimestamp}:F>)\n`;
        desc += `👑 **Host:** <@${g.hostId}>\n`;
        desc += `🏆 **Winners:** ${g.winnerCount}\n`;
        if (g.requiredRoleId) {
            desc += `🔒 **Required Role:** <@&${g.requiredRoleId}>\n`;
        }

        embed.setDescription(desc);
    }

    if (g.imageUrl && /^https?:\/\/.+/i.test(g.imageUrl)) {
        embed.setImage(g.imageUrl);
    }

    embed.setTimestamp();
    return embed;
}

/**
 * Build giveaway interactive button component
 */
function buildGiveawayComponents(isEnded = false, participantCount = 0) {
    const button = new ButtonBuilder()
        .setCustomId('giveaway_enter')
        .setLabel(`🎉 Enter Giveaway (${participantCount})`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(isEnded);

    return [new ActionRowBuilder().addComponents(button)];
}

/**
 * End a giveaway manually or automatically
 */
async function endGiveaway(client, messageId) {
    const g = await Giveaway.findOne({ where: { messageId } });
    if (!g) return { success: false, error: 'Giveaway not found.' };
    if (g.ended) return { success: false, error: 'Giveaway has already ended.' };

    let participants = [];
    try {
        participants = JSON.parse(g.participants || '[]');
    } catch (e) {
        participants = [];
    }

    const guild = client.guilds.cache.get(g.guildId);
    const channel = guild ? guild.channels.cache.get(g.channelId) : null;
    const message = channel ? await channel.messages.fetch(g.messageId).catch(() => null) : null;

    // Filter valid participants
    let eligibleUsers = [...new Set(participants)];

    // Fallback check reactions if button participants array was empty
    if (eligibleUsers.length === 0 && message) {
        const reactors = await message.reactions.cache.get('🎉')?.users.fetch().catch(() => new Map());
        if (reactors) {
            eligibleUsers = Array.from(reactors.values()).filter(u => !u.bot).map(u => u.id);
        }
    }

    let winnersList = [];
    if (eligibleUsers.length > 0) {
        // Shuffle & pick winners
        const shuffled = [...eligibleUsers].sort(() => 0.5 - Math.random());
        winnersList = shuffled.slice(0, Math.min(g.winnerCount, eligibleUsers.length));
    }

    g.ended = true;
    g.winners = JSON.stringify(winnersList);
    await g.save();

    // Update original giveaway message embed & components
    if (message) {
        const endedEmbed = buildGiveawayEmbed(g, true, winnersList);
        const endedComponents = buildGiveawayComponents(true, eligibleUsers.length);
        await message.edit({ embeds: [endedEmbed], components: endedComponents }).catch(() => {});
    }

    // Send announcement message in channel
    if (channel) {
        if (winnersList.length > 0) {
            const mentions = winnersList.map(w => `<@${w}>`).join(', ');
            const winAnnouncement = new EmbedBuilder()
                .setTitle(`🏆 Giveaway Winner Announcement!`)
                .setDescription(`Congratulations ${mentions}! You won **${g.title}**!\n\n👑 Hosted by <@${g.hostId}>`)
                .setColor(0x2ed573)
                .setTimestamp();

            await channel.send({ content: `🎉 Congratulations ${mentions}! You won the giveaway for **${g.title}**!`, embeds: [winAnnouncement] }).catch(() => {});
        } else {
            await channel.send({ content: `Giveaway for **${g.title}** ended, but there were no valid entries! <@${g.hostId}>` }).catch(() => {});
        }
    }

    return { success: true, giveaway: g, winners: winnersList };
}

/**
 * Reroll giveaway winners
 */
async function rerollGiveaway(client, messageId, rerollCount = 1) {
    const g = await Giveaway.findOne({ where: { messageId } });
    if (!g) return { success: false, error: 'Giveaway not found.' };
    if (!g.ended) return { success: false, error: 'Cannot reroll an active giveaway. End it first.' };

    let participants = [];
    try {
        participants = JSON.parse(g.participants || '[]');
    } catch (e) {
        participants = [];
    }

    eligibleUsers = [...new Set(participants)];
    if (eligibleUsers.length === 0) {
        return { success: false, error: 'No participants available to reroll winners.' };
    }

    const countToPick = Math.min(rerollCount, eligibleUsers.length);
    const newWinners = [...eligibleUsers].sort(() => 0.5 - Math.random()).slice(0, countToPick);
    const winnerMentions = newWinners.map(w => `<@${w}>`).join(', ');

    const guild = client.guilds.cache.get(g.guildId);
    const channel = guild ? guild.channels.cache.get(g.channelId) : null;

    if (channel) {
        const rerollEmbed = new EmbedBuilder()
            .setTitle(`🎲 GIVEAWAY REROLL — ${g.title}`)
            .setDescription(`**New Winner(s):** ${winnerMentions}\n\n👑 Hosted by <@${g.hostId}>`)
            .setColor(0x70a1ff)
            .setTimestamp();

        await channel.send({ content: `🎉 **REROLL!** Congratulations ${winnerMentions}! You are the new winner(s) of **${g.title}**!`, embeds: [rerollEmbed] }).catch(() => {});
    }

    return { success: true, winners: newWinners };
}

/**
 * Periodic check loop for expired giveaways
 */
async function processGiveaways(client) {
    try {
        const expired = await Giveaway.findAll({
            where: { ended: false, endTime: { [Op.lte]: new Date() } }
        });

        for (const g of expired) {
            await endGiveaway(client, g.messageId);
        }
    } catch (error) {
        console.error('[Giveaway Manager Loop Error]:', error);
    }
}

function startGiveawayManager(client) {
    processGiveaways(client);
    setInterval(() => processGiveaways(client), 15000); // Check every 15 seconds
}

module.exports = {
    parseDuration,
    buildGiveawayEmbed,
    buildGiveawayComponents,
    endGiveaway,
    rerollGiveaway,
    startGiveawayManager
};
