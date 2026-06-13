const { PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

function generateRandomCaptcha(length = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing characters like O, 0, I, 1
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Pops up the CAPTCHA verify modal when a user clicks the Server Verification panel button.
 */
async function handleVerifyButtonClick(interaction) {
    const captchaCode = generateRandomCaptcha(6);
    const modal = new ModalBuilder()
        .setCustomId(`verify_modal_submit_${captchaCode}`)
        .setTitle('Security Verification');

    const captchaInput = new TextInputBuilder()
        .setCustomId('captcha_answer')
        .setLabel(`Solve CAPTCHA: Type "${captchaCode}" in ALL CAPS`)
        .setPlaceholder(captchaCode)
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
    handleVerifyModalSubmit
};
