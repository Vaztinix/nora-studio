const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const RobloxVerify = require('../../database/models/RobloxVerify');
const settingsCache = require('../../utils/settingsCache');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'setup',
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verify your Roblox account to gain a role.')
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('link')
                .setDescription('Link your Roblox account by providing your username.')
                .addStringOption(opt => opt.setName('username').setDescription('Your Roblox Username').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('check')
                .setDescription('Check if you have added the verification code to your Roblox profile.')
        )
        .addSubcommand(sub =>
            sub.setName('unlink')
                .setDescription('Unlink your Roblox account from Nora.')
        ),

    async execute(interaction) {
        const settings = await settingsCache.get(interaction.guild.id);

        if (!settings || !settings.robloxVerifyEnabled) {
            return await handleError(interaction, 'Feature Disabled', 'Roblox verification is not enabled in this server.');
        }

        const existing = await RobloxVerify.findOne({ where: { userId: interaction.user.id, status: 'VERIFIED' } });
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'link' && existing) {
            return await handleError(interaction, 'Already Verified', `You are already verified as Roblox ID: \`${existing.robloxId}\`. If you need to change this, please use the Reset Global Data feature on the Nora Dashboard.`);
        }

        if (subcommand === 'link') {
            const username = interaction.options.getString('username');
            await interaction.deferReply({ ephemeral: true });

            try {
                const searchRes = await axios.post('https://users.roblox.com/v1/usernames/users', {
                    usernames: [username],
                    excludeBannedUsers: true
                });

                if (!searchRes.data.data.length) {
                    return await handleError(interaction, 'User Not Found', 'Roblox user not found. Please check the spelling.');
                }

                const robloxUser = searchRes.data.data[0];
                robloxUser.displayName = robloxUser.displayName || robloxUser.requestedUsername;
                robloxUser.name = robloxUser.name || robloxUser.requestedUsername;
                const verifyCode = `Nora-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

                await RobloxVerify.upsert({
                    userId: interaction.user.id,
                    robloxId: robloxUser.id.toString(),
                    verifyCode: verifyCode,
                    status: 'PENDING'
                });

                const embed = new EmbedBuilder()
                    .setTitle('Roblox Verification Link')
                    .setDescription(`To verify your account **${robloxUser.displayName} (@${robloxUser.name})**, please follow these steps:`)
                    .addFields(
                        { name: '1. Copy this code', value: `\`${verifyCode}\`` },
                        { name: '2. Update Roblox Profile', value: 'Go to your Roblox Profile Settings and paste the code into your **About** section (Description).' },
                        { name: '3. Finalize', value: 'Once updated, run `/verify check` to complete the verification.' }
                    )
                    .setColor(0x00A2FF)
                    .setFooter({ text: 'Note: You can remove the code once verified.' });

                await interaction.editReply({ embeds: [embed] });

            } catch (err) {
                console.error('Roblox Link Error:', err);
                return await handleError(interaction, 'Connection Error', 'An error occurred while connecting to Roblox API.');
            }
        }

        if (subcommand === 'check') {
            await interaction.deferReply({ ephemeral: true });

            const record = await RobloxVerify.findOne({ where: { userId: interaction.user.id } });
            if (!record || !record.robloxId) {
                return await handleError(interaction, 'Link Required', 'Please run `/verify link` first.');
            }

            try {
                const profileRes = await axios.get(`https://users.roblox.com/v1/users/${record.robloxId}`);
                const description = profileRes.data.description || '';

                if (description.includes(record.verifyCode)) {
                    const role = interaction.guild.roles.cache.get(settings.robloxVerifyRoleId);
                    if (role) {
                        await interaction.guild.members.fetch(interaction.user.id).then(async member => {
                            await member.roles.add(role).catch(e => console.error('Failed to add Roblox role:', e));
                        }).catch(() => {});
                    }

                    await record.update({ status: 'VERIFIED' });

                    const embed = new EmbedBuilder()
                        .setTitle('Verification Successful!')
                        .setDescription(`Your Roblox account has been successfully linked to your Discord profile.`)
                        .addFields({ name: 'Roblox ID', value: record.robloxId })
                        .setColor(0x2ea043);

                    if (settings.robloxVerifyRoleId) {
                        embed.addFields({ name: 'Role Granted', value: `<@&${settings.robloxVerifyRoleId}>` });
                    }

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    return await handleError(interaction, 'Verification Failed', `We couldn't find the code \`${record.verifyCode}\` in your Roblox profile description. Please make sure you saved the changes.`);
                }
            } catch (err) {
                console.error('Roblox Check Error:', err);
                return await handleError(interaction, 'API Error', 'An error occurred while checking your Roblox profile.');
            }
        }

        if (subcommand === 'unlink') {
            await interaction.deferReply({ ephemeral: true });
            const record = await RobloxVerify.findOne({ where: { userId: interaction.user.id } });
            
            if (!record) {
                return await handleError(interaction, 'Not Linked', 'You do not have a linked Roblox account.');
            }

            await record.destroy();

            const role = interaction.guild.roles.cache.get(settings.robloxVerifyRoleId);
            if (role) {
                await interaction.guild.members.fetch(interaction.user.id).then(async member => {
                    if (member.roles.cache.has(role.id)) {
                        await member.roles.remove(role).catch(() => {});
                    }
                }).catch(() => {});
            }

            return await handleSuccess(interaction, 'Roblox Unlinked', 'Successfully unlinked your Roblox account and removed any associated roles.');
        }
    }
};
