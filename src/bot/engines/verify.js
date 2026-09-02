const { 
    PermissionFlagsBits, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder, 
    AttachmentBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder 
} = require('discord.js');
const sharp = require('sharp');
const settingsCache = require('../../utils/settingsCache');

function generateRandomCaptcha(length = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing characters like O, 0, I, 1
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateSvgCaptcha(text) {
    const width = 200;
    const height = 80;
    
    // Background noise circles/lines
    let noise = '';
    for (let i = 0; i < 6; i++) {
        const x1 = Math.random() * width;
        const y1 = Math.random() * height;
        const x2 = Math.random() * width;
        const y2 = Math.random() * height;
        noise += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.2)" stroke-width="${1 + Math.random() * 2}"/>`;
    }
    for (let i = 0; i < 40; i++) {
        const cx = Math.random() * width;
        const cy = Math.random() * height;
        const r = 1 + Math.random() * 3;
        noise += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,255,0.15)"/>`;
    }
    
    // Draw rotated and scaled characters
    let textElements = '';
    const charWidth = width / (text.length + 1);
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const x = (i + 0.5) * charWidth + (Math.random() * 10 - 5);
        const y = 50 + (Math.random() * 15 - 7.5);
        const angle = Math.random() * 40 - 20; // Rotate between -20 and 20 degrees
        const fontSize = 30 + Math.round(Math.random() * 12);
        
        // Random color shades (Nora cyan/blue theme)
        const r = 100 + Math.floor(Math.random() * 155);
        const g = 100 + Math.floor(Math.random() * 155);
        const b = 200 + Math.floor(Math.random() * 55);
        
        textElements += `<text x="${x}" y="${y}" fill="rgb(${r},${g},${b})" font-size="${fontSize}" font-family="sans-serif" font-weight="bold" transform="rotate(${angle} ${x} ${y})">${char}</text>`;
    }
    
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background-color: #0f111a;">
        ${noise}
        ${textElements}
        ${noise}
    </svg>`;
}

/**
 * Universal helper to grant configured verification roles to a member and dispatch audit logs
 */
async function grantVerificationRoles(member, settings, context = {}, method = 'Standard') {
    if (!member || !member.guild) {
        return { success: false, message: 'Could not resolve guild member profile.' };
    }

    const guild = member.guild;
    const isPremium = settings?.isPremium === true || settings?.isManualPremium === true;
    const maxVerifiedRoles = isPremium ? 5 : 3;
    const targetRoleIds = (settings?.verifyRoleId || '').split(',').map(r => r.trim()).filter(Boolean).slice(0, maxVerifiedRoles);

    if (!targetRoleIds.length) {
        return { success: false, message: '⚠️ **Verification Not Configured**: An administrator has not assigned a verified role yet. Please ask an admin to configure it in `/setup` or Nora Studio.' };
    }

    if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return { success: false, message: '⚠️ I lack the **Manage Roles** permission to grant verification roles.' };
    }

    const botHighest = guild.members.me.roles.highest.position;
    let rolesAdded = 0;
    let alreadyHasAll = true;

    for (const rId of targetRoleIds) {
        const roleObj = guild.roles.cache.get(rId) || await guild.roles.fetch(rId).catch(() => null);
        if (!roleObj) continue;

        if (roleObj.position >= botHighest) {
            return { success: false, message: `⚠️ I cannot assign <@&${roleObj.id}> because it is higher than or equal to my highest role.` };
        }

        if (!member.roles.cache.has(rId)) {
            alreadyHasAll = false;
            try {
                await member.roles.add(rId);
                rolesAdded++;
            } catch (err) {
                console.error(`Failed to assign verified role ${rId}:`, err);
            }
        }
    }

    // Automatically remove unverified role(s) upon successful verification
    const shouldRemoveUnverified = settings?.removeUnverifiedRoleOnVerify !== false;
    if (shouldRemoveUnverified) {
        const unverifiedRoleIds = [];
        if (settings?.unverifiedRoleId) {
            unverifiedRoleIds.push(...settings.unverifiedRoleId.split(',').map(r => r.trim()).filter(Boolean));
        }

        // If no explicit role ID configured, automatically check if member has a role named "Unverified"
        if (unverifiedRoleIds.length === 0) {
            const namedUnverified = member.roles.cache.find(r => r.name.toLowerCase() === 'unverified');
            if (namedUnverified) {
                unverifiedRoleIds.push(namedUnverified.id);
            }
        }

        for (const uId of unverifiedRoleIds) {
            if (member.roles.cache.has(uId)) {
                const unvRoleObj = guild.roles.cache.get(uId) || await guild.roles.fetch(uId).catch(() => null);
                if (unvRoleObj && unvRoleObj.position < botHighest) {
                    try {
                        await member.roles.remove(uId, `Nora Verification: Member completed ${method} verification, unverified role removed.`);
                    } catch (remErr) {
                        console.error(`Failed to remove unverified role ${uId}:`, remErr.message);
                    }
                }
            }
        }
    }

    if (alreadyHasAll) {
        return { success: true, alreadyVerified: true, message: 'You are already verified on this server!' };
    }

    // Send Audit Log if configured
    try {
        let loggingChannels = {};
        if (typeof settings?.loggingChannels === 'object' && settings.loggingChannels !== null) {
            loggingChannels = settings.loggingChannels;
        } else if (typeof settings?.loggingChannels === 'string') {
            try { loggingChannels = JSON.parse(settings.loggingChannels); } catch(e) {}
        }

        const logChannelId = loggingChannels.members || settings?.loggingChannelId || settings?.verificationLogChannelId;
        if (logChannelId) {
            const logChannel = guild.channels.cache.get(logChannelId) || await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('✅ Member Verified')
                    .setDescription(`${member.user} (${member.user.tag}) completed **${method}** verification.`)
                    .addFields(
                        { name: 'User ID', value: `\`${member.user.id}\``, inline: true },
                        { name: 'Method', value: `\`${method}\``, inline: true },
                        { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    )
                    .setColor(0x2ea043)
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
            }
        }
    } catch (logErr) {
        console.error('[Verification Log Error]:', logErr);
    }

    return { success: true, alreadyVerified: false, rolesAdded, message: '✅ **Verification Successful!** You have been verified and granted access.' };
}

