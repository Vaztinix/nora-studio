const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
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

        const GuildSettings = require('../../database/models/GuildSettings');
        const settings = await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });

        // Defer reply
        await interaction.deferReply();

        if (settings?.levelingUseImages === false) {
            let leaderboardText = '';
            for (let i = 0; i < topUsers.length; i++) {
                const u = topUsers[i];
                const rank = offset + i + 1;
                leaderboardText += `**${rank}.** <@${u.userId}> - Level **${u.level || 0}** (${(u.totalXp || 0).toLocaleString()} XP)\n`;
            }
            const allUsers = await UserLevel.findAll({
                where: { guildId: interaction.guild.id },
                order: [['totalXp', 'DESC']]
            });
            const callerRank = allUsers.findIndex(u => u.userId === interaction.user.id) + 1;
            const callerInfo = allUsers.find(u => u.userId === interaction.user.id);
            const statsText = callerInfo 
                ? `Your Stats: Rank **#${callerRank}** | Level **${callerInfo.level}** | XP **${callerInfo.totalXp.toLocaleString()}**`
                : `Your Stats: Rank **Unknown** (Send some messages to earn XP!)`;

            const totalPages = Math.ceil(count / usersPerPage);
            const embed = new EmbedBuilder()
                .setTitle(`Server Leaderboard - ${interaction.guild.name}`)
                .setColor(0x57acf2)
                .setDescription(leaderboardText || 'No users found on this page.')
                .addFields({ name: 'Your Progress', value: statsText })
                .setFooter({ text: `Page ${page} of ${totalPages || 1}` })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        try {
            const resolvedUsers = [];
            for (let i = 0; i < topUsers.length; i++) {
                const u = topUsers[i];
                const rank = offset + i + 1;
                const member = await interaction.guild.members.fetch(u.userId).catch(() => null);
                resolvedUsers.push({
                    userId: u.userId,
                    username: member ? member.user.username : `User ${u.userId}`,
                    avatarUrl: member ? member.user.displayAvatarURL({ extension: 'png', size: 128 }) : null,
                    level: u.level || 0,
                    totalXp: u.totalXp || 0,
                    rank: rank
                });
            }

            // Find calling user's rank
            const allUsers = await UserLevel.findAll({
                where: { guildId: interaction.guild.id },
                order: [['totalXp', 'DESC']]
            });
            const callerRank = allUsers.findIndex(u => u.userId === interaction.user.id) + 1;
            const callerInfo = allUsers.find(u => u.userId === interaction.user.id);

            const totalPages = Math.ceil(count / usersPerPage);

            const { generateLeaderboard } = require('../../utils/leaderboardGenerator');
            const imageBuffer = await generateLeaderboard({
                guildName: interaction.guild.name,
                page: page,
                totalPages: totalPages,
                users: resolvedUsers
            });

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'leaderboard.png' });

            const statsText = callerInfo 
                ? `Your Stats: Rank **#${callerRank}** | Level **${callerInfo.level}** | XP **${callerInfo.totalXp.toLocaleString()}**`
                : `Your Stats: Rank **Unknown** (Send some messages to earn XP!)`;

            await interaction.editReply({ 
                content: statsText,
                files: [attachment] 
            });
        } catch (err) {
            console.error('Error rendering leaderboard image:', err);
            let leaderboardText = '';
            for (let i = 0; i < topUsers.length; i++) {
                const u = topUsers[i];
                const rank = offset + i + 1;
                leaderboardText += `**${rank}.** <@${u.userId}> - Level ${u.level} (${u.totalXp.toLocaleString()} XP)\n`;
            }
            const totalPages = Math.ceil(count / usersPerPage);
            const embed = new EmbedBuilder()
                .setTitle(`Server Leaderboard - ${interaction.guild.name}`)
                .setColor(0x57acf2)
                .setDescription(leaderboardText)
                .setFooter({ text: `Page ${page} of ${totalPages}` });
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
