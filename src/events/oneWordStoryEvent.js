const { Events } = require('discord.js');
const settingsCache = require('../utils/settingsCache');
const oneWordStoryManager = require('../utils/oneWordStoryManager');

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot) return;

        // Skip bot commands and command prefixes (excluding punctuation like . or ?)
        const content = message.content.trim();
        if (!content || /^[/!#$&-]/.test(content)) return;

        const settings = await settingsCache.get(message.guild.id);
        if (!settings || settings.oneWordStoryEnabled === false) return;

        // Check if there is an active game in this channel
        const activeGame = await oneWordStoryManager.getActiveGame(message.channel.id);
        if (!activeGame) return;

        const allowConsecutive = !!settings.oneWordStoryAllowConsecutive;
        const result = await oneWordStoryManager.processWord(message.channel.id, content, message.author, allowConsecutive);

        if (result.success) {
            try {
                await message.react('✅');
            } catch (e) {}

            // Auto-finish if story end period (.) is submitted or max words limit is reached
            const isWordLimitReached = settings.oneWordStoryMaxWords > 0 && result.wordCount >= settings.oneWordStoryMaxWords;
            if (result.isStoryEnd || isWordLimitReached) {
                const endResult = await oneWordStoryManager.endGame(message.guild.id, message.channel.id);
                if (endResult.success) {
                    const { EmbedBuilder } = require('discord.js');
                    const topList = endResult.topContributors.slice(0, 5).map((c, idx) => `${idx + 1}. **${c.username}**: ${c.count} words`).join('\n') || 'None';

                    const embed = new EmbedBuilder()
                        .setTitle('📖 One Word Story Completed!')
                        .setDescription(`**Completed Story:**\n>>> ${endResult.story}`)
                        .setColor('#00b4d8')
                        .addFields(
                            { name: 'Total Words', value: `${endResult.wordCount}`, inline: true },
                            { name: 'Contributors', value: `${endResult.contributorsCount}`, inline: true },
                            { name: 'Top Authors', value: topList, inline: false }
                        )
                        .setFooter({ text: `Ended by ${message.author.username}` })
                        .setTimestamp();

                    await message.channel.send({ embeds: [embed] }).catch(() => {});
                }
            }
        } else {
            // Rejection handling
            if (['multiple_words', 'consecutive', 'unsafe_mention', 'too_long'].includes(result.reason)) {
                try {
                    await message.react('❌');
                } catch (e) {}

                if (result.message) {
                    try {
                        const notice = await message.reply({ content: `⚠️ ${result.message}` });
                        setTimeout(() => notice.delete().catch(() => {}), 4000);
                    } catch (e) {}
                }
            }
        }
    }
};
