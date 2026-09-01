const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
        const maxSentences = settings.oneWordStoryMaxSentences || 10;
        const result = await oneWordStoryManager.processWord(message.channel.id, content, message.author, allowConsecutive, maxSentences);

        if (result.success) {
            try {
                if (result.isSentenceEnd && !result.isStoryEnd) {
                    await message.react('📝');
                } else {
                    await message.react('✅');
                }
            } catch (e) {}

            // Auto-finish if sentences or max words limit reached
            const isWordLimitReached = settings.oneWordStoryMaxWords > 0 && result.wordCount >= settings.oneWordStoryMaxWords;
            const isSentenceLimitReached = result.sentenceCount >= maxSentences;

            if (result.isStoryEnd || isSentenceLimitReached || isWordLimitReached) {
                const endResult = await oneWordStoryManager.endGame(message.guild.id, message.channel.id, false);
                if (endResult.success) {
                    const topList = endResult.topContributors.slice(0, 5).map((c, idx) => `${idx + 1}. **${c.username}**: ${c.count} words`).join('\n') || 'None';

                    const footerText = endResult.autoRestartRemaining > 0
                        ? `🔄 Auto-restarting in 5 seconds... (${endResult.autoRestartRemaining} round${endResult.autoRestartRemaining !== 1 ? 's' : ''} remaining)`
                        : `Reached ${endResult.sentenceCount || maxSentences} sentence story milestone 🎯`;

                    const embed = new EmbedBuilder()
                        .setTitle('📖 One Word Story Completed!')
                        .setDescription(`**Completed Story:**\n>>> ${endResult.story}`)
                        .setColor('#00b4d8')
                        .addFields(
                            { name: 'Total Words', value: `${endResult.wordCount}`, inline: true },
                            { name: 'Sentences', value: `${endResult.sentenceCount || maxSentences}`, inline: true },
                            { name: 'Contributors', value: `${endResult.contributorsCount}`, inline: true },
                            { name: 'Top Authors', value: topList, inline: false }
                        )
                        .setFooter({ text: footerText })
                        .setTimestamp();

                    await message.channel.send({ embeds: [embed] }).catch(() => {});

                    // Auto-restart logic
                    if (endResult.autoRestartRemaining > 0) {
                        const channelId = message.channel.id;
                        const guildId = message.guild.id;
                        const remainingRounds = endResult.autoRestartRemaining - 1;

                        setTimeout(async () => {
                            try {
                                // Double-check no game was manually started in the meantime
                                const existingGame = await oneWordStoryManager.getActiveGame(channelId);
                                if (existingGame) return;

                                const startResult = await oneWordStoryManager.startGame(guildId, channelId, client.user.id, remainingRounds);
                                if (!startResult.success) return;

                                const roundLabel = remainingRounds > 0
                                    ? `(${remainingRounds} auto-restart${remainingRounds !== 1 ? 's' : ''} remaining)`
                                    : '(Final round)';

                                const startEmbed = new EmbedBuilder()
                                    .setTitle('📖 One Word Story — New Round!')
                                    .setDescription(
                                        `🔄 **Auto-restarted!** ${roundLabel}\n\n` +
                                        '**Rules:**\n' +
                                        '1️⃣ Send **exactly ONE word** per message.\n' +
                                        `2️⃣ ${allowConsecutive ? 'Consecutive turns allowed.' : 'You **cannot** post twice in a row — wait for someone else!'}\n` +
                                        '3️⃣ No mentions (`@everyone`/`<@user>`), links, or commands.\n' +
                                        '4️⃣ Add a period (`.`) at the end of a word to **complete a sentence** (reacts with 📝).\n' +
                                        `5️⃣ Story automatically finishes after **${maxSentences} sentences**!\n\n` +
                                        '**Start the new story now by typing the first word below!**'
                                    )
                                    .setColor('#7c3aed')
                                    .setFooter({ text: 'Nora One Word Story Game — Auto-Restart' })
                                    .setTimestamp();

                                const row = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`onewordstory_end_btn_${channelId}`)
                                        .setLabel('End Story')
                                        .setStyle(ButtonStyle.Danger)
                                );

                                const channel = await client.channels.fetch(channelId).catch(() => null);
                                if (channel) {
                                    await channel.send({ embeds: [startEmbed], components: [row] }).catch(() => {});
                                }
                            } catch (err) {
                                console.error('[One Word Story Auto-Restart Error]:', err);
                            }
                        }, 5000);
                    }
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
