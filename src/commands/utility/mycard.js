const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const GuildSettings = require('../../database/models/GuildSettings');
const UserPrefs = require('../../database/models/UserPrefs');
const RobloxVerify = require('../../database/models/RobloxVerify');
const Warning = require('../../database/models/Warning');
const EasterEgg = require('../../database/models/EasterEgg');
const { handleError } = require('../../utils/embeds');
const axios = require('axios');

function generateProgressBar(current, goal, size = 10) {
    if (goal <= 0) goal = 1;
    const percentage = Math.min(100, Math.max(0, Math.floor((current / goal) * 100)));
    const filled = Math.round((percentage / 100) * size);
    const empty = size - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `[\`${bar}\`] **${percentage}%**`;
}

async function buildMyCardPayload({ interaction, targetUser }) {
    const isDM = !interaction.guild;
    const member = isDM ? null : await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const targetPrefs = await UserPrefs.findOne({ where: { userId: targetUser.id } });

    // Premium Check
    const APP_OWNER_IDS = [process.env.APP_OWNER_ID || '1214048435632603137', '1366229304257544213'];
    const isOwner = APP_OWNER_IDS.includes(targetUser.id);
    const checkPremium = (prefs) => {
        if (isOwner) return true;
        if (!prefs) return false;
        if (prefs.isManualPremium || prefs.isPremium) return true;
        const paidTime = prefs.paidExpiresAt ? new Date(prefs.paidExpiresAt).getTime() : 0;
        const expandedMs = prefs.expandedTimeMs ? Number(prefs.expandedTimeMs) : 0;
        return (paidTime + expandedMs) > Date.now();
    };
    const isPremium = checkPremium(targetPrefs);

    // Leveling Stats & Server Rank
    let level = 0;
    let xp = 0;
    let totalXpRaw = 0;
    let nextLevelXp = 100;
    let serverRank = 'N/A';
    let progressBar = '[`░░░░░░░░░░`] **0%**';

    if (!isDM) {
        const { getXPForLevel, getTotalXPForLevel } = require('../../utils/noraLeveling');
        const userLevel = await UserLevel.findOne({
            where: { userId: targetUser.id, guildId: interaction.guild.id }
        });
        if (userLevel) {
            level = userLevel.level || 0;
            totalXpRaw = userLevel.totalXp || userLevel.xp || 0;
            const xpFloor = getTotalXPForLevel(level);
            xp = Math.max(0, totalXpRaw - xpFloor);
            nextLevelXp = getXPForLevel(level);
            progressBar = generateProgressBar(xp, nextLevelXp);

            try {
                const { Op } = require('sequelize');
                const higherXpCount = await UserLevel.count({
                    where: {
                        guildId: interaction.guild.id,
                        totalXp: { [Op.gt]: totalXpRaw }
                    }
                });
                serverRank = `#${higherXpCount + 1}`;
            } catch (e) {
                serverRank = 'N/A';
            }
        }
    }

    // Warning Count
    let warningsCount = 0;
    if (!isDM) {
        try {
            warningsCount = await Warning.count({
                where: { userId: targetUser.id, guildId: interaction.guild.id }
            });
        } catch (e) {}
    }

    // Role & Member Info
    let rolesDisplay = 'N/A (Global DM Card)';
    let joinedAt = 'N/A';
    let permissionText = 'Member';

    if (!isDM && member) {
        const rolesList = member.roles.cache
            .filter(r => r.id !== interaction.guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => r.toString());

        rolesDisplay = rolesList.length > 0 ? rolesList.slice(0, 5).join(', ') : 'No custom roles';
        if (rolesList.length > 5) rolesDisplay += ` (+${rolesList.length - 5} more)`;
        joinedAt = member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : 'Unknown';

        const keyPerms = [];
        if (member.permissions.has(PermissionFlagsBits.Administrator)) keyPerms.push('👑 Administrator');
        else {
            if (member.permissions.has(PermissionFlagsBits.ManageGuild)) keyPerms.push('🛡️ Manager');
            if (member.permissions.has(PermissionFlagsBits.ModerateMembers) || member.permissions.has(PermissionFlagsBits.BanMembers) || member.permissions.has(PermissionFlagsBits.KickMembers)) keyPerms.push('⚔️ Moderator');
            if (member.permissions.has(PermissionFlagsBits.ManageMessages)) keyPerms.push('💬 Chat Mod');
        }
        permissionText = keyPerms.length > 0 ? keyPerms.join(' | ') : '👤 Community Member';
    }

    const createdAt = `<t:${Math.floor(targetUser.createdAt.getTime() / 1000)}:R>`;

    // Easter Egg / Events
    const eggRecord = await EasterEgg.findOne({ where: { userId: targetUser.id } });
    let completedEvents = [];
    if (eggRecord) {
        const eggs = JSON.parse(eggRecord.foundEggs || '[]');
        const standardCount = eggs.filter(e => e >= 1 && e <= 10).length;
        const hasGolden = eggs.includes(99);

        if (standardCount >= 10 && hasGolden) {
            completedEvents.push('🐰 **Easter 2026:** Perfect Masterpiece ✨ (10 Eggs + Golden Egg)');
        } else if (standardCount >= 10) {
            completedEvents.push('🐰 **Easter 2026:** Completed (10 Eggs)');
        }
    }
    const eventsDisplay = completedEvents.length > 0 ? completedEvents.join('\n') : '*No events completed.*';

    // Promoter Awareness
    const settings = isDM ? null : await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });
    const isPromoting = settings?.promoterRoleId && member ? member.roles.cache.has(settings.promoterRoleId) : false;

    // Badges
    const badgesList = [];
    if (isOwner) badgesList.push('👑 Nora Founder');
    if (isPremium) badgesList.push('💎 Nora Studio Premium');
    if (isPromoting) badgesList.push('⚡ Affiliate Promoter');

    if (targetUser.flags) {
        const flags = targetUser.flags.toArray();
        const badgeMap = {
            Staff: '🛡️ Discord Staff',
            Partner: '🤝 Discord Partner',
            Hypesquad: '🦁 HypeSquad Events',
            BugHunterLevel1: '🐛 Bug Hunter I',
            BugHunterLevel2: '🪲 Bug Hunter II',
            HypeSquadOnlineHouse1: '🔮 Bravery',
            HypeSquadOnlineHouse2: '🧪 Brilliance',
            HypeSquadOnlineHouse3: '🛡️ Balance',
            PremiumEarlySupporter: '🏎️ Early Supporter',
            VerifiedDeveloper: '👨‍💻 Developer',
            ActiveDeveloper: '💻 Active Developer'
        };
        flags.forEach(f => {
            if (badgeMap[f]) badgesList.push(badgeMap[f]);
        });
    }

    const badgesDisplay = badgesList.length > 0 ? badgesList.map(b => `\`${b}\``).join(' ') : '*No global badges.*';

    // Roblox Integration
    let robloxDisplay = '*No Roblox account verified.*';
    const robloxRecord = await RobloxVerify.findOne({ where: { userId: targetUser.id, status: 'VERIFIED' } });
    if (robloxRecord && (targetPrefs?.robloxPublic !== false || targetUser.id === interaction.user.id)) {
        let username = `ID: ${robloxRecord.robloxId}`;
        let status = 'Offline';
        let joinUrl = null;

        try {
            const [userResult, presenceResult] = await Promise.allSettled([
                axios.get(`https://users.roblox.com/v1/users/${robloxRecord.robloxId}`, { timeout: 1500 }),
                axios.post('https://presence.roblox.com/v1/presence/users', {
                    userIds: [parseInt(robloxRecord.robloxId)]
                }, { timeout: 1500 })
            ]);

            if (userResult.status === 'fulfilled' && userResult.value.data) {
                username = `${userResult.value.data.displayName} (@${userResult.value.data.name})`;
            }

            if (presenceResult.status === 'fulfilled' && presenceResult.value.data && presenceResult.value.data.userPresences?.length > 0) {
                const p = presenceResult.value.data.userPresences[0];
                const type = p.userPresenceType;
                if (type === 1) status = '🟢 Online on website';
                else if (type === 2) {
                    status = `🎮 Playing **${p.lastLocation || 'Roblox'}**`;
                    if (targetPrefs?.joinMeEnabled && targetPrefs?.joinLink) {
                        joinUrl = targetPrefs.joinLink;
                    }
                } else if (type === 3) {
                    status = '🛠️ Editing in Studio';
                }
            }
        } catch (e) {}

        robloxDisplay = `**Account:** [${username}](https://www.roblox.com/users/${robloxRecord.robloxId}/profile)\n**Status:** ${status}`;
        if (joinUrl) {
            robloxDisplay += `\n👉 [**Join Experience**](${joinUrl})`;
        }
    }

    // Bio
    const bioDisplay = targetPrefs?.bio ? targetPrefs.bio : '*No personal bio set. Customize in Nora Dashboard!*';

    // Theme & Styling
    const cardStyleText = targetPrefs ? (
        targetPrefs.rankCardThemeMode === 'custom' ? `Custom Color (${targetPrefs.rankCardCustomColor || '#4f46e5'})` :
        targetPrefs.rankCardThemeMode === 'image' ? 'Custom Canvas' : 'Server Preset'
    ) : 'Default Dark Theme';

    // Generate Custom Digital ID Card Image Pass
    const { generateUserIdCard } = require('../../utils/rankCardGenerator');
    let cardAttachment = null;
    try {
        const robloxText = robloxRecord ? `@${robloxRecord.robloxId}` : 'Not Verified';
        const rawJoined = member && member.joinedAt ? member.joinedAt.toLocaleDateString() : 'N/A';
        const rawCreated = targetUser.createdAt.toLocaleDateString();

        const cardBuffer = await generateUserIdCard({
            username: targetUser.username,
            userId: targetUser.id,
            guildName: isDM ? 'Direct Messages' : interaction.guild.name,
            avatarUrl: targetUser.displayAvatarURL({ extension: 'png', size: 512 }),
            level: isDM ? 0 : level,
            currentXp: xp,
            nextLevelXp,
            totalXp: totalXpRaw,
            rank: isDM ? 'N/A' : serverRank,
            isPremium,
            isOwner,
            isPromoter: isPromoting,
            clearance: permissionText,
            joinedAt: rawJoined,
            createdAt: rawCreated,
            bio: targetPrefs?.bio || '',
            robloxText,
            badges: badgesList,
            accentColor: targetPrefs?.rankCardCustomColor || '#7c3aed'
        });

        cardAttachment = cardBuffer ? { attachment: cardBuffer, name: 'nora-id-card.png' } : null;
    } catch (e) {
        console.error('[ID Card Image Gen Error]:', e);
    }

    let color = 0x06B6D4; // Standard Cyan
    if (isOwner || isPremium) color = 0xFFD700; // Gold
    else if (isPromoting) color = 0xFF007A; // Pink
    else if (member && member.permissions && member.permissions.has(PermissionFlagsBits.ManageGuild)) color = 0x3B82F6; // Blue

    const embed = new EmbedBuilder()
        .setAuthor({ 
            name: `${targetUser.username}'s Personal Digital ID Card ${isPremium ? '⭐' : ''}`, 
            iconURL: targetUser.displayAvatarURL({ dynamic: true }) 
        })
        .setColor(color)
        .setDescription(`>>> ${bioDisplay}`)
        .addFields(
            {
                name: '📈 Leveling & Rank Stats',
                value: `**Level:** \`${isDM ? 'N/A' : level}\` | **Server Rank:** \`${isDM ? 'N/A' : serverRank}\`\n` +
                       `**XP:** \`${isDM ? 'N/A' : `${xp.toLocaleString()} / ${nextLevelXp.toLocaleString()}`}\` *(Total: ${isDM ? 'N/A' : totalXpRaw.toLocaleString()} XP)*\n` +
                       `**Progress:** ${progressBar}`,
                inline: false
            },
            {
                name: '💎 Nora Premium & Status',
                value: `**Plan:** ${isPremium ? '💎 **Nora Studio Plus**' : '🆓 Standard Free Tier'}\n` +
                       `**Privileges:** ${isPremium ? 'Instant Rank Sync • Aura AI • GIF Rank Cards • 10x XP Boosters' : 'Standard AutoMod & Leveling Access'}`,
                inline: false
            },
            {
                name: '🛡️ Server & Security Identity',
                value: `**Current Server:** ${isDM ? 'Direct Messages' : `**${interaction.guild.name}**`}\n` +
                       `**Joined Server:** ${joinedAt}\n` +
                       `**Account Created:** ${createdAt}\n` +
                       `**Clearance:** ${permissionText} | **Warnings:** \`${warningsCount}\``,
                inline: false
            },
            { name: '🏷️ Top Server Roles', value: rolesDisplay, inline: false },
            { name: '🎮 Roblox Integration', value: robloxDisplay, inline: false },
            { name: '🏆 Nora Badges', value: badgesDisplay, inline: false },
            { name: '🎉 Special Events', value: eventsDisplay, inline: false }
        )
        .setFooter({ 
            text: `ID: ${targetUser.id} • Theme: ${cardStyleText}`, 
            iconURL: isDM ? null : interaction.guild.iconURL() 
        })
        .setTimestamp();

    if (cardAttachment) {
        embed.setImage('attachment://nora-id-card.png');
    }

    // Action Row Buttons
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`mycard_refresh_${targetUser.id}`)
            .setLabel('Refresh Card')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setLabel('Customize Card')
            .setEmoji('🎨')
            .setStyle(ButtonStyle.Link)
            .setURL('https://vaztinix.dev/dashboard')
    );

    // If caller is viewing their own profile, add the Privacy / Data Purge button
    if (targetUser.id === interaction.user.id) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_delete_levels')
                .setLabel('Delete My Personal Leveling Data')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Danger)
        );
    }

    return { content: `📇 **${targetUser.username}**'s Official Nora Digital ID Card`, embeds: [embed], files: cardAttachment ? [cardAttachment] : [], components: [row] };
}

