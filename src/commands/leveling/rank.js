const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleError } = require('../../utils/embeds');
// Rank command implementation
module.exports = {
    category: 'leveling',
    noAutoDefer: true,
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription("Check your or another user's rank with a beautiful card.")
        .addUserOption(option => option.setName('target').setDescription('The user to check'))
        .setContexts(0)
        .setIntegrationTypes(0)
        .setDMPermission(false)
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        await interaction.deferReply().catch(() => {});
        const { checkAndAwardEgg } = require('../../utils/easterEggSystem');
        checkAndAwardEgg(interaction, 9);

        const target = interaction.options.getUser('target') || interaction.user;
        const member = interaction.guild.members.cache.get(target.id) || await interaction.guild.members.fetch(target.id).catch(() => null);

        // We only exclude Nora herself from the rank system to avoid self-tracking.
        if (target.id === interaction.client.user.id) {
            return interaction.editReply({
                content: '⚠️ **Nora is Supreme:** I do not have a rank profile; I am simply here to assist you!'
            });
        }

        const userLevel = await UserLevel.findOne({
            where: { userId: target.id, guildId: interaction.guild.id }
        });

        const targetXp = userLevel ? (userLevel.totalXp || 0) : 0;
        const higherCount = await UserLevel.count({
            where: {
                guildId: interaction.guild.id,
                totalXp: { [require('sequelize').Op.gt]: targetXp }
            }
        }).catch(() => 0);

        let currentLevel = 0;
        let totalXpRaw = 0;
        let xpProgressInLevel = 0;
        let xpStepForLevelIncrement = 100;
        let progressPercentage = 0;
        let rankIndex = higherCount + 1;
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
                    { name: 'Rank', value: `**#${rankIndex}**`, inline: true },
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

            return interaction.editReply({ 
                content: hasNoXp ? `👋 **${target.username}** has not earned any XP in this server yet. Here is their starting rank profile:` : null,
                embeds: [embed] 
            });
        }

        try {
            const UserPrefs = require('../../database/models/UserPrefs');
            const targetPrefs = await UserPrefs.findOne({ where: { userId: target.id } });

            // Determine custom avatar & theme settings
            const userShowAvatar = targetPrefs ? targetPrefs.showAvatarInRankCard !== false : true;
            const { APP_OWNER_IDS } = require('../../utils/premiumManager');
            const isTargetUserPrem = APP_OWNER_IDS.includes(target.id) ||
                Boolean(targetPrefs && (targetPrefs.isPremium || targetPrefs.isManualPremium || (targetPrefs.paidExpiresAt && new Date(targetPrefs.paidExpiresAt).getTime() > Date.now())));
            const isGuildPrem = Boolean(settings && (settings.isPremium || settings.isManualPremium || (settings.paidExpiresAt && new Date(settings.paidExpiresAt).getTime() > Date.now())));
            const hasStudioPlus = isTargetUserPrem || isGuildPrem;

            const themeMode = targetPrefs?.rankCardThemeMode || 'preset';

            let cardAccent = settings?.levelingCardAccentColor || '#7c3aed';
            let cardBgColor = settings?.levelingCardBgColor || '#111217';
            let cardBorder = settings?.levelingCardBorderColor || '#23252e';
            let cardUserBg = null;

            // Custom GIF rank cards and custom HEX color builder are exclusive to Studio Plus
            if (hasStudioPlus && themeMode === 'image') {
                cardUserBg = targetPrefs?.rankCardBackgroundImage || null;
                if (targetPrefs?.rankCardCustomColor) cardAccent = targetPrefs.rankCardCustomColor;
            } else if (hasStudioPlus && themeMode === 'custom') {
                cardUserBg = null;
                if (targetPrefs?.rankCardCustomColor) cardAccent = targetPrefs.rankCardCustomColor;
            } else {
                // Free tier or preset mode: adhere strictly to server theme
                cardUserBg = null;
                cardAccent = settings?.levelingCardAccentColor || '#7c3aed';
                cardBgColor = settings?.levelingCardBgColor || '#111217';
                cardBorder = settings?.levelingCardBorderColor || '#23252e';
            }

            const { generateRankCard } = require('../../utils/rankCardGenerator');
            const imageBuffer = await Promise.race([
                generateRankCard({
                    username: target.username,
                    level: currentLevel,
                    currentXp: xpProgressInLevel,
                    nextLevelXp: xpStepForLevelIncrement,
                    rank: rankIndex,
                    avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
                    showPfp: finalShowPfp,
                    bgColor: cardBgColor,
                    accentColor: cardAccent,
                    borderColor: cardBorder,
                    isPremium: hasStudioPlus, // Strictly gated by Studio Plus entitlement
                    userCustomBg: cardUserBg,
                    serverCustomBg: settings?.levelingCardBackgroundImage || null
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Card generation timed out')), 25000))
            ]);

            const isGifBuffer = imageBuffer.slice(0, 3).toString() === 'GIF';
            const fileName = isGifBuffer ? 'rank-card.gif' : 'rank-card.png';
            const { AttachmentBuilder } = require('discord.js');
            const attachment = new AttachmentBuilder(imageBuffer, { name: fileName });

            await interaction.editReply({ 
                content: null,
                embeds: [],
                files: [attachment] 
            });
        } catch (err) {
            console.error('Error generating rank card:', err);
            // Fallback: send simple text reply if generation fails
            await interaction.editReply({ 
                content: `👋 **${target.username}** | Level **${currentLevel}** | Rank **#${rankIndex}** | XP **${xpProgressInLevel.toLocaleString()} / ${xpStepForLevelIncrement.toLocaleString()}**`,
                files: []
            });
        }
    },
};
