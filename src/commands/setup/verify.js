const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const RobloxVerify = require('../../database/models/RobloxVerify');
const settingsCache = require('../../utils/settingsCache');
const { handleError, handleSuccess } = require('../../utils/embeds');
const robloxSystem = require('../../utils/robloxSystem');

module.exports = {
    category: 'setup',
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verify your Roblox account to gain a role.')
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('link')
                .setDescription('Link a Roblox account by providing its username.')
                .addStringOption(opt => opt.setName('username').setDescription('Your Roblox Username').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('check')
                .setDescription('Check if you have added the verification code to your Roblox profile description.')
        )
        .addSubcommand(sub =>
            sub.setName('unlink')
                .setDescription('Unlink a linked Roblox account.')
                .addStringOption(opt => opt.setName('username').setDescription('The Roblox username to unlink (default: active)').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all your linked Roblox accounts.')
        )
        .addSubcommand(sub =>
            sub.setName('switch')
                .setDescription('Switch your currently active Roblox account.')
                .addStringOption(opt => opt.setName('username').setDescription('The Roblox username to make active').setRequired(true))
        ),

    async execute(interaction) {
        const settings = await settingsCache.get(interaction.guild.id);

        if (!settings || !settings.robloxVerifyEnabled) {
            return await handleError(interaction, 'Feature Disabled', 'Roblox verification is not enabled in this server.');
        }

        const subcommand = interaction.options.getSubcommand();
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
            return await handleError(interaction, 'Error', 'Failed to resolve guild member details.');
        }

        if (subcommand === 'link') {
            const username = interaction.options.getString('username');
            await interaction.deferReply({ ephemeral: true });

            try {
                // 1. Resolve username on Roblox API
                const searchRes = await axios.post('https://users.roblox.com/v1/usernames/users', {
                    usernames: [username],
                    excludeBannedUsers: true
                });

                if (!searchRes.data.data.length) {
                    return await handleError(interaction, 'User Not Found', 'Roblox user not found. Please check the spelling.');
                }

                const robloxUser = searchRes.data.data[0];
                const robloxIdStr = robloxUser.id.toString();

                // 2. Check if this Roblox ID is already verified by someone else
                const alreadyVerifiedByOther = await RobloxVerify.findOne({
                    where: { robloxId: robloxIdStr, status: 'VERIFIED', userId: { [require('sequelize').Op.ne]: interaction.user.id } }
                });

                if (alreadyVerifiedByOther) {
                    return await handleError(interaction, 'Already Claimed', 'This Roblox account is already verified by another user.');
                }

                // 3. Check if user already verified this exact Roblox account
                const userExisting = await RobloxVerify.findOne({
                    where: { userId: interaction.user.id, robloxId: robloxIdStr, status: 'VERIFIED' }
                });
                if (userExisting) {
                    return await handleError(interaction, 'Already Verified', `You have already linked and verified **${username}**.`);
                }

                // 4. Generate verification code and create pending record
                const verifyCode = `Nora-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                
                // Find pending or overwrite
                const existingPending = await RobloxVerify.findOne({
                    where: { userId: interaction.user.id, robloxId: robloxIdStr, status: 'PENDING' }
                });

                if (existingPending) {
                    await existingPending.update({ verifyCode });
                } else {
                    // Check limit of verified/pending accounts (cap at 10 to prevent abuse)
                    const count = await RobloxVerify.count({ where: { userId: interaction.user.id } });
                    if (count >= 10) {
                        return await handleError(interaction, 'Limit Reached', 'You cannot link more than 10 Roblox accounts.');
                    }

                    await RobloxVerify.create({
                        userId: interaction.user.id,
                        robloxId: robloxIdStr,
                        verifyCode: verifyCode,
                        status: 'PENDING',
                        isActive: false
                    });
                }

                const embed = new EmbedBuilder()
                    .setTitle('Roblox Verification Link')
                    .setDescription(`To verify ownership of **${robloxUser.displayName} (@${robloxUser.name})**, follow these steps:`)
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

            const pending = await RobloxVerify.findAll({ where: { userId: interaction.user.id, status: 'PENDING' } });
            if (!pending.length) {
                return await handleError(interaction, 'No Pending Requests', 'You do not have any pending Roblox accounts waiting to be checked. Use `/verify link` first.');
            }

            let verifiedAny = false;
            let successList = [];
            let failedList = [];

            for (const record of pending) {
                try {
                    const profileRes = await axios.get(`https://users.roblox.com/v1/users/${record.robloxId}`);
                    const description = profileRes.data.description || '';
                    const username = profileRes.data.name;

                    if (description.includes(record.verifyCode)) {
                        // Mark as verified
                        await record.update({ status: 'VERIFIED', isActive: true });
                        verifiedAny = true;
                        successList.push(username);

                        // Deactivate other verified accounts of the user
                        await RobloxVerify.update(
                            { isActive: false },
                            {
                                where: {
                                    userId: interaction.user.id,
                                    robloxId: { [require('sequelize').Op.ne]: record.robloxId }
                                }
                            }
                        );
                    } else {
                        failedList.push({ username, code: record.verifyCode });
                    }
                } catch (e) {
                    console.error(`Check error for robloxId ${record.robloxId}:`, e);
                }
            }

            if (verifiedAny) {
                // Find active verified account (which is the one we just activated)
                const activeRecord = await RobloxVerify.findOne({ where: { userId: interaction.user.id, status: 'VERIFIED', isActive: true } });
                
                if (activeRecord) {
                    // Grant base verification role
                    if (settings.robloxVerifyRoleId) {
                        const role = interaction.guild.roles.cache.get(settings.robloxVerifyRoleId);
                        if (role) {
                            await member.roles.add(role).catch(e => console.error('Failed to grant Roblox role:', e));
                        }
                    }

                    // Sync group bindings
                    let groupBindings = [];
                    try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) {}
                    if (groupBindings.length > 0) {
                        await robloxSystem.syncRobloxRolesWithBackoff(member, activeRecord.robloxId, groupBindings);
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle('Verification Success!')
                    .setDescription(`Successfully verified and linked: **${successList.join(', ')}**.\nThis account is now marked as your **active** Roblox profile.`)
                    .setColor(0x2ea043);

                if (failedList.length > 0) {
                    embed.addFields({
                        name: 'Pending / Code Missing',
                        value: failedList.map(item => `**${item.username}**: code \`${item.code}\` not found in description.`).join('\n')
                    });
                }

                await interaction.editReply({ embeds: [embed] });
            } else {
                const descriptionLines = failedList.map(item => `**${item.username}**: add code \`${item.code}\` to your description.`);
                return await handleError(interaction, 'Verification Failed', `We could not find the required verification codes in your Roblox profiles.\n\n${descriptionLines.join('\n')}`);
            }
        }

        if (subcommand === 'unlink') {
            const usernameInput = interaction.options.getString('username');
            await interaction.deferReply({ ephemeral: true });

            let record;
            if (usernameInput) {
                // Find the Roblox ID of the username input first
                try {
                    const searchRes = await axios.post('https://users.roblox.com/v1/usernames/users', {
                        usernames: [usernameInput],
                        excludeBannedUsers: true
                    });
                    if (searchRes.data.data.length > 0) {
                        const robloxId = searchRes.data.data[0].id.toString();
                        record = await RobloxVerify.findOne({ where: { userId: interaction.user.id, robloxId } });
                    }
                } catch (e) {
                    console.error('Unlink username resolve failure:', e);
                }
            } else {
                // Default to unlinking the active verified account
                record = await RobloxVerify.findOne({ where: { userId: interaction.user.id, isActive: true } });
            }

            if (!record) {
                return await handleError(interaction, 'Not Linked', usernameInput ? `Could not find a linked Roblox account with username **${usernameInput}**.` : 'You do not have an active verified Roblox account.');
            }

            const wasActive = record.isActive;
            const unlinkedRobloxId = record.robloxId;
            await record.destroy();

            // If we deleted the active account, set another verified account to active
            if (wasActive) {
                const remaining = await RobloxVerify.findOne({ where: { userId: interaction.user.id, status: 'VERIFIED' } });
                if (remaining) {
                    await remaining.update({ isActive: true });
                    // Sync roles for the new active account
                    let groupBindings = [];
                    try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) {}
                    if (groupBindings.length > 0) {
                        await robloxSystem.syncRobloxRolesWithBackoff(member, remaining.robloxId, groupBindings);
                    }
                } else {
                    // Remove verification role if no active verified accounts remain
                    if (settings.robloxVerifyRoleId) {
                        const role = interaction.guild.roles.cache.get(settings.robloxVerifyRoleId);
                        if (role && member.roles.cache.has(role.id)) {
                            await member.roles.remove(role).catch(() => {});
                        }
                    }

                    // Remove group synced roles
                    let groupBindings = [];
                    try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) {}
                    for (const binding of groupBindings) {
                        const role = interaction.guild.roles.cache.get(binding.roleId);
                        if (role && member.roles.cache.has(role.id)) {
                            await member.roles.remove(role).catch(() => {});
                        }
                    }
                }
            }

            return await handleSuccess(interaction, 'Roblox Unlinked', `Successfully unlinked the Roblox account matching ID \`${unlinkedRobloxId}\`.`);
        }

        if (subcommand === 'list') {
            await interaction.deferReply({ ephemeral: true });

            const accounts = await RobloxVerify.findAll({ where: { userId: interaction.user.id } });
            if (!accounts.length) {
                return await handleError(interaction, 'No Accounts', 'You have no Roblox accounts linked to Nora. Use `/verify link` to link one.');
            }

            // Resolve usernames to display
            const resolved = [];
            for (const acc of accounts) {
                let username = `ID: ${acc.robloxId}`;
                try {
                    const profileRes = await axios.get(`https://users.roblox.com/v1/users/${acc.robloxId}`);
                    username = profileRes.data.name;
                } catch (e) {}
                resolved.push({
                    username,
                    status: acc.status,
                    active: acc.isActive,
                    robloxId: acc.robloxId
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('Your Linked Roblox Accounts')
                .setColor(0x00A2FF)
                .setDescription('Below is a list of your linked Roblox profiles. The active profile is used for server role verification sync.')
                .setTimestamp();

            resolved.forEach(acc => {
                const activeTag = acc.active ? '🟢 **Active**' : '⚪ Inactive';
                const statusTag = acc.status === 'VERIFIED' ? '✅ Verified' : '⚠️ Pending Verification';
                embed.addFields({
                    name: `${acc.username} (${acc.robloxId})`,
                    value: `${activeTag} | ${statusTag}`
                });
            });

            await interaction.editReply({ embeds: [embed] });
        }

        if (subcommand === 'switch') {
            const usernameInput = interaction.options.getString('username');
            await interaction.deferReply({ ephemeral: true });

            try {
                // Find Roblox ID of target username
                const searchRes = await axios.post('https://users.roblox.com/v1/usernames/users', {
                    usernames: [usernameInput],
                    excludeBannedUsers: true
                });

                if (!searchRes.data.data.length) {
                    return await handleError(interaction, 'User Not Found', `Roblox user **${usernameInput}** was not found.`);
                }

                const robloxId = searchRes.data.data[0].id.toString();

                // Find verified record
                const record = await RobloxVerify.findOne({
                    where: { userId: interaction.user.id, robloxId, status: 'VERIFIED' }
                });

                if (!record) {
                    return await handleError(interaction, 'Not Verified', `You do not have a verified Roblox link for **${usernameInput}**. Please link and verify it first.`);
                }

                // Switch active flag
                await RobloxVerify.update(
                    { isActive: false },
                    { where: { userId: interaction.user.id } }
                );
                await record.update({ isActive: true });

                // Sync roles for new active account
                let groupBindings = [];
                try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) {}
                if (groupBindings.length > 0) {
                    await robloxSystem.syncRobloxRolesWithBackoff(member, record.robloxId, groupBindings);
                }

                return await handleSuccess(interaction, 'Active Account Switched', `Your active Roblox profile has been set to **${usernameInput}**. Your roles have been synchronized.`);
            } catch (err) {
                console.error('Roblox Switch Error:', err);
                return await handleError(interaction, 'Error', 'An error occurred while switching accounts.');
            }
        }
    }
};
