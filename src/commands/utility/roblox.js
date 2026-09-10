const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('roblox')
        .setDescription('Lookup Roblox user profiles, avatar thumbnails, and group info.')
        .addSubcommand(sub =>
            sub.setName('profile')
                .setDescription('View profile details and avatar for a Roblox user or ID.')
                .addStringOption(opt => 
                    opt.setName('user')
                        .setDescription('Roblox username or numeric user ID')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('group')
                .setDescription('View group information, member count, and owner.')
                .addStringOption(opt => 
                    opt.setName('id')
                        .setDescription('Roblox Group ID')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply().catch(() => {});

        // -------------------------------------------------------------
        // Subcommand: PROFILE
        // -------------------------------------------------------------
        if (subcommand === 'profile') {
            const userInput = interaction.options.getString('user').trim();
            let userId = null;

            try {
                // Try resolving as username first
                const resolveRes = await axios.post('https://users.roblox.com/v1/usernames/users', {
                    usernames: [userInput],
                    excludeBannedUsers: false
                }).catch(() => null);

                if (resolveRes?.data?.data && resolveRes.data.data.length > 0) {
                    userId = resolveRes.data.data[0].id;
                } else if (/^\d+$/.test(userInput)) {
                    userId = userInput;
                }

                if (!userId) {
                    return interaction.editReply(`Could not find a Roblox account matching \`${userInput}\`.`);
                }

                // Fetch profile details
                const profileRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`).catch(() => null);
                if (!profileRes || !profileRes.data) {
                    return interaction.editReply('Failed to retrieve profile details from the Roblox API.');
                }
                const data = profileRes.data;

                // Fetch thumbnails & follower count in parallel
                const [headshotRes, fullBodyRes, followerCountRes] = await Promise.all([
                    axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=352x352&format=Png&isCircular=false`).catch(() => null),
                    axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=352x352&format=Png&isCircular=false`).catch(() => null),
                    axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`).catch(() => null)
                ]);

                const headshotUrl = headshotRes?.data?.data?.[0]?.imageUrl || null;
                const fullBodyUrl = fullBodyRes?.data?.data?.[0]?.imageUrl || null;
                const followersCount = followerCountRes?.data?.count !== undefined ? Number(followerCountRes.data.count).toLocaleString() : 'N/A';

                const createdDate = data.created 
                    ? `<t:${Math.floor(new Date(data.created).getTime() / 1000)}:D> (<t:${Math.floor(new Date(data.created).getTime() / 1000)}:R>)`
                    : 'Unknown';

                const verifiedBadge = data.hasVerifiedBadge ? ' [Verified]' : '';
                const accountStatus = data.isBanned ? 'Banned / Terminated' : 'Active';

                const embed = new EmbedBuilder()
                    .setAuthor({ 
                        name: `@${data.name}`, 
                        iconURL: headshotUrl || 'https://www.roblox.com/favicon.ico' 
                    })
                    .setTitle(`${data.displayName} (@${data.name})${verifiedBadge}`)
                    .setURL(`https://www.roblox.com/users/${data.id}/profile`)
                    .setDescription(data.description ? `*${data.description.length > 250 ? data.description.substring(0, 247) + '...' : data.description}*` : '*No description provided.*')
                    .setColor(data.isBanned ? 0xED4245 : 0x5865F2)
                    .addFields(
                        { name: 'User ID', value: `\`${data.id}\``, inline: true },
                        { name: 'Status', value: accountStatus, inline: true },
                        { name: 'Followers', value: followersCount, inline: true },
                        { name: 'Join Date', value: createdDate, inline: true },
                        { name: 'Display Name', value: data.displayName, inline: true }
                    )
                    .setFooter({ text: 'Roblox Profile' })
                    .setTimestamp();

                if (fullBodyUrl) {
                    embed.setThumbnail(fullBodyUrl);
                }

                const buttonRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('View on Roblox')
                        .setURL(`https://www.roblox.com/users/${data.id}/profile`)
                        .setStyle(ButtonStyle.Link),
                    new ButtonBuilder()
                        .setLabel('Inventory')
                        .setURL(`https://www.roblox.com/users/${data.id}/inventory`)
                        .setStyle(ButtonStyle.Link)
                );

                await interaction.editReply({ embeds: [embed], components: [buttonRow] });

            } catch (err) {
                console.error('Roblox Profile Error:', err);
                await interaction.editReply('An error occurred while retrieving data from Roblox.');
            }
        }

        // -------------------------------------------------------------
        // Subcommand: GROUP
        // -------------------------------------------------------------
        if (subcommand === 'group') {
            const groupId = interaction.options.getString('id').trim();

            if (!/^\d+$/.test(groupId)) {
                return interaction.editReply('Please provide a valid numeric Roblox Group ID.');
            }

            try {
                const [groupRes, iconRes] = await Promise.all([
                    axios.get(`https://groups.roblox.com/v1/groups/${groupId}`).catch(() => null),
                    axios.get(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${groupId}&size=150x150&format=Png`).catch(() => null)
                ]);

                if (!groupRes || !groupRes.data) {
                    return interaction.editReply(`Could not find a Roblox group with ID \`${groupId}\`.`);
                }

                const data = groupRes.data;
                const iconUrl = iconRes?.data?.data?.[0]?.imageUrl || null;
                const ownerName = data.owner ? `[${data.owner.displayName || data.owner.username}](https://www.roblox.com/users/${data.owner.userId}/profile)` : '*None (Locked)*';
                const memberCount = (data.memberCount || 0).toLocaleString();

                const embed = new EmbedBuilder()
                    .setAuthor({ 
                        name: 'Roblox Group Directory', 
                        iconURL: iconUrl || 'https://www.roblox.com/favicon.ico' 
                    })
                    .setTitle(`${data.name}${data.hasVerifiedBadge ? ' [Verified]' : ''}`)
                    .setURL(`https://www.roblox.com/groups/${data.id}`)
                    .setDescription(data.description ? `*${data.description.length > 300 ? data.description.substring(0, 297) + '...' : data.description}*` : '*No description provided.*')
                    .setColor(0x5865F2)
                    .addFields(
                        { name: 'Group ID', value: `\`${data.id}\``, inline: true },
                        { name: 'Owner', value: ownerName, inline: true },
                        { name: 'Members', value: memberCount, inline: true },
                        { name: 'Entry Policy', value: data.publicEntryAllowed ? 'Public (Open Join)' : 'Private (Approval Required)', inline: true },
                        { name: 'Group Shout', value: data.shout?.body ? `"${data.shout.body}"\n*— ${data.shout.poster?.username || 'Staff'}*` : '*No active shout*', inline: false }
                    )
                    .setFooter({ text: 'Roblox Group' })
                    .setTimestamp();

                if (iconUrl) {
                    embed.setThumbnail(iconUrl);
                }

                const groupBtnRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('View Group')
                        .setURL(`https://www.roblox.com/groups/${data.id}`)
                        .setStyle(ButtonStyle.Link)
                );

                await interaction.editReply({ embeds: [embed], components: [groupBtnRow] });

            } catch (err) {
                console.error('Roblox Group Error:', err);
                await interaction.editReply('An error occurred while retrieving group details from Roblox.');
            }
        }
    }
};
