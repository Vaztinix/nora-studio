const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const axios = require('axios');
const RobloxVerify = require('../../database/models/RobloxVerify');
const settingsCache = require('../../utils/settingsCache');
const { handleError, handleSuccess } = require('../../utils/embeds');
const robloxSystem = require('../../utils/robloxSystem');
const verifyEngine = require('../../bot/engines/verify');

module.exports = {
    category: 'setup',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Official Server Verification and Account Gatekeeper.')
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('Complete server verification to unlock channels and claim your roles.')
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('View your current verification status and granted roles.')
        )
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Deploy or refresh the official verification panel (Admin only).')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to deploy the panel in (defaults to current channel)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
        )
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
        const subcommand = interaction.options.getSubcommand();
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

        if (!member) {
            return await handleError(interaction, 'Error', 'Failed to resolve guild member details.');
        }

        // ─────────────────────────────────────────────────────────────────────
        // SUBCOMMAND: START (Member initiates verification)
        // ─────────────────────────────────────────────────────────────────────
        if (subcommand === 'start') {
            if (!settings || (!settings.verifyRoleId && !settings.robloxVerifyRoleId)) {
                return await handleError(interaction, 'Not Configured', 'Verification has not been configured by the server administrators yet. Please ask an admin to set it up in Nora Studio or `/setup`.');
            }

            const isPremium = settings?.isPremium === true || settings?.isManualPremium === true;
            const maxRoles = isPremium ? 5 : 3;
            const targetRoleIds = (settings?.verifyRoleId || '').split(',').map(r => r.trim()).filter(Boolean).slice(0, maxRoles);

            // Check if user already has all verified roles
            const hasAllRoles = targetRoleIds.length > 0 && targetRoleIds.every(rId => member.roles.cache.has(rId));
            if (hasAllRoles) {
                const verifiedEmbed = new EmbedBuilder()
                    .setTitle('✅ Already Verified')
                    .setDescription(`You are already fully verified in **${interaction.guild.name}**!\n\n**Your Verified Roles:** ${targetRoleIds.map(id => `<@&${id}>`).join(' ')}`)
                    .setColor(0x2ea043)
                    .setFooter({ text: 'Nora Gatekeeper • Enterprise Verified' })
                    .setTimestamp();
                return await interaction.reply({ embeds: [verifiedEmbed], ephemeral: true });
            }

            const method = settings.verificationType || 'captcha';
            if (method === 'button') {
                return await verifyEngine.handleInstantButtonClick(interaction, settings);
            } else if (method === 'captcha') {
                return await verifyEngine.handleVerifyButtonClick(interaction, settings);
            } else if (method === 'reaction') {
                const channelMention = settings.verifyChannelId ? `<#${settings.verifyChannelId}>` : 'the verification channel';
                return await interaction.reply({
                    content: `ℹ️ This server uses **Reaction Verification**. Please head over to ${channelMention} and react with ${settings.verifyEmoji || '✅'} on the verification panel to gain access!`,
                    ephemeral: true
                });
            } else if (method === 'roblox') {
                return await interaction.reply({
                    content: '🎮 This server uses **Roblox Verification**! Use `/verify link <username>` to begin linking your Roblox profile.',
                    ephemeral: true
                });
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // SUBCOMMAND: STATUS (Check verification status)
        // ─────────────────────────────────────────────────────────────────────
        if (subcommand === 'status') {
            const isPremium = settings?.isPremium === true || settings?.isManualPremium === true;
            const maxRoles = isPremium ? 5 : 3;
            const targetRoleIds = (settings?.verifyRoleId || '').split(',').map(r => r.trim()).filter(Boolean).slice(0, maxRoles);
            const verifiedRoles = targetRoleIds.filter(rId => member.roles.cache.has(rId));
            const isVerified = targetRoleIds.length > 0 && verifiedRoles.length === targetRoleIds.length;

            const embed = new EmbedBuilder()
                .setTitle(`Verification Status: ${interaction.user.username}`)
                .setColor(isVerified ? 0x2ea043 : 0xffa500)
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: 'Status', value: isVerified ? '🟢 **Verified**' : '🟡 **Unverified**', inline: true },
                    { name: 'Gatekeeper Type', value: `\`${(settings?.verificationType || 'captcha').toUpperCase()}\``, inline: true },
                    { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Verified Roles', value: verifiedRoles.length > 0 ? verifiedRoles.map(id => `<@&${id}>`).join(' ') : '*None*', inline: false }
                )
                .setFooter({ text: 'Nora Gatekeeper • Status Matrix' })
                .setTimestamp();

            return await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // ─────────────────────────────────────────────────────────────────────
        // SUBCOMMAND: PANEL (Admin spawns or refreshes verification panel)
        // ─────────────────────────────────────────────────────────────────────
        if (subcommand === 'panel') {
            if (!member.permissions.has(PermissionFlagsBits.ManageGuild) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await handleError(interaction, 'Permission Denied', 'You require the **Manage Server** permission to deploy verification panels.');
            }

            if (!settings || (!settings.verifyRoleId && !settings.robloxVerifyRoleId)) {
                return await handleError(interaction, 'Configuration Required', 'Please configure your Verified Role in Nora Studio or `/setup` before spawning the panel.');
            }

            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
            if (!targetChannel.isTextBased()) {
                return await handleError(interaction, 'Invalid Channel', 'Verification panels can only be deployed in text or announcement channels.');
            }

            await interaction.deferReply({ ephemeral: true });
            try {
                const method = settings.verificationType || 'captcha';
                const sent = await verifyEngine.spawnVerificationPanel(targetChannel, settings, method, interaction);

                return await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('✅ Verification Panel Deployed')
                            .setColor(0x2ea043)
                            .setDescription(`Successfully deployed the **${method.toUpperCase()}** verification panel in ${targetChannel}!\n\n• **Target Channel:** <#${targetChannel.id}>\n• **Panel Message ID:** \`${sent.id}\`\n• **Gatekeeper Mode:** \`${method}\``)
                            .setFooter({ text: 'Nora Gatekeeper • Enterprise Deployment' })
                            .setTimestamp()
                    ]
                });
            } catch (err) {
                console.error('[Verify Panel Deploy Error]:', err);
                return await handleError(interaction, 'Deployment Error', `Failed to spawn panel: ${err.message}`);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // SUBCOMMANDS: ROBLOX INTEGRATION (link, check, unlink, list, switch)
        // ─────────────────────────────────────────────────────────────────────
        if (!settings || !settings.robloxVerifyEnabled) {
            return await handleError(interaction, 'Feature Disabled', 'Roblox verification is not enabled in this server.');
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
                const crypto = require('crypto');
                const verifyCode = `Nora-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                
                const existingPending = await RobloxVerify.findOne({
                    where: { userId: interaction.user.id, robloxId: robloxIdStr, status: 'PENDING' }
                });

                if (existingPending) {
                    await existingPending.update({ verifyCode });
                } else {
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
                        await record.update({ status: 'VERIFIED', isActive: true });
                        verifiedAny = true;
                        successList.push(username);

                        if (settings.robloxVerifyRoleId) {
                            const role = interaction.guild.roles.cache.get(settings.robloxVerifyRoleId);
                            if (role) {
                                await member.roles.add(role, 'Roblox Verification Complete').catch(e => console.error('Failed to grant role:', e));
                            }
                        }

                        let groupBindings = [];
                        try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) {}
                        if (groupBindings.length > 0) {
                            await robloxSystem.syncRobloxRolesWithBackoff(member, record.robloxId, groupBindings);
                        }
                    } else {
                        failedList.push(username);
                    }
                } catch (err) {
                    console.error('Check record error:', err);
                    failedList.push(record.robloxId);
                }
            }

            if (verifiedAny) {
                const embed = new EmbedBuilder()
                    .setTitle('Roblox Verification Results')
                    .setColor(0x2ecc71)
                    .setDescription(`Successfully verified: **${successList.join(', ')}**!\nYour roles have been updated.`)
                    .setTimestamp();
                if (failedList.length > 0) {
                    embed.addFields({ name: 'Still Pending', value: failedList.join(', ') });
                }
                return await interaction.editReply({ embeds: [embed] });
            } else {
                return await handleError(interaction, 'Verification Failed', `Code not found in the profile description of: **${failedList.join(', ')}**.\nEnsure you saved your Roblox About section, then try again.`);
            }
        }

        if (subcommand === 'unlink') {
            const usernameInput = interaction.options.getString('username');
            await interaction.deferReply({ ephemeral: true });

            try {
                let targetRecord = null;
                if (usernameInput) {
                    const searchRes = await axios.post('https://users.roblox.com/v1/usernames/users', {
                        usernames: [usernameInput],
                        excludeBannedUsers: true
                    });
                    if (searchRes.data.data.length) {
                        const rId = searchRes.data.data[0].id.toString();
                        targetRecord = await RobloxVerify.findOne({ where: { userId: interaction.user.id, robloxId: rId } });
                    }
                } else {
                    targetRecord = await RobloxVerify.findOne({ where: { userId: interaction.user.id, isActive: true } });
                }

                if (!targetRecord) {
                    return await handleError(interaction, 'Account Not Found', 'Could not find a linked Roblox account matching that username.');
                }

                await targetRecord.destroy();
                return await handleSuccess(interaction, 'Account Unlinked', 'Successfully unlinked your Roblox account.');
            } catch (err) {
                console.error('Roblox Unlink Error:', err);
                return await handleError(interaction, 'Error', 'An error occurred while unlinking the account.');
            }
        }

        if (subcommand === 'list') {
            await interaction.deferReply({ ephemeral: true });

            const accounts = await RobloxVerify.findAll({ where: { userId: interaction.user.id } });
            if (!accounts.length) {
                return await handleError(interaction, 'No Accounts Linked', 'You have not linked any Roblox accounts yet. Use `/verify link` to connect one.');
            }

            const resolved = [];
            for (const acc of accounts) {
                let name = 'Unknown';
                try {
                    const res = await axios.get(`https://users.roblox.com/v1/users/${acc.robloxId}`);
                    name = res.data.name;
                } catch (e) {}
                resolved.push({
                    username: name,
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
                const searchRes = await axios.post('https://users.roblox.com/v1/usernames/users', {
                    usernames: [usernameInput],
                    excludeBannedUsers: true
                });

                if (!searchRes.data.data.length) {
                    return await handleError(interaction, 'User Not Found', `Roblox user **${usernameInput}** was not found.`);
                }

                const robloxId = searchRes.data.data[0].id.toString();
                const record = await RobloxVerify.findOne({
                    where: { userId: interaction.user.id, robloxId, status: 'VERIFIED' }
                });

                if (!record) {
                    return await handleError(interaction, 'Not Verified', `You do not have a verified Roblox link for **${usernameInput}**. Please link and verify it first.`);
                }

                await RobloxVerify.update(
                    { isActive: false },
                    { where: { userId: interaction.user.id } }
                );
                await record.update({ isActive: true });

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