module.exports = {
    category: 'utility',
    noAutoDefer: true,
    ephemeral: false,
    buildMyCardPayload,
    data: new SlashCommandBuilder()
        .setName('mycard')
        .setDescription('View your complete profile and server data in one card.')
        .addUserOption(option => option.setName('target').setDescription('The user to view (or leave blank for yourself)'))
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const target = interaction.options.getUser('target') || interaction.user;

        // We only exclude Nora herself from the profile system.
        if (target.id === interaction.client.user.id) {
            return handleError(interaction, 'Action Denied', 'I do not have a profile card; I am your assistant!');
        }

        try {
            // Fetch UserPrefs
            const targetPrefs = await UserPrefs.findOne({ where: { userId: target.id } });
            
            // Hand complete privacy control back to the user regarding what info is hidden or shared
            if (targetPrefs && !targetPrefs.profilePublic && target.id !== interaction.user.id) {
                return interaction.reply({
                    content: '🔒 **Private Profile:** This profile has been set to private by the user.'
                });
            }

            const payload = await buildMyCardPayload({ interaction, targetUser: target });
            await interaction.reply(payload);
        } catch (err) {
            console.error('[MyCard Command Error]', err);
            await handleError(interaction, 'Profile Error', 'An error occurred while building your profile card. Please try again.');
        }
    },
};
