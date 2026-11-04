const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const MILOS_WORLD_GUILD_ID = '1487342521133830174';
const VAZTINIX_USER_ID = '1214048435632603137';

/**
 * Checks if a user is currently a member of the Milo's World Discord server
 * @param {import('discord.js').Client} client 
 * @param {string} userId 
 * @returns {Promise<boolean>}
 */
async function isUserInMilosWorld(client, userId) {
    if (!client || !userId) return false;
    try {
        const guild = client.guilds.cache.get(MILOS_WORLD_GUILD_ID);
        if (!guild) {
            console.warn(`[TesterApp] Guild ${MILOS_WORLD_GUILD_ID} not found in client cache.`);
            return false;
        }

        if (guild.members.cache.has(userId)) return true;

        const member = await guild.members.fetch(userId).catch(() => null);
        return Boolean(member);
    } catch (err) {
        console.error('[TesterApp] Error checking Milo\'s World membership:', err.message);
        return false;
    }
}

/**
 * Validates the access password (must be 'MILO', case-insensitive)
 * @param {string} password 
 * @returns {boolean}
 */
function validatePassword(password) {
    if (!password || typeof password !== 'string') return false;
    return password.trim().toUpperCase() === 'MILO';
}

/**
 * Forwards a completed tester application to Vaztinix's Discord DMs
 * @param {import('discord.js').Client} client 
 * @param {object} applicationData 
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function submitApplication(client, applicationData) {
    const {
        user,
        age,
        devices = [],
        activity = 'Not specified',
        motivation = 'None provided',
        experience = 'None provided',
        scenario1 = 'None provided',
        scenario2 = 'None provided',
        scenario3 = 'None provided',
        scenario4 = 'None provided',
        questionA = '',
        questionB = '',
        questionC = '',
        extraNotes = 'None'
    } = applicationData;

    try {
        const vaztinix = await client.users.fetch(VAZTINIX_USER_ID).catch(() => null);
        if (!vaztinix) {
            throw new Error('Could not find Vaztinix in Discord to deliver application.');
        }

        // Calculate score on the 3 assessment questions
        // Question A: B is correct (detailed steps to reproduce)
        const isACorrect = questionA === 'B';
        // Question B: B is correct (honest developer disclosure)
        const isBCorrect = questionB === 'B';
        // Question C: B is correct (steps to make bug happen reliably)
        const isCCorrect = questionC === 'B';

        let correctCount = 0;
        if (isACorrect) correctCount++;
        if (isBCorrect) correctCount++;
        if (isCCorrect) correctCount++;

        const scorePercent = Math.round((correctCount / 3) * 100);
        const scoreRating = correctCount === 3 ? '🌟 100% (Perfect Score)' : (correctCount === 2 ? '👍 66% (Good)' : '⚠️ Needs Guidance');

        const deviceList = Array.isArray(devices) && devices.length > 0 ? devices.join(', ') : 'Not specified';
        const applicantMention = `<@${user.id}>`;
        const avatarUrl = user.avatar
            ? (user.avatar.startsWith('http') ? user.avatar : `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`)
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        // 1. Primary Overview Embed
        const overviewEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setAuthor({
                name: `Tester Application • ${user.global_name || user.username} (@${user.username})`,
                iconURL: avatarUrl
            })
            .setTitle('📋 New Nora Studio Tester Application Received')
            .setDescription(`**${user.global_name || user.username}** has applied to become an official Tester for Nora Bot & Nora Studio!\n\nAll pre-checks passed: **Discord Linked** ✅ • **Milo's World Member** ✅ • **Password Gate Cleared** (\`MILO\`) ✅`)
            .addFields(
                {
                    name: '👤 Applicant Profile',
                    value: `• **Mention:** ${applicantMention}\n• **Username:** \`@${user.username}\`\n• **User ID:** \`${user.id}\`\n• **Stated Age:** \`${age}\``,
                    inline: true
                },
                {
                    name: '📱 Devices & Availability',
                    value: `• **Devices:** ${deviceList}\n• **Active Hours:** ${activity}`,
                    inline: true
                },
                {
                    name: '🎯 Knowledge & Assessment Score',
                    value: `**${correctCount}/3 Correct** (${scoreRating})\n• Bug Report Method: ${isACorrect ? '✅ Correct' : '❌ Incorrect'}\n• Accidental Crash Honesty: ${isBCorrect ? '✅ Honest & Accountable' : '❌ Needs Review'}\n• Reproduction Knowledge: ${isCCorrect ? '✅ Understood' : '❌ Misunderstood'}`,
                    inline: false
                },
                {
                    name: '💡 Why they want to be a Tester',
                    value: motivation.length > 1024 ? motivation.slice(0, 1020) + '...' : motivation,
                    inline: false
                },
                {
                    name: '🧪 Prior Testing Experience',
                    value: experience.length > 1024 ? experience.slice(0, 1020) + '...' : experience,
                    inline: false
                }
            )
            .setFooter({ text: `Applicant User ID: ${user.id} • Nora Studio Testing Team` })
            .setTimestamp();

        // 2. Scenarios & Integrity Assessment Embed
        const scenariosEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('🔍 Testing Scenarios & Integrity Responses')
            .addFields(
                {
                    name: '1️⃣ Scenario: Command Not Responding (e.g. /rank)',
                    value: `*Question: Imagine Nora does not respond to a command. What do you check first?*\n**Response:** ${scenario1.length > 900 ? scenario1.slice(0, 895) + '...' : scenario1}`,
                    inline: false
                },
                {
                    name: '2️⃣ Scenario: Major Exploit / Unlimited XP Glitch Found',
                    value: `*Question: You find a bug allowing unlimited XP or bypass. What do you do?*\n**Response:** ${scenario2.length > 900 ? scenario2.slice(0, 895) + '...' : scenario2}`,
                    inline: false
                },
                {
                    name: '3️⃣ Scenario: Friend Asks for Unreleased Leaks / NDA',
                    value: `*Question: A friend asks you to reveal secret tester features. What is your response?*\n**Response:** ${scenario3.length > 900 ? scenario3.slice(0, 895) + '...' : scenario3}`,
                    inline: false
                },
                {
                    name: '4️⃣ Scenario: Sample Bug Report Written by Applicant',
                    value: `*Question: Write a sample bug report for dashboard "Erase Data" error.*\n**Response:** ${scenario4.length > 900 ? scenario4.slice(0, 895) + '...' : scenario4}`,
                    inline: false
                },
                {
                    name: '💬 Final Comments or Notes for Vaztinix',
                    value: extraNotes.length > 1024 ? extraNotes.slice(0, 1020) + '...' : extraNotes,
                    inline: false
                }
            )
            .setFooter({ text: 'Nora Studio Verification Network • Integrity Evaluated' });

        // Action Buttons for Vaztinix
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`tester_accept_${user.id}`)
                .setLabel('Accept as Tester')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
            new ButtonBuilder()
                .setCustomId(`tester_decline_${user.id}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌'),
            new ButtonBuilder()
                .setLabel('Open User Profile')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://discord.com/users/${user.id}`)
                .setEmoji('💬')
        );

        const sentMessage = await vaztinix.send({
            embeds: [overviewEmbed, scenariosEmbed],
            components: [row]
        });

        // Send a friendly receipt DM to the applicant from Nora if their DMs are open
        try {
            const applicantUser = await client.users.fetch(user.id).catch(() => null);
            if (applicantUser) {
                const receiptEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setAuthor({
                        name: 'Nora Studio Testing Program',
                        iconURL: client.user.displayAvatarURL()
                    })
                    .setTitle('✨ Tester Application Submitted!')
                    .setDescription(`Hey **${user.global_name || user.username}**! Thank you for applying to be a tester for Nora Bot & Nora Studio.\n\nYour application has been delivered directly to **Vaztinix** for review. We will reach out to you once your responses are evaluated!`)
                    .addFields(
                        { name: '📋 Position', value: 'Community Feature Tester', inline: true },
                        { name: '🏰 Server', value: "Milo's World", inline: true },
                        { name: '⏳ Status', value: 'Under Review by Vaztinix', inline: true }
                    )
                    .setFooter({ text: 'Nora Studio • Official Testing Team' })
                    .setTimestamp();

                await applicantUser.send({ embeds: [receiptEmbed] }).catch(() => {});
            }
        } catch (_) {}

        return { success: true, messageId: sentMessage.id };
    } catch (err) {
        console.error('[TesterApp Error] Failed to forward application to Vaztinix:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Handles Accept / Decline button interactions clicked by Vaztinix in his DMs
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<boolean>}
 */
