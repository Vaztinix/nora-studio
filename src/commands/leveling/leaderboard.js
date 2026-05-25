const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'leveling',
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the most active users in the server.')
        .addIntegerOption(option => 
            option.setName('page')
            .setDescription('Page number to view (10 users per page)')
            .setMinValue(1))
        .setContexts(0)
        .setIntegrationTypes(0)
        .setDMPermission(false)
        .setDefaultMemberPermissions(null),
    
    async execute(interaction) {
        const page = interaction.options.getInteger('page') || 1;
        const usersPerPage = 10;
        const offset = (page - 1) * usersPerPage;

        const { count, rows: topUsers } = await UserLevel.findAndCountAll({
            where: { guildId: interaction.guild.id },
            order: [['totalXp', 'DESC']],
            limit: usersPerPage,
            offset: offset
        });

        if (!topUsers || topUsers.length === 0) {
            return handleError(interaction, 'Empty Leaderboard', 'No one has gained any XP yet. Be the first!');
        }

        let leaderboardText = '';
        for (let i = 0; i < topUsers.length; i++) {
            const u = topUsers[i];
            const rank = offset + i + 1;
            leaderboardText += `**${rank}.** <@${u.userId}> - Level ${u.level} (${u.totalXp.toLocaleString()} XP)\n`;
        }

        // Find calling user's rank
        const allUsers = await UserLevel.findAll({
            where: { guildId: interaction.guild.id },
            order: [['totalXp', 'DESC']]
        });
        const callerRank = allUsers.findIndex(u => u.userId === interaction.user.id) + 1;
        const callerInfo = allUsers.find(u => u.userId === interaction.user.id);

        const totalPages = Math.ceil(count / usersPerPage);
        
        const embed = new EmbedBuilder()
            .setTitle(`Server Leaderboard - ${interaction.guild.name}`)
            .setColor(0x57acf2)
            .setDescription(leaderboardText)
            .addFields(
                { name: 'Your Stats', value: callerInfo ? `Rank: **#${callerRank}** | Level: **${callerInfo.level}** | XP: **${callerInfo.totalXp.toLocaleString()}**` : 'Rank: **Unknown** (Send some messages to earn XP!)', inline: false }
            )
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
            .setFooter({ text: `Page ${page} of ${totalPages} | Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
