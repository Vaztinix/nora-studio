const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('poll-end')
        .setDescription('End a poll by locking in the final results')
        .addStringOption(option =>
            option.setName('message_id')
                .setDescription('The ID of the poll message')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const messageId = interaction.options.getString('message_id');

        try {
            const message = await interaction.channel.messages.fetch(messageId).catch(() => null);

            if (!message) {
                return await handleError(interaction, 'Message Not Found', 'Could not find a message with that ID in this channel.');
            }

            if (message.author.id !== interaction.client.user.id || message.embeds.length === 0) {
                return await handleError(interaction, 'Invalid Poll Message', 'The specified message is not a valid poll created by me.');
            }

            const pollEmbed = message.embeds[0];
            const question = pollEmbed.title;

            // Gather reactions and calculate tallies
            const reactions = message.reactions.cache;
            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            const results = [];

            for (const emoji of emojis) {
                const reaction = reactions.get(emoji);
                if (reaction) {
                    // Subtract 1 to account for the bot's own reaction
                    const count = Math.max(0, reaction.count - 1);
                    results.push({ emoji, count });
                }
            }

            if (results.length === 0) {
                return await handleError(interaction, 'No Data', 'No valid poll reactions were found on that message.');
            }

            const totalVotes = results.reduce((sum, r) => sum + r.count, 0);

            let resultsDescription = '';
            for (const res of results) {
                const percentage = totalVotes > 0 ? ((res.count / totalVotes) * 100).toFixed(1) : 0;
                resultsDescription += `${res.emoji}: ${res.count} vote(s) (${percentage}%)\n\n`;
            }

            resultsDescription += `Total Votes: ${totalVotes}`;

            const resultEmbed = new EmbedBuilder()
                .setTitle(`Poll Results: ${question}`)
                .setDescription(resultsDescription)
                .setColor(0x57acf2)
                .setFooter({ text: 'Poll locked' })
                .setTimestamp();

            // Edit the original poll embed to indicate it's ended
            const lockedEmbed = EmbedBuilder.from(pollEmbed)
                .setTitle(`Poll Closed: ${question}`)
                .setFooter({ text: 'Poll ended and results locked' });

            await message.edit({ embeds: [lockedEmbed] }).catch(() => {});
            await message.reactions.removeAll().catch(() => {});

            // Post results publicly in the channel
            await interaction.channel.send({ embeds: [resultEmbed] });

            // Reply to interaction
            return await interaction.editReply({ content: 'Poll has been successfully ended and results compiled.' });
        } catch (err) {
            console.error('Error ending poll:', err);
            return await handleError(interaction, 'Error', 'An error occurred while attempting to end the poll.');
        }
    }
};