/**
 * 1-Click Instant Button Verification
 */
async function handleInstantButtonClick(interaction, settings) {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const result = await grantVerificationRoles(member, settings, { interaction }, '1-Click Button');

    if (!result.success) {
        if (interaction.deferred || interaction.replied) {
            return await interaction.editReply({ content: result.message }).catch(() => {});
        }
        return await interaction.reply({ content: result.message, ephemeral: true }).catch(() => {});
    }

    if (result.alreadyVerified) {
        const text = 'ℹ️ You are already verified on this server!';
        if (interaction.deferred || interaction.replied) {
            return await interaction.editReply({ content: text }).catch(() => {});
        }
        return await interaction.reply({ content: text, ephemeral: true }).catch(() => {});
    }

    const embed = new EmbedBuilder()
        .setColor(0x2ea043)
        .setTitle('✅ Access Granted')
        .setDescription('You have successfully verified and unlocked full server access! Welcome to the community.')
        .setTimestamp();

    if (interaction.deferred || interaction.replied) {
        return await interaction.editReply({ embeds: [embed] }).catch(() => {});
    }
    return await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
}

/**
 * Sends the dynamic CAPTCHA image with an "Enter Code" button when the user clicks Verify.
 */
async function handleVerifyButtonClick(interaction, settings) {
    try {
        const verifyType = settings?.verificationType || 'captcha';

        // If server is configured for 1-Click Button verification, do instant verification
        if (verifyType === 'button') {
            return await handleInstantButtonClick(interaction, settings);
        }

        if (!settings || !settings.verifyRoleId) {
            const msg = '⚠️ **Verification Not Configured**: An administrator has not assigned a verified role yet. Please ask a server admin to configure the Verified Role in `/setup`.';
            if (interaction.deferred || interaction.replied) {
                return await interaction.editReply({ content: msg }).catch(() => {});
            } else {
                return await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
            }
        }

        const captchaCode = generateRandomCaptcha(6);
        const svgString = generateSvgCaptcha(captchaCode);
        
        let pngBuffer = null;
        try {
            pngBuffer = await sharp(Buffer.from(svgString)).png().toBuffer();
        } catch (e) {
            console.warn('[Verification Engine] Captcha image rendering failed:', e.message);
        }

        const enterCodeBtn = new ButtonBuilder()
            .setCustomId(`verify_enter_code_${captchaCode}`)
            .setLabel('Enter CAPTCHA Code')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔏');

        const row = new ActionRowBuilder().addComponents(enterCodeBtn);

        const payload = {
            content: '🔒 **Security Verification**\nPlease look at the image below and click the button to enter the CAPTCHA code.',
            files: pngBuffer ? [{ attachment: pngBuffer, name: 'captcha.png' }] : [],
            components: [row],
            ephemeral: true
        };

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply(payload);
        }
    } catch (err) {
        console.error('[Verification Engine] Error handling verify button click:', err);
        const errPayload = { content: '⚠️ An error occurred while generating the CAPTCHA image. Please try clicking Verify again.', ephemeral: true };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errPayload).catch(() => {});
        } else {
            await interaction.reply(errPayload).catch(() => {});
        }
    }
}

