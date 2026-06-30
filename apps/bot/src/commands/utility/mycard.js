const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const GuildSettings = require('../../database/models/GuildSettings');
const UserPrefs = require('../../database/models/UserPrefs');
const RobloxVerify = require('../../database/models/RobloxVerify');
const { handleError } = require('../../utils/embeds');
const axios = require('axios');

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

        // Fetch UserPrefs
        const targetPrefs = await UserPrefs.findOne({ where: { userId: target.id } });
        
        // Hand complete privacy control back to the user regarding what info is hidden or shared
        if (targetPrefs && !targetPrefs.profilePublic && target.id !== interaction.user.id) {
            return interaction.editReply({
                content: '🔒 **Private Profile:** This profile has been set to private by the user.',
                ephemeral: true
            });
        }

        // Determine if target is premium
        const APP_OWNER_IDS = [process.env.APP_OWNER_ID || '1214048435632603137', '1366229304257544213'];
        const isOwner = APP_OWNER_IDS.includes(target.id);
        
        const checkPremium = (prefs) => {
            if (isOwner) return true;
            if (!prefs) return false;
            if (prefs.isManualPremium || prefs.isPremium) return true;
            const paidTime = prefs.paidExpiresAt ? new Date(prefs.paidExpiresAt).getTime() : 0;
            const expandedMs = prefs.expandedTimeMs ? Number(prefs.expandedTimeMs) : 0;
            return (paidTime + expandedMs) > Date.now();
        };
        const isPremium = checkPremium(targetPrefs);

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
        let joinedAt = 'N/A';
        let permissionText = 'Independent Identity';

        if (!isDM && member) {
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

        // Promoter Awareness
        const settings = isDM ? null : await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });
        const isPromoting = settings?.promoterRoleId && member ? member.roles.cache.has(settings.promoterRoleId) : false;

        // Badge Syncing Pipeline: Fetch official Discord badges
        const badgesList = [];
        if (target.flags) {
            const flags = target.flags.toArray();
            const badgeMap = {
                Staff: '🛡️ Staff',
                Partner: '🤝 Partner',
                Hypesquad: '🦁 Events Coordinator',
                BugHunterLevel1: '🐛 Bug Hunter I',
                BugHunterLevel2: '🪲 Bug Hunter II',
                HypeSquadOnlineHouse1: '🔮 House of Bravery',
                HypeSquadOnlineHouse2: '🧪 House of Brilliance',
                HypeSquadOnlineHouse3: '🛡️ House of Balance',
                PremiumEarlySupporter: '🏎️ Early Supporter',
                VerifiedDeveloper: '👨‍💻 Developer',
                ActiveDeveloper: '💻 Active Developer'
            };
            flags.forEach(f => {
                if (badgeMap[f]) badgesList.push(badgeMap[f]);
            });
        }
        
        // Add Premium entitlement badge if active
        if (isPremium) {
            badgesList.push('💎 Nora Premium Subscriber');
        }

        const badgesDisplay = badgesList.length > 0 ? badgesList.map(b => `\`${b}\``).join(' ') : '*No server badges.*';

        // Roblox Integration displaying
        let robloxDisplay = '*No account verified.*';
        const robloxRecord = await RobloxVerify.findOne({ where: { userId: target.id, status: 'VERIFIED' } });
        if (robloxRecord && (targetPrefs?.robloxPublic !== false || target.id === interaction.user.id)) {
            let username = `ID: ${robloxRecord.robloxId}`;
            let status = 'Offline';
            let joinUrl = null;

            try {
                const robloxUserRes = await axios.get(`https://users.roblox.com/v1/users/${robloxRecord.robloxId}`);
                if (robloxUserRes.data) {
                    username = `${robloxUserRes.data.displayName} (@${robloxUserRes.data.name})`;
                }
            } catch (e) {}

            try {
                const presenceRes = await axios.post('https://presence.roblox.com/v1/presence/users', {
                    userIds: [parseInt(robloxRecord.robloxId)]
                });
                if (presenceRes.data && presenceRes.data.userPresences && presenceRes.data.userPresences.length > 0) {
                    const p = presenceRes.data.userPresences[0];
                    const type = p.userPresenceType; // 0: Offline, 1: Online, 2: InGame, 3: InStudio
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

        // Global Bio with Markdown support
        const bioDisplay = targetPrefs?.bio ? targetPrefs.bio : '*No bio set.*';

        // Build the Embed with Premium Star Badge and Gold Styling
        const authorName = `${target.username}${isPremium ? ' ⭐' : ''}'s Personal Card`;
        const embed = new EmbedBuilder()
            .setAuthor({ name: authorName, iconURL: target.displayAvatarURL() })
            .setColor(isPremium ? 0xFFD700 : (isPromoting ? 0xFF007A : 0x57acf2))
            .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 512 }))
            .setDescription(`${isPromoting ? '**Nora Affiliate**\n\n' : ''}${bioDisplay}`)
            .addFields(
                { name: 'User Info', value: `**Account Created:** ${createdAt}\n**Joined Server:** ${joinedAt}`, inline: true },
                { name: 'Permissions', value: permissionText, inline: true },
                { name: 'Leveling', value: `**Level:** ${isDM ? 'N/A' : level}\n**XP:** ${isDM ? 'N/A' : `${xp.toLocaleString()} / ${nextLevelXp.toLocaleString()}`}`, inline: true },
                { name: 'Nora Badges', value: badgesDisplay, inline: false },
                { name: 'Roblox Integration', value: robloxDisplay, inline: false },
                { name: 'Top Roles', value: rolesDisplay, inline: false },
                { name: 'Events', value: eventsDisplay, inline: false }
            )
            .setFooter({ text: `ID: ${target.id}`, iconURL: isDM ? null : interaction.guild.iconURL() })
            .setTimestamp();

        // Data Deletion Option (Only for the caller)
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