async function handleButton(interaction, client) {
    if (!interaction.customId.startsWith('tester_accept_') && !interaction.customId.startsWith('tester_decline_')) {
        return false;
    }

    if (interaction.user.id !== VAZTINIX_USER_ID) {
        await interaction.reply({
            content: '⚠️ Only Vaztinix can accept or decline tester applications.',
            ephemeral: true
        }).catch(() => {});
        return true;
    }

    const isAccept = interaction.customId.startsWith('tester_accept_');
    const targetUserId = interaction.customId.replace(isAccept ? 'tester_accept_' : 'tester_decline_', '').trim();

    await interaction.deferUpdate().catch(() => {});

    try {
        const originalEmbeds = interaction.message.embeds.map(e => EmbedBuilder.from(e));
        if (originalEmbeds.length > 0) {
            const mainEmbed = originalEmbeds[0];
            mainEmbed.setColor(isAccept ? 0x10B981 : 0xEF4444);
            mainEmbed.addFields({
                name: isAccept ? '✅ Application Accepted' : '❌ Application Declined',
                value: `Decided by **Vaztinix** on <t:${Math.floor(Date.now() / 1000)}:f>`,
                inline: false
            });
        }

        // Disable buttons
        const updatedRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`tester_done_${isAccept ? 'accepted' : 'declined'}`)
                .setLabel(isAccept ? 'Accepted' : 'Declined')
                .setStyle(isAccept ? ButtonStyle.Success : ButtonStyle.Danger)
                .setDisabled(true)
                .setEmoji(isAccept ? '✅' : '❌'),
            new ButtonBuilder()
                .setLabel('Open User Profile')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://discord.com/users/${targetUserId}`)
                .setEmoji('💬')
        );

        await interaction.editReply({
            embeds: originalEmbeds,
            components: [updatedRow]
        }).catch(() => {});

        // Send decision notification DM to the applicant
        try {
            const applicantUser = await client.users.fetch(targetUserId).catch(() => null);
            if (applicantUser) {
                const decisionEmbed = new EmbedBuilder()
                    .setColor(isAccept ? 0x10B981 : 0xEF4444)
                    .setAuthor({
                        name: 'Nora Studio Testing Program',
                        iconURL: client.user.displayAvatarURL()
                    })
                    .setTitle(isAccept ? '🎉 Congratulations! Tester Application Accepted!' : '📋 Tester Application Status Update')
                    .setDescription(
                        isAccept
                            ? `Hey <@${targetUserId}>! Your application to become a **Tester for Nora Bot & Nora Studio** has been **ACCEPTED** by **Vaztinix**!\n\nWelcome to the Nora Studio Testing Team. We will coordinate your testing access and channels in **Milo's World** soon!`
                            : `Hey <@${targetUserId}>, thank you for taking the time to apply for the Nora Studio Testing Team.\n\nAt this time, we are unable to accept your tester application. We truly appreciate your enthusiasm and encourage you to stay active in **Milo's World** and try again in future testing rounds!`
                    )
                    .setFooter({ text: 'Nora Studio • Testing Management' })
                    .setTimestamp();

                await applicantUser.send({ embeds: [decisionEmbed] }).catch(() => {});
            }
        } catch (_) {}

        return true;
    } catch (err) {
        console.error('[TesterApp Button Error]:', err);
        return true;
    }
}

module.exports = {
    MILOS_WORLD_GUILD_ID,
    VAZTINIX_USER_ID,
    isUserInMilosWorld,
    validatePassword,
    submitApplication,
    handleButton
};
