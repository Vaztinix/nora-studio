const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleError } = require('../../utils/embeds');
// Rank command implementation
module.exports = {
    category: 'leveling',
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription("Check your or another user's rank with a beautiful card.")
        .addUserOption(option => option.setName('target').setDescription('The user to check'))
        .setContexts(0)
        .setIntegrationTypes(0)
        .setDMPermission(false)
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const { checkAndAwardEgg } = require('../../utils/easterEggSystem');
        checkAndAwardEgg(interaction, 9);

        const target = interaction.options.getUser('target') || interaction.user;
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        // We only exclude Nora herself from the rank system to avoid self-tracking.
        if (target.id === interaction.client.user.id) {
            return handleError(interaction, 'Nora is Supreme', 'I do not have a rank profile; I am simply here to assist you!');
        }

        const userLevel = await UserLevel.findOne({
            where: { userId: target.id, guildId: interaction.guild.id }
        });

        const guildUsers = await UserLevel.findAll({
            where: { guildId: interaction.guild.id },
            order: [['totalXp', 'DESC']]
        });

        let currentLevel = 0;
        let totalXpRaw = 0;
        let xpProgressInLevel = 0;
        let xpStepForLevelIncrement = 100;
        let progressPercentage = 0;
        let rankIndex = guildUsers.length + 1;
        const totalUsers = guildUsers.length;
        const hasNoXp = !userLevel;

        const { getTotalXPForLevel } = require('../../utils/noraLeveling');

        if (userLevel) {
            currentLevel = userLevel.level || 0;
            totalXpRaw = userLevel.totalXp || 0;
            const xpFloorForCurrentLevel = getTotalXPForLevel(currentLevel);
            const xpGoalForNextLevel = getTotalXPForLevel(currentLevel + 1);

            xpProgressInLevel = totalXpRaw - xpFloorForCurrentLevel;
            xpStepForLevelIncrement = xpGoalForNextLevel - xpFloorForCurrentLevel;
            progressPercentage = Math.min(100, Math.max(0, (xpProgressInLevel / xpStepForLevelIncrement) * 100));
            rankIndex = guildUsers.findIndex(u => u.userId === target.id) + 1;
        } else {
            try {
                xpStepForLevelIncrement = getTotalXPForLevel(1);
            } catch (e) {
                xpStepForLevelIncrement = 100;
            }
        }

        const { isPremium } = require('../../utils/premiumManager');
        const viewerIsPremium = isPremium(interaction);
        const targetIsPremium = (userLevel && userLevel.isPremium) || (target.id === interaction.user.id && viewerIsPremium);
        
        // 🚀 Promoter Awareness
        const settings = await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });
        const showPfp = settings?.levelingPfpEnabled !== false;

        if (settings?.levelingUseImages === false) {
            const barLength = 15;
            const filledLength = Math.floor((progressPercentage / 100) * barLength);
            const emptyLength = barLength - filledLength;
            const progressBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
            const isPromoting = settings?.promoterRoleId && member ? member.roles.cache.has(settings.promoterRoleId) : false;

            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: `${target.username}${targetIsPremium ? ' [PREMIUM]' : ''}${isPromoting ? ' [Promoter]' : ''}'s Rank Profile`, 
                    iconURL: showPfp ? target.displayAvatarURL({ dynamic: true }) : null
                })
                .setColor(isPromoting ? 0xFF007A : (targetIsPremium ? 0xFFD700 : 0x57acf2))
                .addFields(
                    { name: 'Rank', value: `**#${rankIndex}** / ${totalUsers}`, inline: true },
                    { name: 'Level', value: `**${currentLevel}**`, inline: true },
                    { name: 'Lifetime XP', value: `**${totalXpRaw.toLocaleString()}**`, inline: true },
                    { name: 'Last Message', value: (userLevel && userLevel.lastMessageTimestamp) ? `<t:${Math.floor(new Date(userLevel.lastMessageTimestamp).getTime() / 1000)}:R>` : 'Never', inline: true },
                    { name: 'Progression Path', value: `\`${progressBar}\` (${Math.floor(progressPercentage)}%)\n*${xpProgressInLevel.toLocaleString()} / ${xpStepForLevelIncrement.toLocaleString()} XP in Level*`, inline: false }
                );

            if (showPfp) {
                embed.setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }));
            }

            embed.setFooter({ text: `Server Rank | ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() })
                .setTimestamp();

            return interaction.reply({ 
                content: hasNoXp ? `👋 **${target.username}** has not earned any XP in this server yet. Here is their starting rank profile:` : null,
                embeds: [embed] 
            });
        }

        // Defer reply as generating rank card might take a bit due to asset fetching and processing
        await interaction.deferReply();

        try {
            const { generateRankCard } = require('../../utils/rankCardGenerator');
            const imageBuffer = await generateRankCard({
                username: target.username,
                level: currentLevel,
                currentXp: xpProgressInLevel,
                nextLevelXp: xpStepForLevelIncrement,
                rank: rankIndex,
                avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
                showPfp: showPfp
            });

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'rank-card.png' });
            await interaction.editReply({ 
                content: hasNoXp ? `👋 **${target.username}** has not earned any XP in this server yet. Here is their starting rank profile:` : null,
                files: [attachment] 
            });
        } catch (err) {
            console.error('Error generating rank card:', err);
            // Fallback: send simple text reply if generation fails
            await interaction.editReply({ 
                content: `👋 **${target.username}** | Level **${currentLevel}** | Rank **#${rankIndex}** | XP **${xpProgressInLevel.toLocaleString()} / ${xpStepForLevelIncrement.toLocaleString()}** (No XP earned yet)` 
            });
        }
    },
};
