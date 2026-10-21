require('dotenv').config();
const { REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const UnderageSuspension = require('../src/database/models/UnderageSuspension');

const TARGET_GUILD_ID = '1487342521133830174';
const DEVELOPER_ID = '1214048435632603137';
const DELAY_MS = 1500; // 1.5 seconds between DMs to respect Discord rate limits

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log('====================================================');
    console.log('🚀 Nora Bot - Suspension Appeal Notification Dispatcher');
    console.log('====================================================');

    const token = process.env.TOKEN;
    if (!token) {
        console.error('❌ Error: process.env.TOKEN is missing!');
        process.exit(1);
    }

    const rest = new REST({ version: '10' }).setToken(token);

    // Fetch Guild Info for clean branding
    let guildName = "Milo's World";
    let guildIconUrl = null;
    try {
        const guild = await rest.get(Routes.guild(TARGET_GUILD_ID));
        if (guild && guild.name) guildName = guild.name;
        if (guild && guild.icon) {
            guildIconUrl = `https://cdn.discordapp.com/icons/${TARGET_GUILD_ID}/${guild.icon}.png?size=256`;
        }
        console.log(`🏰 Target Server: ${guildName} (${TARGET_GUILD_ID})`);
    } catch (e) {
        console.warn(`⚠️ Warning: Could not fetch guild details (${e.message}), using default name.`);
    }

    // Find all active suspensions
    const suspensions = await UnderageSuspension.findAll({
        where: { status: 'suspended' },
        order: [['id', 'ASC']]
    });

    console.log(`📋 Found ${suspensions.length} total active suspension records.\n`);

    let deliveredCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < suspensions.length; i++) {
        const record = suspensions[i];
        const progress = `[${i + 1}/${suspensions.length}]`;

        // Check if already notified
        if (record.appealNotified) {
            console.log(`${progress} ⏭️ User ${record.userTag || record.userId} already notified on ${record.appealNotifiedAt}. Skipping.`);
            skippedCount++;
            continue;
        }

        const userId = record.userId;
        const userTag = record.userTag || `User (${userId})`;

        const embed = new EmbedBuilder()
            .setTitle('⚖️ Notice: Suspension Appeal System Now Open')
            .setColor(0x5865F2)
            .setDescription(
                `Hello <@${userId}>,\n\n` +
                `You were previously suspended from **${guildName}** under our account age safety policy.\n\n` +
                `We are reaching out to let you know that our **Direct Suspension Appeal System** is now officially open!\n\n` +
                `If you believe your suspension was made in error or if you can provide verification details / proof of age (such as ID reference, birth year, or documentation links), you may now submit an appeal directly to server staff.\n\n` +
                `⚖️ **How to Submit Your Appeal:**\n` +
                `1. **Click the "Submit Appeal" button below** to open the appeal form (you can provide your explanation, details, and image/proof links), OR\n` +
                `2. **Reply directly to this DM** with your explanation and **upload images or screenshots** directly!\n\n` +
                `📸 **Add Images or Links to Help Us Verify:**\n` +
                `• Feel free to paste image links (Imgur, Postimages, Google Drive, etc.) into the form OR send photos directly as attachments in this DM.\n` +
                `• Clear proof or verification details help staff review and lift suspensions quickly!\n\n` +
                `All appeals are forwarded directly to server administrator **Vaztinix** (<@${DEVELOPER_ID}>) for review.`
            )
            .addFields(
                { name: '🏰 Server', value: guildName, inline: true },
                { name: '🛑 Current Status', value: 'Suspended (Appeal Eligible)', inline: true },
                { name: '📸 Proof & Images', value: 'Submit image links via the form or upload photos directly in this DM. Forwarded directly to Vaztinix (`1214048435632603137`).', inline: false }
            )
            .setFooter({ text: 'Discord Safety & Account Policy Enforcement • Appeals via DM' })
            .setTimestamp();

        if (guildIconUrl) {
            embed.setThumbnail(guildIconUrl);
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('appeal_suspension_btn')
                .setLabel('Submit Appeal')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('⚖️')
        );

        let success = false;
        let errorMessage = null;

        try {
            // 1. Create / open DM channel with user
            const dmChannel = await rest.post(Routes.userChannels(), {
                body: { recipient_id: userId }
            });

            // 2. Dispatch DM message
            await rest.post(Routes.channelMessages(dmChannel.id), {
                body: {
                    embeds: [embed.toJSON()],
                    components: [row.toJSON()]
                }
            });

            success = true;
            deliveredCount++;
            console.log(`${progress} ✅ Delivered to ${userTag} (\`${userId}\`)`);

            // Update database record
            await record.update({
                appealNotified: true,
                appealNotifiedAt: new Date(),
                appealNotifyError: null
            });
        } catch (err) {
            errorMessage = err.message || 'Unknown error';
            failedCount++;

            // Check specific Discord error codes
            if (err.code === 50007) {
                errorMessage = 'Cannot send messages to this user (DMs closed or no shared server)';
            } else if (err.code === 10013) {
                errorMessage = 'Unknown User (Account deleted)';
            } else if (err.status === 429) {
                const retryAfter = (err.rawError && err.rawError.retry_after) || 5;
                console.warn(`⏳ Rate limited! Sleeping for ${retryAfter}s...`);
                await sleep((retryAfter * 1000) + 500);
            }

            console.warn(`${progress} ⚠️ Failed to deliver to ${userTag} (\`${userId}\`): ${errorMessage}`);

            // Update database record with failure reason
            await record.update({
                appealNotified: false,
                appealNotifyError: errorMessage
            });
        }

        // Pacing delay
        await sleep(DELAY_MS);
    }

    console.log('\n====================================================');
    console.log('📊 Notification Dispatch Complete');
    console.log(`Total Active Records: ${suspensions.length}`);
    console.log(`✅ Successfully Delivered: ${deliveredCount}`);
    console.log(`⚠️ Failed (DMs Closed / Blocked): ${failedCount}`);
    console.log(`⏭️ Skipped (Already Notified): ${skippedCount}`);
    console.log('====================================================\n');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
});
