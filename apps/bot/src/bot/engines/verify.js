const { PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sharp = require('sharp');

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
 * Sends the dynamic CAPTCHA image with an "Enter Code" button when the user clicks Verify.
 */
async function handleVerifyButtonClick(interaction) {
    const captchaCode = generateRandomCaptcha(6);
    const svgString = generateSvgCaptcha(captchaCode);
    const pngBuffer = await sharp(Buffer.from(svgString)).png().toBuffer();
    const attachment = new AttachmentBuilder(pngBuffer, { name: 'captcha.png' });

    const enterCodeBtn = new ButtonBuilder()
        .setCustomId(`verify_enter_code_${captchaCode}`)
        .setLabel('Enter CAPTCHA Code')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔏');

    const row = new ActionRowBuilder().addComponents(enterCodeBtn);

    await interaction.reply({
        content: '🔒 **Security Verification**\nPlease look at the image below and click the button to enter the CAPTCHA code.',
        files: [attachment],
        components: [row],
        ephemeral: true
    });
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
        return interaction.editReply({ content: `❌ Verification failed. You must type the captcha **${expectedAnswer}** exactly as shown.` });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.editReply({ content: 'Could not resolve your member profile.' });

    if (!settings || !settings.verifyRoleId) {
        return interaction.editReply({ content: 'Verification is not fully set up on this server. Please contact an admin.' });
    }

    try {
        const roleIds = settings.verifyRoleId.split(',');
        let rolesAdded = 0;
        
        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.editReply({ content: 'I do not have the **Manage Roles** permission physically required to verify you. Please alert an admin.' });
        }

        for (const rId of roleIds) {
            const roleObj = interaction.guild.roles.cache.get(rId);
            if (roleObj && interaction.guild.members.me.roles.highest.position <= roleObj.position) {
                return interaction.editReply({ content: 'I cannot assign the verification role because it is higher than my highest role. Please alert an admin.' });
            }

            if (!member.roles.cache.has(rId)) {
                await member.roles.add(rId).catch(()=>{});
                rolesAdded++;
            }
        }

        if (rolesAdded === 0) {
            await interaction.editReply({ content: 'You are already verified!' });
        } else {
            await interaction.editReply({ content: '✅ **Verification Successful!** You have been granted access to the server.' });
        }
    } catch (error) {
        console.error('Verification Error:', error);
        await interaction.editReply({ content: 'I encountered an error trying to assign the roles. Please contact an admin.' });
    }
}

module.exports = {
    handleVerifyButtonClick,
    handleEnterCodeButtonClick,
    handleVerifyModalSubmit
};
