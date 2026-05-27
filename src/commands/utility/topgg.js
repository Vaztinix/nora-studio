const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const { hasVoted } = require('../../utils/topgg');

const NORA_BOT_ID = '1375943730951098549';
const NORA_V0 = 'process.env.TOPGG_TOKEN || process.env.NORA_V0 || ''';

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('topgg')
        .setDescription('Top.gg integration commands. (Beta)')
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('View Nora\'s official listing stats on Top.gg. (Beta)')
        )
        .addSubcommand(sub =>
            sub.setName('info')
                .setDescription('Get info on how to vote, voting perks, and check your voting status. (Beta)')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply();

        if (subcommand === 'stats') {
            try {
                const response = await axios.get(`https://top.gg/api/bots/${NORA_BOT_ID}`, {
                    headers: { 'Authorization': NORA_V0 },
                    timeout: 5000
                });
                
                const data = response.data;
                const serverCount = data.server_count || interaction.client.guilds.cache.size;
                const points = data.points || 0;
                const monthlyPoints = data.monthlyPoints || 0;
                const owners = data.owners ? data.owners.join(', ') : 'Unknown';

                const embed = new EmbedBuilder()
                    .setTitle('Nora • Top.gg Listing Statistics (Beta)')
                    .setURL(`https://top.gg/bot/${NORA_BOT_ID}`)
                    .setDescription(data.shortdesc || 'No description available.')
                    .addFields(
                        { name: 'Server Count', value: `\`${serverCount.toLocaleString()}\` servers`, inline: true },
                        { name: 'Total Votes', value: `\`${points.toLocaleString()}\` votes`, inline: true },
                        { name: 'Monthly Votes', value: `\`${monthlyPoints.toLocaleString()}\` votes`, inline: true },
                        { name: 'Tags', value: data.tags ? data.tags.join(', ') : 'None', inline: false }
                    )
                    .setColor(0xFF0055)
                    .setThumbnail(interaction.client.user.displayAvatarURL())
                    .setFooter({ text: 'Powered by Top.gg API' })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });

            } catch (err) {
                console.error('Top.gg Stats Command Error:', err);
                
                try {
                    const devChannel = await interaction.client.channels.fetch('1484684098994835579').catch(() => null);
                    if (devChannel) {
                        await devChannel.send({
                            content: `🚨 **Top.gg Stats Fetch Failure**\n**Error:** \`${err.message}\`\n**User:** ${interaction.user.tag} (${interaction.user.id})`
                        });
                    }
                } catch (e) {}

                const is404 = err.response && err.response.status === 404;
                const serverCount = interaction.client.guilds.cache.size;
                const totalUsers = interaction.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);

                const fallbackEmbed = new EmbedBuilder()
                    .setTitle('Nora • Top.gg Listing Statistics (Local Fallback) (Beta)')
                    .setURL(`https://top.gg/bot/${NORA_BOT_ID}`)
                    .setDescription(is404
                        ? '**Top.gg API returned 404 Not Found.** This bot is currently running in local/private development mode. The Top.gg listing is not public or approved yet.'
                        : `**Failed to reach Top.gg API (${err.message}).** Displaying local cache statistics.`)
                    .addFields(
                        { name: 'Local Server Count', value: `\`${serverCount.toLocaleString()}\` servers`, inline: true },
                        { name: 'Local User Count', value: `\`${totalUsers.toLocaleString()}\` users`, inline: true },
                        { name: 'WS Latency', value: `\`${interaction.client.ws.ping}ms\``, inline: true },
                        { name: 'Listing Status', value: is404 ? '`Unlisted / Pending Approval`' : '`API Timeout/Down`', inline: false }
                    )
                    .setColor(0xFF0055)
                    .setThumbnail(interaction.client.user.displayAvatarURL())
                    .setFooter({ text: 'Local telemetry active' })
                    .setTimestamp();

                await interaction.editReply({ embeds: [fallbackEmbed] });
            }
        }

        if (subcommand === 'info') {
            let voted = false;
            try {
                voted = await hasVoted(interaction.user.id);
            } catch (err) {
                console.error('Top.gg hasVoted check inside /topgg info failed:', err);
            }

            const embed = new EmbedBuilder()
                .setTitle('Support Nora on Top.gg (Beta)')
                .setDescription('Help Nora grow by voting! Voting helps other servers discover Nora and unlocks awesome rewards.')
                .addFields(
                    { name: 'Voter Perks', value: '• **Double XP Boost** (2 Hours)\n• **100 XP** added directly to your leveling profile\n• **Supporter Title** eligibility\n• Logs your vote to the server\'s vote tracking channel' },
                    { name: 'Your Current Status', value: voted ? '**You have voted today!** Thank you for your support.' : '**You have not voted in the last 12 hours.**' }
                )
                .setColor(voted ? 0x2ea043 : 0xFF0055)
                .setFooter({ text: 'You can vote once every 12 hours!' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Vote on Top.gg')
                    .setURL(`https://top.gg/bot/${NORA_BOT_ID}/vote`)
                    .setStyle(ButtonStyle.Link),
                new ButtonBuilder()
                    .setCustomId('check_vote_topgg')
                    .setLabel('Refresh Status')
                    .setStyle(ButtonStyle.Secondary)
            );

            const response = await interaction.editReply({ embeds: [embed], components: [row] });

            const collector = response.createMessageComponentCollector({ time: 60000 });
            collector.on('collect', async i => {
                if (i.customId === 'check_vote_topgg') {
                    await i.deferUpdate();
                    let updatedVote = false;
                    try {
                        updatedVote = await hasVoted(i.user.id);
                    } catch (error) {
                        return i.editReply({ content: 'Top.gg API is currently unreachable. Please try again later.', embeds: [], components: [] });
                    }
                    
                    if (updatedVote) {
                        try {
                            const UserLevel = require('../../database/models/UserLevel');
                            if (i.guildId) {
                                const [uData] = await UserLevel.findOrCreate({ where: { userId: i.user.id, guildId: i.guildId } });
                                uData.xp += 100;
                                await uData.save();
                            }
                        } catch (e) {}
                    }
                    
                    embed.setDescription(updatedVote 
                        ? '**Update:** Vote detected! 100 XP has been allocated to your profile along with other voter bonuses.'
                        : '**Update:** No vote detected yet. Please ensure you have finalized the vote on the Top.gg page.');
                    embed.setColor(updatedVote ? 0x2ea043 : 0xff0000);
                    embed.setFields(
                        { name: 'Voter Perks', value: '• **Double XP Boost** (2 Hours)\n• **100 XP** added directly to your leveling profile\n• **Supporter Title** eligibility\n• Logs your vote to the server\'s vote tracking channel' },
                        { name: 'Your Current Status', value: updatedVote ? '**You have voted today!** Thank you for your support.' : '**You have not voted in the last 12 hours.**' }
                    );
                    
                    await i.editReply({ embeds: [embed] });
                }
            });
        }
    }
};
