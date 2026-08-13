const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const oneWordStoryManager = require('../../utils/oneWordStoryManager');
const settingsCache = require('../../utils/settingsCache');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'fun',
    ephemeral: false,
    data: new SlashCommandBuilder()
        .setName('onewordstory')
        .setDescription('Collaborative one-word-at-a-time story game.')
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('Start a new One Word Story game session.')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to start the game in (defaults to current channel)')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('End the active story game session and display the full completed story.')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel of the game to end (defaults to current channel)')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('story')
                .setDescription('View the current story in progress.')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to view story from (defaults to current channel)')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('rules')
                .setDescription('View the rules of One Word Story.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const settings = await settingsCache.get(interaction.guild.id);

        if (!settings || settings.oneWordStoryEnabled === false) {
            return await handleError(
                interaction,
                'Feature Disabled',
                'The One Word Story game is currently disabled on this server. An administrator can enable it via `/setup` or the website dashboard.'
            );
        }

        const targetChannel = interaction.options.getChannel('channel') || 
            (settings.oneWordStoryChannelId ? interaction.guild.channels.cache.get(settings.oneWordStoryChannelId) : null) || 
            interaction.channel;

        if (subcommand === 'start') {
            const result = await oneWordStoryManager.startGame(interaction.guild.id, targetChannel.id, interaction.user.id);
            if (!result.success) {
                return await handleError(interaction, 'Game Already Active', result.error);
            }

            const allowConsecutive = !!settings.oneWordStoryAllowConsecutive;
            const maxSentences = settings.oneWordStoryMaxSentences || 10;

            const startEmbed = new EmbedBuilder()
                .setTitle('📖 One Word Story — Game Started!')
                .setDescription(
                    `A new story has begun in <#${targetChannel.id}>!\n\n` +
                    '**Rules:**\n' +
                    '1️⃣ Send **exactly ONE word** per message.\n' +
                    `2️⃣ ${allowConsecutive ? 'Consecutive turns allowed.' : 'You **cannot** post twice in a row — wait for someone else!'}\n` +
                    '3️⃣ No mentions (`@everyone`/`<@user>`), links, or commands.\n' +
                    '4️⃣ Add a period (`.`) at the end of a word or as a single message to **complete a sentence** (reacts with 📝).\n' +
                    `5️⃣ Story automatically finishes and compiles after **${maxSentences} sentences**!\n\n` +
                    '**Start the story now by typing the first word below!**'
                )
                .setColor('#7c3aed')
                .setFooter({ text: 'Nora One Word Story Game' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`onewordstory_end_btn_${targetChannel.id}`)
                    .setLabel('End Story')
                    .setStyle(ButtonStyle.Danger)
            );

            if (targetChannel.id !== interaction.channel.id) {
                await targetChannel.send({ embeds: [startEmbed], components: [row] }).catch(() => {});
                return await handleSuccess(interaction, 'Game Started', `One Word Story started in <#${targetChannel.id}>!`);
            } else {
                return await interaction.reply({ embeds: [startEmbed], components: [row] });
            }
        }

        if (subcommand === 'end') {
            const activeGame = await oneWordStoryManager.getActiveGame(targetChannel.id);
            if (!activeGame) {
                return await handleError(interaction, 'No Active Game', `There is no active One Word Story game in <#${targetChannel.id}>.`);
            }

            const isStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
            const isCreator = activeGame.startedBy === interaction.user.id;
            if (!isStaff && !isCreator) {
                return await handleError(interaction, 'Permission Denied', 'Only server staff (Manage Server) or the user who started the game can end it.');
            }

            const result = await oneWordStoryManager.endGame(interaction.guild.id, targetChannel.id);
            if (!result.success) {
                return await handleError(interaction, 'Error Ending Game', result.error);
            }

            const topList = result.topContributors.slice(0, 5).map((c, idx) => `${idx + 1}. **${c.username}**: ${c.count} words`).join('\n') || 'None';

            const endEmbed = new EmbedBuilder()
                .setTitle('📖 One Word Story Completed!')
                .setDescription(`**Completed Story:**\n>>> ${result.story}`)
                .setColor('#00b4d8')
                .addFields(
                    { name: 'Total Words', value: `${result.wordCount}`, inline: true },
                    { name: 'Total Sentences', value: `${result.sentenceCount || 0}`, inline: true },
                    { name: 'Contributors', value: `${result.contributorsCount}`, inline: true },
                    { name: 'Top Authors', value: topList, inline: false }
                )
                .setFooter({ text: `Ended by ${interaction.user.tag}` })
                .setTimestamp();

            return await interaction.reply({ embeds: [endEmbed] });
        }

        if (subcommand === 'story') {
            const activeGame = await oneWordStoryManager.getActiveGame(targetChannel.id);
            if (!activeGame) {
                return await handleError(interaction, 'No Story in Progress', `There is no active One Word Story game in <#${targetChannel.id}>.`);
            }

            const storyText = await oneWordStoryManager.getStoryFormatted(targetChannel.id);
            const maxSentences = settings.oneWordStoryMaxSentences || 10;

            const storyEmbed = new EmbedBuilder()
                .setTitle('📖 One Word Story in Progress')
                .setDescription(`**Current Story:**\n>>> ${storyText}`)
                .setColor('#57acf2')
                .addFields(
                    { name: 'Word Count', value: `${activeGame.words.length}`, inline: true },
                    { name: 'Sentences Completed', value: `${activeGame.sentenceCount || 0} / ${maxSentences}`, inline: true },
                    { name: 'Last Contributor', value: activeGame.lastUserId ? `<@${activeGame.lastUserId}>` : 'None', inline: true }
                )
                .setFooter({ text: 'Nora One Word Story Game' })
                .setTimestamp();

            return await interaction.reply({ embeds: [storyEmbed] });
        }

        if (subcommand === 'rules') {
            const maxSentences = settings.oneWordStoryMaxSentences || 10;
            const rulesEmbed = new EmbedBuilder()
                .setTitle('📖 One Word Story — Rules')
                .setDescription(
                    '**How to play:**\n' +
                    '• Type **one word at a time** in chat.\n' +
                    '• Work together with other members to build an epic, funny, or crazy story!\n\n' +
                    '**Game Rules:**\n' +
                    '1. Exactly **1 word** per message.\n' +
                    '2. No consecutive messages by the same player (unless configured).\n' +
                    '3. No `@everyone`, user mentions, links, or bot commands.\n' +
                    '4. End a sentence by adding a period (`.`) to a word or as a single message (reacts with 📝).\n' +
                    `5. Once **${maxSentences} sentences** are completed, Nora puts the entire story together and posts it!\n` +
                    '6. Anyone with Manage Server or the game host can also run `/onewordstory end` to finish early.'
                )
                .setColor('#7c3aed');

            return await interaction.reply({ embeds: [rulesEmbed], ephemeral: true });
        }
    }
};