/**
 * Presents the Modal to the user when they click "Enter CAPTCHA Code"
 */
async function handleEnterCodeButtonClick(interaction) {
    const captchaCode = interaction.customId.replace('verify_enter_code_', '');

    const modal = new ModalBuilder()
        .setCustomId(`verify_modal_submit_${captchaCode}`)
        .setTitle('Enter CAPTCHA Code');

    const captchaInput = new TextInputBuilder()
        .setCustomId('captcha_answer')
        .setLabel('Enter the code you see in the image')
        .setPlaceholder('e.g. A1B2C3')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(6)
        .setMaxLength(6);

    const row = new ActionRowBuilder().addComponents(captchaInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

/**
 * Handles verify modal submission, checking the captcha response and granting configured verification roles.
 */
async function handleVerifyModalSubmit(interaction, settings) {
    await interaction.deferReply({ ephemeral: true });
    
    const customId = interaction.customId;
    const expectedAnswer = customId.replace('verify_modal_submit_', '');
    const answer = interaction.fields.getTextInputValue('captcha_answer');

    if (answer.trim().toUpperCase() !== expectedAnswer) {
        return interaction.editReply({ content: '❌ Verification failed. The CAPTCHA code entered was incorrect. Please try clicking Verify again.' });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const result = await grantVerificationRoles(member, settings, { interaction }, 'CAPTCHA');

    if (!result.success) {
        return interaction.editReply({ content: result.message });
    }

    if (result.alreadyVerified) {
        return interaction.editReply({ content: 'ℹ️ You are already verified on this server!' });
    }

    return interaction.editReply({ content: '✅ **Verification Successful!** You have completed the CAPTCHA and unlocked access to the server.' });
}

/**
 * Handles React Verification when user adds an emoji reaction to the verification panel
 */
async function handleReactionVerification(reaction, user, settings) {
    const guild = reaction.message.guild;
    if (!guild || user.bot) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    const result = await grantVerificationRoles(member, settings, { reaction, user }, 'Reaction');
    if (result.success && !result.alreadyVerified) {
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle('✅ Verified')
                .setDescription(`You have successfully verified in **${guild.name}** via reaction!`)
                .setColor(0x2ea043)
                .setTimestamp();
            await user.send({ embeds: [dmEmbed] }).catch(() => {});
        } catch (e) {}
    }
}

/**
 * Spawns a verification panel of the specified type (button, captcha, reaction, roblox)
 */
async function spawnVerificationPanel(targetChannel, settings, type = 'captcha', interaction = null) {
    if (!targetChannel) throw new Error('Target channel is required to spawn verification panel.');

    const guild = targetChannel.guild;
    const botUser = guild.members.me?.user;
    
    // Resolve embed color
    let embedColor = 0x5865F2;
    if (settings?.verifyEmbedColor) {
        try {
            embedColor = parseInt(settings.verifyEmbedColor.replace('#', ''), 16);
        } catch (e) {
            embedColor = 0x5865F2;
        }
    } else if (guild.members.me?.roles?.highest?.color) {
        embedColor = guild.members.me.roles.highest.color;
    }

    const botAvatar = botUser ? botUser.displayAvatarURL({ dynamic: true, size: 256 }) : null;

    if (type === 'button') {
        const title = settings?.verifyEmbedTitle || 'Server Access Verification';
        const description = settings?.verifyEmbedDesc || 'Welcome to the server! Click the **Verify** button below to immediately unlock full access to community channels.';
        const btnLabel = settings?.verifyBtnLabel || 'Click to Verify';
        const btnEmoji = settings?.verifyBtnEmoji || '✅';

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(embedColor)
            .setFooter({ text: 'Nora Gatekeeper • 1-Click Verification', iconURL: botAvatar })
            .setTimestamp();

        if (botAvatar) embed.setThumbnail(botAvatar);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_button_instant')
                .setLabel(btnLabel)
                .setEmoji(btnEmoji)
                .setStyle(ButtonStyle.Success)
        );

        const sent = await targetChannel.send({ embeds: [embed], components: [row] });
        settings.verifyMessageId = sent.id;
        settings.verificationType = 'button';
        await settings.save();
        settingsCache.invalidate(guild.id);
        return sent;
    }

    if (type === 'captcha') {
        const title = settings?.verifyEmbedTitle || 'Server Verification Required';
        const description = settings?.verifyEmbedDesc || 'To protect the server from automated raids and bots, please verify that you are human.\n\nClick the **Verify** button below and solve the image CAPTCHA challenge.';
        const btnLabel = settings?.verifyBtnLabel || 'Verify Account';
        const btnEmoji = settings?.verifyBtnEmoji || '🔒';

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(embedColor)
            .setFooter({ text: 'Nora Gatekeeper • Anti-Bot CAPTCHA Protection', iconURL: botAvatar })
            .setTimestamp();

        if (botAvatar) embed.setThumbnail(botAvatar);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_system_button')
                .setLabel(btnLabel)
                .setEmoji(btnEmoji)
                .setStyle(ButtonStyle.Success)
        );

        const sent = await targetChannel.send({ embeds: [embed], components: [row] });
        settings.verifyMessageId = sent.id;
        settings.verificationType = 'captcha';
        await settings.save();
        settingsCache.invalidate(guild.id);
        return sent;
    }

    if (type === 'reaction') {
        const triggerEmoji = settings?.verifyEmoji || '✅';
        const title = settings?.verifyEmbedTitle || 'Reaction Verification';
        const description = settings?.verifyEmbedDesc || `React with ${triggerEmoji} below to verify yourself and gain full access to the community!`;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(embedColor)
            .setFooter({ text: 'Nora Gatekeeper • Reaction Verification', iconURL: botAvatar })
            .setTimestamp();

        if (botAvatar) embed.setThumbnail(botAvatar);

        const sent = await targetChannel.send({ embeds: [embed] });
        try {
            await sent.react(triggerEmoji);
        } catch (e) {
            console.warn('[React Verify] Could not pre-react to verification panel:', e.message);
        }
        settings.verifyMessageId = sent.id;
        settings.verificationType = 'reaction';
        await settings.save();
        settingsCache.invalidate(guild.id);
        return sent;
    }

    if (type === 'roblox') {
        const title = settings?.verifyEmbedTitle || 'Roblox Account Verification';
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(
                'Link your Roblox account to this Discord server for access, roles, and rank perks!\n\n' +
                '**How to verify:**\n' +
                '1️⃣ Use `/verify link <username>` with your Roblox username\n' +
                '2️⃣ Copy the verification code provided\n' +
                '3️⃣ Paste the code into your Roblox profile description (About section)\n' +
                '4️⃣ Run `/verify check` to complete verification\n\n' +
                '**Manage accounts:**\n' +
                '• `/verify list` — View linked profiles\n' +
                '• `/verify switch` — Change active profile\n' +
                '• `/verify unlink` — Remove a linked account'
            )
            .setColor('#00b4d8')
            .setFooter({ text: 'Nora Security • Roblox Verification' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Verify via Website')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://vaztinix.dev/verify?guild=${guild.id}`),
            new ButtonBuilder()
                .setCustomId('roblox_verify_alt')
                .setLabel('Alternative Verification')
                .setStyle(ButtonStyle.Secondary)
        );

        const sent = await targetChannel.send({ embeds: [embed], components: [row] });
        settings.verifyMessageId = sent.id;
        settings.verificationType = 'roblox';
        await settings.save();
        settingsCache.invalidate(guild.id);
        return sent;
    }

    throw new Error(`Unknown verification type: ${type}`);
}

module.exports = {
    generateRandomCaptcha,
    generateSvgCaptcha,
    grantVerificationRoles,
    handleInstantButtonClick,
    handleVerifyButtonClick,
    handleEnterCodeButtonClick,
    handleVerifyModalSubmit,
    handleReactionVerification,
    spawnVerificationPanel
};
