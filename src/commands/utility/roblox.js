const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('roblox')
        .setDescription('Roblox integration utility commands.')
        .addSubcommand(sub =>
            sub.setName('profile')
                .setDescription('View a Roblox user\'s profile details and avatar.')
                .addStringOption(opt => opt.setName('user').setDescription('Roblox Username or User ID').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('group')
                .setDescription('View details about a Roblox group.')
                .addStringOption(opt => opt.setName('id').setDescription('Roblox Group ID').setRequired(true))
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply();

        if (subcommand === 'profile') {
            const userInput = interaction.options.getString('user').trim();
            let userId = null;
            let username = userInput;

            try {
                // Try resolving as username first
                const resolveRes = await axios.post('https://users.roblox.com/v1/usernames/users', {
                    usernames: [userInput],
                    excludeBannedUsers: false
                });

                if (resolveRes.data && resolveRes.data.data && resolveRes.data.data.length > 0) {
                    userId = resolveRes.data.data[0].id;
                    username = resolveRes.data.data[0].name;
                } else if (/^\d+$/.test(userInput)) {
                    // Fall back to treating it directly as a User ID
                    userId = userInput;
                }

                if (!userId) {
                    return interaction.editReply(`Could not find a Roblox user matching \`${userInput}\`.`);
                }

                // Fetch full profile details
                const profileRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
                const data = profileRes.data;

                // Fetch avatar thumbnail
                let avatarUrl = null;
                try {
                    const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=352x352&format=Png&isCircular=false`);
                    if (thumbRes.data && thumbRes.data.data && thumbRes.data.data.length > 0) {
                        avatarUrl = thumbRes.data.data[0].imageUrl;
                    }
                } catch (thumbErr) {
                    console.error('Error fetching Roblox avatar thumbnail:', thumbErr);
                }

                const createdDate = data.created ? new Date(data.created).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown';

                const embed = new EmbedBuilder()
                    .setTitle(`${data.displayName} (@${data.name})`)
                    .setURL(`https://www.roblox.com/users/${data.id}/profile`)
                    .setDescription(data.description || '*No bio provided.*')
                    .addFields(
                        { name: 'User ID', value: `\`${data.id}\``, inline: true },
                        { name: 'Join Date', value: createdDate, inline: true },
                        { name: 'Status', value: data.isBanned ? 'Banned' : 'Active', inline: true }
                    )
                    .setColor(0x00A2FF)
                    .setTimestamp();

                if (avatarUrl) {
                    embed.setThumbnail(avatarUrl);
                }

                await interaction.editReply({ embeds: [embed] });

            } catch (err) {
                console.error('Roblox Profile Command Error:', err);
                await interaction.editReply('An error occurred while fetching details from the Roblox API.');
            }
        }

        if (subcommand === 'group') {
            const groupId = interaction.options.getString('id').trim();

            if (!/^\d+$/.test(groupId)) {
                return interaction.editReply('Please provide a valid numeric Roblox Group ID.');
            }

            try {
                // Fetch group details
                const groupRes = await axios.get(`https://groups.roblox.com/v1/groups/${groupId}`);
                const data = groupRes.data;

                // Fetch group icon thumbnail
                let iconUrl = null;
                try {
                    const iconRes = await axios.get(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${groupId}&size=150x150&format=Png`);
                    if (iconRes.data && iconRes.data.data && iconRes.data.data.length > 0) {
                        iconUrl = iconRes.data.data[0].imageUrl;
                    }
                } catch (iconErr) {
                    console.error('Error fetching Roblox group icon:', iconErr);
                }

                const ownerName = data.owner ? `${data.owner.displayName} (@${data.owner.username})` : 'No Owner';
                const ownerLink = data.owner ? `https://www.roblox.com/users/${data.owner.id}/profile` : null;

                const embed = new EmbedBuilder()
                    .setTitle(data.name)
                    .setURL(`https://www.roblox.com/groups/${data.id}`)
                    .setDescription(data.description || '*No description provided.*')
                    .addFields(
                        { name: 'Group ID', value: `\`${data.id}\``, inline: true },
                        { name: 'Members', value: (data.memberCount || 0).toLocaleString(), inline: true },
                        { name: 'Owner', value: ownerLink ? `[${ownerName}](${ownerLink})` : ownerName, inline: true }
                    )
                    .setColor(0x00A2FF)
                    .setTimestamp();

                if (data.shout) {
                    const posterName = data.shout.poster ? `${data.shout.poster.displayName} (@${data.shout.poster.username})` : 'Unknown';
                    embed.addFields({
                        name: 'Current Shout',
                        value: `**Posted by ${posterName}:**\n${data.shout.body}`
                    });
                }

                if (iconUrl) {
                    embed.setThumbnail(iconUrl);
                }

                await interaction.editReply({ embeds: [embed] });

            } catch (err) {
                console.error('Roblox Group Command Error:', err);
                if (err.response && err.response.status === 404) {
                    await interaction.editReply(`Roblox Group with ID \`${groupId}\` was not found.`);
                } else {
                    await interaction.editReply('An error occurred while fetching details from the Roblox API.');
                }
            }
        }
    }
};
