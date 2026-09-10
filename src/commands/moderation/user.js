const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const Warning = require('../../database/models/Warning');
const UserLevel = require('../../database/models/UserLevel');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('user')
        .setDescription('User management, member inspection, and profile lookups.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('info')
                .setDescription('View member details, account age, roles, and warning history.')
                .addUserOption(opt =>
                    opt.setName('target')
                        .setDescription('The user to inspect (default: yourself)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('nick')
                .setDescription('Change or reset the nickname of a server member.')
                .addUserOption(opt => 
                    opt.setName('target')
                        .setDescription('The user whose nickname to change')
                        .setRequired(true)
                )
                .addStringOption(opt => 
                    opt.setName('nickname')
                        .setDescription('The new nickname (leave empty to reset)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('avatar')
                .setDescription('View and download a user\'s avatar in full resolution.')
                .addUserOption(opt =>
                    opt.setName('target')
                        .setDescription('The user whose avatar to view')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('banner')
                .setDescription('View a user\'s banner or accent color.')
                .addUserOption(opt =>
                    opt.setName('target')
                        .setDescription('The user whose banner to view')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const subcommand = interaction.options.getSubcommand();

        // -------------------------------------------------------------
        // Subcommand: INFO
        // -------------------------------------------------------------
        if (subcommand === 'info') {
            const target = interaction.options.getUser('target') || interaction.user;
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);

            // Fetch warning count
            let warningCount = 0;
            try {
                warningCount = await Warning.count({
                    where: { userId: target.id, guildId: interaction.guild.id }
                });
            } catch (e) {}

            // Fetch leveling stats if any
            let levelText = 'No recorded XP';
            try {
                const userLvl = await UserLevel.findOne({
                    where: { userId: target.id, guildId: interaction.guild.id }
                });
                if (userLvl) {
                    levelText = `Level **${userLvl.level || 0}** (${(userLvl.totalXp || 0).toLocaleString()} XP)`;
                }
            } catch (e) {}

            // Join Position calculation
            let joinPosition = 'Unknown';
            try {
                const allMembers = await interaction.guild.members.fetch();
                const sorted = allMembers.sort((a, b) => (a.joinedTimestamp || 0) - (b.joinedTimestamp || 0));
                const index = Array.from(sorted.values()).findIndex(m => m.id === target.id);
                if (index !== -1) {
                    joinPosition = `#${index + 1} of ${interaction.guild.memberCount}`;
                }
            } catch (e) {}

            // Badges / Attributes
            const badges = [];
            if (target.bot) badges.push('Bot');
            if (target.id === interaction.guild.ownerId) badges.push('Server Owner');
            if (member && member.permissions.has(PermissionFlagsBits.Administrator) && target.id !== interaction.guild.ownerId) badges.push('Administrator');
            if (member && member.isCommunicationDisabled()) badges.push('Timed Out');
            if (member && member.premiumSince) badges.push('Server Booster');

            // Key Permissions
            const permsList = [];
            if (member) {
                if (member.permissions.has(PermissionFlagsBits.Administrator)) permsList.push('Administrator');
                if (member.permissions.has(PermissionFlagsBits.ManageGuild)) permsList.push('Manage Server');
                if (member.permissions.has(PermissionFlagsBits.ManageRoles)) permsList.push('Manage Roles');
                if (member.permissions.has(PermissionFlagsBits.ManageChannels)) permsList.push('Manage Channels');
                if (member.permissions.has(PermissionFlagsBits.BanMembers)) permsList.push('Ban Members');
                if (member.permissions.has(PermissionFlagsBits.KickMembers)) permsList.push('Kick Members');
                if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) permsList.push('Timeout Members');
                if (member.permissions.has(PermissionFlagsBits.ManageMessages)) permsList.push('Manage Messages');
            }

            const roles = member 
                ? member.roles.cache.filter(r => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position)
                : null;

            let rolesDisplay = 'None';
            if (roles && roles.size > 0) {
                const roleArray = Array.from(roles.values());
                rolesDisplay = roleArray.slice(0, 8).map(r => r.toString()).join(' ');
                if (roleArray.length > 8) {
                    rolesDisplay += ` *(+${roleArray.length - 8} more)*`;
                }
            }

            const createdTimestamp = Math.floor(target.createdTimestamp / 1000);
            const joinedTimestamp = member && member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

            const titleStr = badges.length > 0 ? `${target.username} [${badges.join(', ')}]` : target.username;

            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: `Member Info: ${target.tag}`, 
                    iconURL: target.displayAvatarURL({ dynamic: true }) 
                })
                .setTitle(titleStr)
                .setColor(member?.displayColor || 0x5865F2)
                .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: 'User ID', value: `\`${target.id}\``, inline: true },
                    { name: 'Nickname', value: member?.nickname ? `**${member.nickname}**` : '*None*', inline: true },
                    { name: 'Join Position', value: joinPosition, inline: true },
                    { name: 'Account Created', value: `<t:${createdTimestamp}:F>\n(<t:${createdTimestamp}:R>)`, inline: true },
                    { name: 'Joined Server', value: joinedTimestamp ? `<t:${joinedTimestamp}:F>\n(<t:${joinedTimestamp}:R>)` : 'Not in server', inline: true },
                    { name: 'Level & XP', value: levelText, inline: true },
                    { name: 'Warnings', value: `${warningCount} warning(s)`, inline: true },
                    { name: 'Key Permissions', value: permsList.length > 0 ? permsList.join(', ') : 'Standard member', inline: false },
                    { name: `Roles (${roles ? roles.size : 0})`, value: rolesDisplay, inline: false }
                )
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            const linksRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('View Avatar')
                    .setURL(target.displayAvatarURL({ dynamic: true, size: 4096 }))
                    .setStyle(ButtonStyle.Link)
            );

            return await interaction.editReply({ embeds: [embed], components: [linksRow] });
        }

        // -------------------------------------------------------------
        // Subcommand: NICK
        // -------------------------------------------------------------
        if (subcommand === 'nick') {
            const target = interaction.options.getUser('target');
            const nickname = interaction.options.getString('nickname');

            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) {
                return handleError(interaction, 'User Not Found', 'That user is not currently in this server.');
            }

            if (member.id === interaction.guild.ownerId) {
                return handleError(interaction, 'Action Denied', 'The server owner\'s nickname cannot be modified by bots.');
            }

            if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
                return handleError(interaction, 'Hierarchy Error', `You cannot change <@${target.id}>'s nickname because their highest role is equal to or higher than yours.`);
            }

            if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                return handleError(interaction, 'Permission Error', 'I lack the **Manage Nicknames** permission.');
            }

            if (interaction.guild.members.me.roles.highest.position <= member.roles.highest.position) {
                return handleError(interaction, 'Hierarchy Error', `I cannot modify <@${target.id}> because their highest role is equal to or higher than my highest role.`);
            }

            try {
                await member.setNickname(nickname, `Updated by ${interaction.user.tag}`);
                if (nickname) {
                    await handleSuccess(interaction, 'Nickname Updated', `Changed <@${target.id}>'s nickname to **${nickname}**.`);
                } else {
                    await handleSuccess(interaction, 'Nickname Reset', `Reset <@${target.id}>'s nickname back to default.`);
                }
            } catch (error) {
                console.error(error);
                await handleError(interaction, 'Execution Error', 'An unexpected error occurred while modifying the member nickname.');
            }
        }

        // -------------------------------------------------------------
        // Subcommand: AVATAR
        // -------------------------------------------------------------
        if (subcommand === 'avatar') {
            const target = interaction.options.getUser('target') || interaction.user;
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);

            const globalAvatarPng = target.displayAvatarURL({ extension: 'png', size: 4096 });
            const globalAvatarWebp = target.displayAvatarURL({ extension: 'webp', size: 4096 });
            const isAnimated = target.avatar && target.avatar.startsWith('a_');
            const globalAvatarGif = isAnimated ? target.displayAvatarURL({ extension: 'gif', size: 4096 }) : null;

            const embed = new EmbedBuilder()
                .setAuthor({ name: `${target.tag}'s Avatar`, iconURL: target.displayAvatarURL() })
                .setTitle('Avatar Viewer')
                .setColor(member?.displayColor || 0x5865F2)
                .setImage(target.displayAvatarURL({ dynamic: true, size: 4096 }))
                .setDescription(
                    `Formats: [PNG](${globalAvatarPng}) • [WEBP](${globalAvatarWebp})` +
                    (globalAvatarGif ? ` • [GIF](${globalAvatarGif})` : '')
                )
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Open in Browser')
                    .setURL(target.displayAvatarURL({ dynamic: true, size: 4096 }))
                    .setStyle(ButtonStyle.Link)
            );

            return await interaction.editReply({ embeds: [embed], components: [row] });
        }

        // -------------------------------------------------------------
        // Subcommand: BANNER
        // -------------------------------------------------------------
        if (subcommand === 'banner') {
            const target = interaction.options.getUser('target') || interaction.user;
            const fetchedUser = await interaction.client.users.fetch(target.id, { force: true }).catch(() => target);

            const bannerUrl = fetchedUser.bannerURL({ dynamic: true, size: 4096 });
            const accentColor = fetchedUser.hexAccentColor;

            if (!bannerUrl && !accentColor) {
                return await interaction.editReply({
                    content: `**${target.username}** does not have a custom profile banner or accent color set.`
                });
            }

            const embed = new EmbedBuilder()
                .setAuthor({ name: `${target.tag}'s Banner`, iconURL: target.displayAvatarURL() })
                .setTitle('Profile Banner')
                .setColor(accentColor || 0x5865F2)
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            if (bannerUrl) {
                embed.setImage(bannerUrl);
                embed.setDescription(`[Open Banner in Full Resolution](${bannerUrl})`);
            } else if (accentColor) {
                embed.setDescription(`Hex Accent Color: \`${accentColor}\``);
            }

            return await interaction.editReply({ embeds: [embed] });
        }
    },
};
