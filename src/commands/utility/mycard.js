const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('mycard')
        .setDescription('View your complete profile and server data in one card.')
        .addUserOption(option => option.setName('target').setDescription('The user to view (or leave blank for yourself)'))
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const target = interaction.options.getUser('target') || interaction.user;

        // Privacy Check: mycard is always private (Ephemeral)
        await interaction.deferReply({ ephemeral: true });

        // We only exclude Nora herself from the profile system.
        if (target.id === interaction.client.user.id) {
            return handleError(interaction, 'Action Denied', 'I do not have a profile card; I am your assistant!');
        }

        const isDM = !interaction.guild;
        const member = isDM ? null : await interaction.guild.members.fetch(target.id).catch(() => null);

        // Fetch UserLevel from DB (Only possible if in a guild)
        let level = 0;
        let xp = 0;
        let nextLevelXp = 0;
        if (!isDM) {
            const { getXPForLevel, getTotalXPForLevel } = require('../../utils/noraLeveling');
            const userLevel = await UserLevel.findOne({
                where: { userId: target.id, guildId: interaction.guild.id }
            });
            level = userLevel ? userLevel.level : 0;
            const totalXpRaw = userLevel ? (userLevel.totalXp || userLevel.xp || 0) : 0;
            
            const xpFloor = getTotalXPForLevel(level);
            xp = totalXpRaw - xpFloor; // Set relative XP for display
            nextLevelXp = getXPForLevel(level); // Goal for this current level
        }

        // Analyze Member Roles
        let rolesDisplay = 'N/A (Global Card)';
        let isHigherThanBot = false;
        let joinedAt = 'N/A';
        let permissionText = 'Independent Identity';

        if (!isDM && member) {
            const botRolePosition = interaction.guild.members.me.roles.highest.position;
            isHigherThanBot = member.roles.highest.position > botRolePosition;
            const rolesList = member.roles.cache
                .filter(r => r.id !== interaction.guild.id)
                .sort((a, b) => b.position - a.position)
                .map(r => r.toString());

            rolesDisplay = rolesList.length > 0 ? rolesList.slice(0, 5).join(', ') : 'No special roles';
            if (rolesList.length > 5) rolesDisplay += ` (+${rolesList.length - 5} more)`;
            joinedAt = member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : 'Unknown';

            const keyPerms = [];
            if (member.permissions.has('Administrator')) keyPerms.push('Administrator');
            else {
                if (member.permissions.has('ManageGuild')) keyPerms.push('Manager');
                if (member.permissions.has('ModerateMembers') || member.permissions.has('BanMembers') || member.permissions.has('KickMembers')) keyPerms.push('Moderator');
                if (member.permissions.has('ManageMessages')) keyPerms.push('Chat Mod');
            }
            permissionText = keyPerms.length > 0 ? keyPerms.join(' | ') : 'Standard User';
        }

        const createdAt = `<t:${Math.floor(target.createdAt.getTime() / 1000)}:R>`;

        // Event Tracking (Easter 2026)
        const EasterEgg = require('../../database/models/EasterEgg');
        const eggRecord = await EasterEgg.findOne({ where: { userId: target.id } });
        let completedEvents = [];

        if (eggRecord) {
            const eggs = JSON.parse(eggRecord.foundEggs || '[]');
            const standardCount = eggs.filter(e => e >= 1 && e <= 10).length;
            const hasGolden = eggs.includes(99);

            if (standardCount >= 10 && hasGolden) {
                completedEvents.push('🐰 **Easter 2026:** Perfect Completion ✨ (10 Eggs + Golden Egg)');
            } else if (standardCount >= 10) {
                completedEvents.push('🐰 **Easter 2026:** Complete (10 Eggs)');
            }
        }
        
        const eventsDisplay = completedEvents.length > 0 ? completedEvents.join('\n') : '*No events completed.*';

        // 🚀 Promoter Awareness
        const settings = isDM ? null : await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });
        const isPromoting = settings?.promoterRoleId && member ? member.roles.cache.has(settings.promoterRoleId) : false;

        // Build the Embed
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${target.username}'s Personal Card`, iconURL: target.displayAvatarURL() })
            .setColor(isPromoting ? 0xFF007A : 0x57acf2)
            .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 512 }))
            .setDescription(`${isPromoting ? '**Nora Affiliate**\n\n' : ''}Here is the complete profile for <@${target.id}>.`)
            .addFields(
                { name: 'User Info', value: `**Account Created:** ${createdAt}\n**Joined Server:** ${joinedAt}`, inline: true },
                { name: 'Permissions', value: permissionText, inline: true },
                { name: 'Leveling', value: `**Level:** ${isDM ? 'N/A' : level}\n**XP:** ${isDM ? 'N/A' : `${xp.toLocaleString()} / ${nextLevelXp.toLocaleString()}`}`, inline: true },
                { name: 'Top Roles', value: rolesDisplay, inline: false },
                { name: 'Events', value: eventsDisplay, inline: false }
            )
            .setFooter({ text: `ID: ${target.id}`, iconURL: isDM ? null : interaction.guild.iconURL() })
            .setTimestamp();

        // 🗑️ Data Deletion Option (Only for the caller)
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder();
        if (target.id === interaction.user.id) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_delete_levels')
                    .setLabel('Delete My Personal Leveling Data')
                    .setEmoji('🗑️')
                    .setStyle(ButtonStyle.Danger)
            );
        }

        await interaction.editReply({ embeds: [embed], components: row.components.length > 0 ? [row] : [] });
    },
};
