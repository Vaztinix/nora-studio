const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'leveling',
    noAutoDefer: true,
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the most active users in the server with rankings and XP progression.')
        .addIntegerOption(option => 
            option.setName('page')
            .setDescription('Page number to view (10 users per page)')
            .setMinValue(1))
        .setContexts(0)
        .setIntegrationTypes(0)
        .setDMPermission(false)
        .setDefaultMemberPermissions(null),
    
    async execute(interaction) {
        let currentPage = interaction.options.getInteger('page') || 1;
        const usersPerPage = 10;

        const renderPage = async (pg) => {
            const offset = (pg - 1) * usersPerPage;
            const { count, rows: topUsers } = await UserLevel.findAndCountAll({
                where: { guildId: interaction.guild.id },
                order: [['totalXp', 'DESC']],
                limit: usersPerPage,
                offset: offset
            });

            const totalPages = Math.max(1, Math.ceil(count / usersPerPage));
            const clampedPage = Math.min(Math.max(1, pg), totalPages);

            // Fetch caller rank
            const callerInfo = await UserLevel.findOne({
                where: { userId: interaction.user.id, guildId: interaction.guild.id }
            });
            const callerXp = callerInfo ? (callerInfo.totalXp || 0) : 0;
            const callerRank = callerInfo
                ? (await UserLevel.count({
                    where: { guildId: interaction.guild.id, totalXp: { [require('sequelize').Op.gt]: callerXp } }
                  })) + 1
                : 'Unranked';

            // Fast parallel fetch for top 10 member usernames/avatars
            const userIds = topUsers.map(u => u.userId);
            const memberMap = new Map();
            try {
                const fetchedMembers = await interaction.guild.members.fetch({ user: userIds }).catch(() => null);
                if (fetchedMembers) {
                    fetchedMembers.forEach(m => memberMap.set(m.id, m));
                }
            } catch (e) {}

            const resolvedUsers = topUsers.map((u, idx) => {
                const member = memberMap.get(u.userId) || interaction.guild.members.cache.get(u.userId);
                const rank = offset + idx + 1;
                return {
                    userId: u.userId,
                    username: member ? member.user.username : `User ${u.userId.slice(-4)}`,
                    avatarUrl: member ? member.user.displayAvatarURL({ extension: 'png', size: 128 }) : null,
                    level: u.level || 0,
                    totalXp: u.totalXp || 0,
                    rank: rank
                };
            });

            const paginationRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`lb_prev_${clampedPage}`)
                    .setLabel('◀ Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(clampedPage <= 1),
                new ButtonBuilder()
                    .setCustomId(`lb_page_indicator`)
                    .setLabel(`Page ${clampedPage} / ${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`lb_next_${clampedPage}`)
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(clampedPage >= totalPages)
            );

            const statsText = callerInfo 
                ? `🏆 **Your Stats:** Rank **#${callerRank}** | Level **${callerInfo.level || 0}** | **${callerXp.toLocaleString()} XP**`
                : `🏆 **Your Stats:** Rank **Unranked** (Chat to earn XP!)`;

            // Try image render with timeout safeguard
            try {
                const GuildSettings = require('../../database/models/GuildSettings');
                const settings = await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });

                if (settings?.levelingUseImages !== false) {
                    const { generateLeaderboard } = require('../../utils/leaderboardGenerator');
                    const imageBuffer = await Promise.race([
                        generateLeaderboard({
                            guildName: interaction.guild.name,
                            page: clampedPage,
                            totalPages: totalPages,
                            users: resolvedUsers,
                            bgColor: settings?.levelingCardBgColor || '#111217',
                            accentColor: settings?.levelingCardAccentColor || '#7c3aed',
                            borderColor: settings?.levelingCardBorderColor || '#23252e'
                        }),
                        new Promise((_, r) => setTimeout(() => r(new Error('Image render timeout')), 5000))
                    ]);

                    const { AttachmentBuilder } = require('discord.js');
                    const attachment = new AttachmentBuilder(imageBuffer, { name: `leaderboard-p${clampedPage}.png` });
                    const embed = new EmbedBuilder()
                        .setTitle(`🏆 Server XP Leaderboard — ${interaction.guild.name}`)
                        .setColor(0x7C3AED)
                        .setImage(`attachment://leaderboard-p${clampedPage}.png`)
                        .setFooter({ text: `Page ${clampedPage} of ${totalPages} • Total Members Tracked: ${count}` })
                        .setTimestamp();

                    return {
                        content: statsText,
                        embeds: [embed],
                        files: [attachment],
                        components: [paginationRow]
                    };
                }
            } catch (imgErr) {
                console.warn('[Leaderboard] Image generation fallback to Embed:', imgErr.message);
            }

            // Rich Embed Fallback
            let leaderboardText = resolvedUsers.length > 0
                ? resolvedUsers.map(u => {
                    const medal = u.rank === 1 ? '🥇' : u.rank === 2 ? '🥈' : u.rank === 3 ? '🥉' : `**#${u.rank}**`;
                    return `${medal} <@${u.userId}> — Level **${u.level}** (${u.totalXp.toLocaleString()} XP)`;
                  }).join('\n')
                : '*No XP recorded in this server yet.*';

            const embed = new EmbedBuilder()
                .setTitle(`🏆 Server XP Leaderboard — ${interaction.guild.name}`)
                .setColor(0x57acf2)
                .setDescription(leaderboardText)
                .addFields({ name: 'Your Progress', value: statsText })
                .setFooter({ text: `Page ${clampedPage} of ${totalPages} • Total Members Tracked: ${count}` })
                .setTimestamp();

            return {
                embeds: [embed],
                components: [paginationRow]
            };
        };

        const initialPayload = await renderPage(currentPage);
        const responseMsg = await interaction.reply(initialPayload);

        // Interactive Button Collector (60s active duration)
        if (responseMsg && typeof responseMsg.createMessageComponentCollector === 'function') {
            const collector = responseMsg.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ content: '❌ Only the command initiator can navigate pages.', ephemeral: true });
                }

                if (i.customId.startsWith('lb_prev_')) {
                    currentPage = Math.max(1, currentPage - 1);
                } else if (i.customId.startsWith('lb_next_')) {
                    currentPage++;
                }

                await i.deferUpdate().catch(() => {});
                const updatedPayload = await renderPage(currentPage);
                await interaction.editReply(updatedPayload).catch(() => {});
            });

            collector.on('end', async () => {
                // Disable pagination buttons when collector expires
                try {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('prev_dis').setLabel('◀ Previous').setStyle(ButtonStyle.Primary).setDisabled(true),
                        new ButtonBuilder().setCustomId('page_dis').setLabel(`Leaderboard Expired`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId('next_dis').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(true)
                    );
                    await interaction.editReply({ components: [disabledRow] }).catch(() => {});
                } catch (e) {}
            });
        }
    },
};

