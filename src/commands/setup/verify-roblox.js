const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const RobloxVerify = require('../../database/models/RobloxVerify');
const GuildSettings = require('../../database/models/GuildSettings');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify-roblox')
        .setDescription('Verify your Roblox account and gain a role.')
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
        const guildId = interaction.guildId;
        const settings = await GuildSettings.findOne({ where: { guildId } });

        if (!settings || !settings.robloxVerifyEnabled) {
            return interaction.reply({ content: 'Roblox verification is not enabled in this server.', flags: 64 });
        }

        const existing = await RobloxVerify.findOne({ where: { userId: interaction.user.id, status: 'VERIFIED' } });
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'link' && existing) {
            return interaction.reply({ content: `You are already verified as Roblox ID: \`${existing.robloxId}\`. If you need to change this, please use the Reset Global Data feature on the Nora Dashboard.`, flags: 64 });
        }

        if (subcommand === 'link') {
            const username = interaction.options.getString('username');
            await interaction.deferReply({ flags: 64 });

            try {
                // Search for user on Roblox using the more precise Username to ID API
                const searchRes = await axios.post('https://users.roblox.com/v1/usernames/users', {
                    usernames: [username],
                    excludeBannedUsers: true
                });

                if (!searchRes.data.data.length) {
                    return interaction.editReply('Roblox user not found. Please check the spelling.');
                }

                const robloxUser = searchRes.data.data[0];
                // Map API field 'id' to 'robloxUser.id' for consistency with rest of code
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
                        { name: '3. Finalize', value: 'Once updated, run `/verify-roblox check` to complete the verification.' }
                    )
                    .setColor(0x00A2FF)
                    .setFooter({ text: 'Note: You can remove the code once verified.' });

                await interaction.editReply({ embeds: [embed] });

            } catch (err) {
                console.error('Roblox Link Error:', err);
                await interaction.editReply('An error occurred while connecting to Roblox API.');
            }
        }

        if (subcommand === 'check') {
            await interaction.deferReply({ flags: 64 });

            const record = await RobloxVerify.findOne({ where: { userId: interaction.user.id } });
            if (!record || !record.robloxId) {
                return interaction.editReply('Please run `/verify-roblox link` first.');
            }

            try {
                // Fetch Roblox profile
                const profileRes = await axios.get(`https://users.roblox.com/v1/users/${record.robloxId}`);
                const description = profileRes.data.description || '';

                if (description.includes(record.verifyCode)) {
                    // Success
                    const role = interaction.guild.roles.cache.get(settings.robloxVerifyRoleId);
                    if (role) {
                        await interaction.member.roles.add(role).catch(e => console.error('Failed to add Roblox role:', e));
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
                    await interaction.editReply(`Verification failed. We couldn't find the code \`${record.verifyCode}\` in your Roblox profile description. Please make sure you saved the changes.`);
                }
            } catch (err) {
                console.error('Roblox Check Error:', err);
                await interaction.editReply('An error occurred while checking your Roblox profile.');
            }
        }

        if (subcommand === 'unlink') {
            await interaction.deferReply({ flags: 64 });
            const record = await RobloxVerify.findOne({ where: { userId: interaction.user.id } });
            
            if (!record) {
                return interaction.editReply('You do not have a linked Roblox account.');
            }

            await record.destroy();

            // Optionally remove role if it exists
            const role = interaction.guild.roles.cache.get(settings.robloxVerifyRoleId);
            if (role && interaction.member.roles.cache.has(role.id)) {
                await interaction.member.roles.remove(role).catch(() => {});
            }

            await interaction.editReply({ content: 'Successfully unlinked your Roblox account and removed any associated roles.' });
        }
    }
};
