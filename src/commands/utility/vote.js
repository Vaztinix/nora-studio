const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasVoted } = require('../../utils/topgg');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Support Nora by voting on Top.gg.'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // We check voting status
        const voted = await hasVoted(interaction.user.id);
        
        const embed = new EmbedBuilder()
            .setTitle('Support Nora')
            .setDescription(voted 
                ? '✅ **Thank you!** You have already voted for Nora on Top.gg.' 
                : '❌ **No vote detected.** Support Nora on Top.gg to unlock global XP rewards!')
            .setColor(voted ? 0x43b581 : 0x57acf2)
            .addFields(
                { name: 'Global Rewards', value: '• +50 XP added to your Nora profile\n• Premium Support access\n• Dynamic Badge eligibility', inline: false }
            )
            .setFooter({ text: 'Nora Support Engine 2026' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Vote on Top.gg')
                .setURL('https://top.gg/bot/1375943730951098549/vote')
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setCustomId('check_vote')
                .setLabel('Refresh Status')
                .setStyle(ButtonStyle.Secondary)
        );

        const response = await interaction.editReply({ embeds: [embed], components: [row] });

        const collector = response.createMessageComponentCollector({ time: 60000 });
        collector.on('collect', async i => {
            if (i.customId === 'check_vote') {
                await i.deferUpdate();
                const updatedVote = await hasVoted(i.user.id);
                
                embed.setDescription(updatedVote 
                    ? '✅ **Update:** Vote detected! 50 XP has been allocated to your profile.'
                    : '❌ **Update:** No vote detected yet. Please ensure you have finalized the vote on the Top.gg page.');
                embed.setColor(updatedVote ? 0x43b581 : 0xff0000);
                
                await i.editReply({ embeds: [embed] });
            }
        });
    },
};
