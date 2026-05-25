const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleError } = require('../../utils/embeds');

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

        if (!userLevel) {
            return handleError(interaction, 'No Rank Data', `**${target.username}** has not earned any XP in this server yet.`);
        }

        const currentLevel = userLevel.level || 0;
        const totalXpRaw = userLevel.totalXp || 0;

        // 🧠 Cumulative Progress Unit
        const { getTotalXPForLevel } = require('../../utils/noraLeveling');
        const xpFloorForCurrentLevel = getTotalXPForLevel(currentLevel);
        const xpGoalForNextLevel = getTotalXPForLevel(currentLevel + 1);

        const xpProgressInLevel = totalXpRaw - xpFloorForCurrentLevel;
        const xpStepForLevelIncrement = xpGoalForNextLevel - xpFloorForCurrentLevel;

        const progressPercentage = Math.min(100, Math.max(0, (xpProgressInLevel / xpStepForLevelIncrement) * 100));

        // Get actual rank position (by totalXp)
        const guildUsers = await UserLevel.findAll({
            where: { guildId: interaction.guild.id },
            order: [['totalXp', 'DESC']]
        });
        const rankIndex = guildUsers.findIndex(u => u.userId === target.id) + 1;
        const totalUsers = guildUsers.length;

        // Build a text progress bar
        const barLength = 15;
        const filledLength = Math.floor((progressPercentage / 100) * barLength);
        const emptyLength = barLength - filledLength;
        const progressBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);

        const { isPremium } = require('../../utils/premiumManager');
        const viewerIsPremium = isPremium(interaction);
        const targetIsPremium = userLevel.isPremium || (target.id === interaction.user.id && viewerIsPremium);
        
        // 🚀 Promoter Awareness
        const settings = await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });
        const isPromoting = settings?.promoterRoleId && member ? member.roles.cache.has(settings.promoterRoleId) : false;

        const embed = new EmbedBuilder()
            .setAuthor({ 
                name: `${target.username}${targetIsPremium ? ' [PREMIUM]' : ''}${isPromoting ? ' [Promoter]' : ''}'s Rank Profile`, 
                iconURL: target.displayAvatarURL({ dynamic: true }) 
            })
            .setColor(isPromoting ? 0xFF007A : (targetIsPremium ? 0xFFD700 : 0x57acf2)) // Pink for promoter, gold for premium

            .addFields(
                { name: 'Rank', value: `**#${rankIndex}** / ${totalUsers}`, inline: true },
                { name: 'Level', value: `**${currentLevel}**`, inline: true },
                { name: 'Lifetime XP', value: `**${userLevel.totalXp.toLocaleString()}**`, inline: true },
                { name: 'Last Message', value: userLevel.lastMessageTimestamp ? `<t:${Math.floor(new Date(userLevel.lastMessageTimestamp).getTime() / 1000)}:R>` : 'Never', inline: true },
                { name: 'Progression Path', value: `\`${progressBar}\` (${Math.floor(progressPercentage)}%)\n*${xpProgressInLevel.toLocaleString()} / ${xpStepForLevelIncrement.toLocaleString()} XP in Level*`, inline: false }
            )
            .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: `Server Rank | ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
