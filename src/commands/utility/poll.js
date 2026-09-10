const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { handleError } = require('../../utils/embeds');

const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function generateProgressBar(count, total, size = 10) {
    if (total <= 0) return '`░░░░░░░░░░` 0%';
    const percentage = Math.min(100, Math.max(0, Math.round((count / total) * 100)));
    const filled = Math.round((percentage / 100) * size);
    const empty = size - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `\`${bar}\` **${percentage}%**`;
}

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create community polls, view live standings, or lock poll results.')
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Create a poll with up to 10 choices.')
                .addStringOption(opt =>
                    opt.setName('question')
                        .setDescription('The question or topic of the poll')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('options')
                        .setDescription('Comma-separated list of choices (e.g. Yes, No, Maybe)')
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to send the poll to (default: current channel)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('End a poll and lock in final vote results.')
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('The ID of the poll message in this channel')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('results')
                .setDescription('View a live vote tally for an active poll.')
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('The ID of the active poll message')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        // -------------------------------------------------------------
        // Subcommand: CREATE
        // -------------------------------------------------------------
        if (subcommand === 'create') {
            const question = interaction.options.getString('question');
            const optionsStr = interaction.options.getString('options');
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

            const choices = optionsStr
                .split(',')
                .map(c => c.trim())
                .filter(c => c.length > 0);

            if (choices.length < 2 || choices.length > 10) {
                return interaction.reply({
                    content: 'A poll must contain between **2** and **10** choices separated by commas.',
                    ephemeral: true
                });
            }

            let description = '';
            for (let i = 0; i < choices.length; i++) {
                description += `${numberEmojis[i]} **${choices[i]}**\n\n`;
            }

            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: `Poll • ${interaction.guild.name}`, 
                    iconURL: interaction.guild.iconURL() 
                })
                .setTitle(question)
                .setDescription(description.trim())
                .setColor(0x5865F2)
                .setFooter({
                    text: `Created by ${interaction.user.tag} • React below to vote`
                })
                .setTimestamp();

            try {
                if (targetChannel.id !== interaction.channel.id) {
                    const pollMsg = await targetChannel.send({ embeds: [embed] });
                    for (let i = 0; i < choices.length; i++) {
                        await pollMsg.react(numberEmojis[i]);
                    }
                    return interaction.reply({
                        content: `Poll created in <#${targetChannel.id}>. [Jump to Poll](${pollMsg.url})`,
                        ephemeral: true
                    });
                } else {
                    const pollMsg = await interaction.reply({ embeds: [embed], fetchReply: true });
                    for (let i = 0; i < choices.length; i++) {
                        await pollMsg.react(numberEmojis[i]);
                    }
                }
            } catch (error) {
                console.error('[Poll Create Error]:', error);
                return interaction.reply({
                    content: 'Failed to create the poll. Please verify my permissions to send embeds and add reactions in that channel.',
                    ephemeral: true
                });
            }
        }

        // -------------------------------------------------------------
        // Subcommand: END or RESULTS
        // -------------------------------------------------------------
        if (subcommand === 'end' || subcommand === 'results') {
            await interaction.deferReply({ ephemeral: subcommand === 'results' }).catch(() => {});
            const messageId = interaction.options.getString('message_id');

            if (subcommand === 'end' && !interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                return handleError(interaction, 'Missing Permissions', 'You need the **Manage Messages** permission to close polls.');
            }

            try {
                const message = await interaction.channel.messages.fetch(messageId).catch(() => null);

                if (!message) {
                    return handleError(interaction, 'Message Not Found', 'Could not locate a message with that ID in this channel.');
                }

                if (message.author.id !== interaction.client.user.id || message.embeds.length === 0) {
                    return handleError(interaction, 'Invalid Poll', 'The specified message is not a valid poll created by Nora.');
                }

                const pollEmbed = message.embeds[0];
                const question = pollEmbed.title || 'Poll';
                const originalDesc = pollEmbed.description || '';

                // Parse option labels
                const lines = originalDesc.split('\n\n').map(l => l.trim()).filter(Boolean);
                const optionMap = {};
                lines.forEach(line => {
                    for (let i = 0; i < numberEmojis.length; i++) {
                        if (line.startsWith(numberEmojis[i])) {
                            optionMap[numberEmojis[i]] = line.replace(numberEmojis[i], '').trim().replace(/^\*\*|\*\*$/g, '');
                        }
                    }
                });

                const reactions = message.reactions.cache;
                const results = [];

                for (let i = 0; i < numberEmojis.length; i++) {
                    const emoji = numberEmojis[i];
                    const reaction = reactions.get(emoji);
                    if (reaction) {
                        const count = Math.max(0, reaction.count - 1);
                        results.push({ 
                            emoji, 
                            label: optionMap[emoji] || `Option ${i + 1}`,
                            count 
                        });
                    }
                }

                if (results.length === 0) {
                    return handleError(interaction, 'No Vote Data', 'No valid poll vote reactions were detected on that message.');
                }

                const totalVotes = results.reduce((sum, r) => sum + r.count, 0);

                let resultsDescription = '';
                results.forEach(res => {
                    const bar = generateProgressBar(res.count, totalVotes);
                    resultsDescription += `${res.emoji} **${res.label}**\n${bar} (${res.count.toLocaleString()} votes)\n\n`;
                });

                resultsDescription += `Total Votes Cast: **${totalVotes.toLocaleString()}**`;

                const resultEmbed = new EmbedBuilder()
                    .setTitle(`${subcommand === 'end' ? 'Final Results' : 'Live Standings'}: ${question}`)
                    .setDescription(resultsDescription.trim())
                    .setColor(subcommand === 'end' ? 0x57F287 : 0x5865F2)
                    .setFooter({ 
                        text: subcommand === 'end' ? `Closed by ${interaction.user.tag}` : `Requested by ${interaction.user.tag}` 
                    })
                    .setTimestamp();

                if (subcommand === 'end') {
                    const lockedEmbed = EmbedBuilder.from(pollEmbed)
                        .setTitle(`[Closed] ${question}`)
                        .setColor(0x4F545C)
                        .setFooter({ text: `Poll closed by ${interaction.user.tag}` });

                    await message.edit({ embeds: [lockedEmbed] }).catch(() => {});
                    await message.reactions.removeAll().catch(() => {});

                    await interaction.channel.send({ embeds: [resultEmbed] });
                    return interaction.editReply({ content: 'Poll closed and final results posted.' });
                } else {
                    return interaction.editReply({ embeds: [resultEmbed] });
                }

            } catch (err) {
                console.error('[Poll Action Error]:', err);
                return handleError(interaction, 'Error', 'An unexpected error occurred while processing the poll.');
            }
        }
    }
};
