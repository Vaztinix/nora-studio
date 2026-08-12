const { Events } = require('discord.js');
const settingsCache = require('../utils/settingsCache');
const oneWordStoryManager = require('../utils/oneWordStoryManager');

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot) return;

        // Skip bot commands and command prefixes
        const content = message.content.trim();
        if (!content || /^[!/?.#$&-]/.test(content)) return;

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

            // Auto-finish if max words limit is reached
            if (settings.oneWordStoryMaxWords > 0 && result.wordCount >= settings.oneWordStoryMaxWords) {
                const endResult = await oneWordStoryManager.endGame(message.guild.id, message.channel.id);
                if (endResult.success) {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle('📖 One Word Story Completed!')
                        .setDescription(`The story has reached its word limit of **${settings.oneWordStoryMaxWords} words**!\n\n**Full Story:**\n>>> ${endResult.story}`)
                        .setColor('#00b4d8')
                        .addFields(
                            { name: 'Total Words', value: `${endResult.wordCount}`, inline: true },
                            { name: 'Contributors', value: `${endResult.contributorsCount}`, inline: true }
                        )
                        .setFooter({ text: 'Nora One Word Story Game' })
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
