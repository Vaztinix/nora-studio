const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const PREVIOUS_MSG_ID = '1558852371776274433';
const ANNOUNCEMENTS_CHANNEL_ID = '1487573376728825967';

const affectedUserIds = [
  '1031222949224652830',
  '1517809500114124901',
  '1455778627651240060',
  '1484783854949630074',
  '1454909004118626471',
  '1527329188468494386',
  '1483092741004066877',
  '1453750024369344554',
  '1532420920398970900',
  '1520944057273024582',
  '1439406189417861242',
  '1330670805947912205',
  '1486413599797678211',
  '1517007915750522900',
  '1550905159289405511',
  '1507940412352888893',
  '1551054551128481884',
  '1537665610996125706',
  '1538797390985953290',
  '1517021155863564389',
  '1547424307150463097',
  '1507569378223325216',
  '1553916570353279036',
  '1509059178868506675',
  '1437600251031720244',
  '1528308363442520134',
  '1499775189532016772',
  '1351307645121986682',
  '1236827842491453482',
  '1553478076220969122',
  '1558267117877596237',
  '1510018174618177718',
  '930089787052916797',
  '1527353609359069367',
  '1363689784383504485',
  '1556489047969366099',
  '1502568178453184603',
  '1453186819356364813',
  '1424143964272853064'
];

client.once('ready', async () => {
  try {
    console.log('[Resend Apology] Bot logged in as', client.user.tag);
    const guild = client.guilds.cache.get('1487342521133830174');
    if (!guild) {
      console.error('Guild not found');
      process.exit(1);
    }

    const announcementsChannel = await guild.channels.fetch(ANNOUNCEMENTS_CHANNEL_ID);
    if (!announcementsChannel) {
      console.error('Announcements channel not found');
      process.exit(1);
    }

    // 1. Delete previous announcement message with ping if it exists
    try {
      const prevMsg = await announcementsChannel.messages.fetch(PREVIOUS_MSG_ID);
      if (prevMsg) {
        await prevMsg.delete();
        console.log(`Deleted previous message ${PREVIOUS_MSG_ID}`);
      }
    } catch (e) {
      console.warn('Could not delete previous message (might already be deleted):', e.message);
    }

    // 2. Post new announcement with NO PING
    const announcementEmbed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('📢 Clarification & Apology: Erroneous DM Notices')
      .setDescription(
        'Earlier today, an automated background maintenance routine in Nora encountered an issue while parsing historical moderation audit logs.\n\n' +
        '**Key Details Regarding This Issue:**\n' +
        '• **Isolated Scope:** Only selected users who were recorded in a specific historical moderation database table were affected. The wider server community and general member records were completely unaffected.\n' +
        '• **No Suspensions:** No active members are suspended, restricted, or banned in any way. All active account standings remain fully valid.\n' +
        '• **Permanent Fix:** All affected database entries have been reviewed and corrected, and the automated notification routine has been permanently disabled.\n\n' +
        'We sincerely apologize to the community and to the affected individuals for the confusion and alarm this caused.'
      )
      .setFooter({ text: "Milo's World • Nora System Notice", iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    const newMsg = await announcementsChannel.send({
      embeds: [announcementEmbed]
      // No content, no mentions
    });
    console.log(`Posted new announcement (no ping) in #${announcementsChannel.name} (ID: ${newMsg.id})`);

    // 3. Send DM to each affected user
    const dmEmbed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('Important Notice Regarding Recent Bot DM')
      .setDescription(
        'Hello,\n\n' +
        'Earlier today, you may have received an automated direct message from Nora stating that your account was suspended.\n\n' +
        '**Please be assured that this was sent in error:**\n' +
        '• **Your account is NOT suspended.** Your membership and standing in **Milo\'s World** remain completely unaffected and in good standing.\n' +
        '• This notice was solely caused by a background maintenance routine that misclassified records within a specific historical moderation database table. Only selected users listed in that specific database were affected.\n' +
        '• All records have been corrected, and this automated notification routine has been permanently disabled.\n\n' +
        'We sincerely apologize for any confusion, distress, or inconvenience this message may have caused you.'
      )
      .setFooter({ text: "Milo's World Staff Team", iconURL: guild.iconURL() || undefined })
      .setTimestamp();

    console.log(`Starting DM delivery to ${affectedUserIds.length} users...`);
    let delivered = 0;
    let failed = 0;

    for (let i = 0; i < affectedUserIds.length; i++) {
      const userId = affectedUserIds[i];
      try {
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) {
          console.log(`[${i + 1}/${affectedUserIds.length}] User not found: ${userId}`);
          failed++;
          continue;
        }

        await user.send({ embeds: [dmEmbed] });
        delivered++;
        console.log(`[${i + 1}/${affectedUserIds.length}] Delivered apology DM to ${user.tag} (${userId})`);
      } catch (err) {
        console.warn(`[${i + 1}/${affectedUserIds.length}] Failed to DM ${userId}: ${err.message}`);
        failed++;
      }
      // Small pause to avoid rate limits
      await new Promise(r => setTimeout(r, 650));
    }

    console.log(`[Complete] Delivered: ${delivered}, Failed/Closed DMs: ${failed}`);
    process.exit(0);
  } catch (error) {
    console.error('Fatal error in resend apology script:', error);
    process.exit(1);
  }
});

const cleanToken = (process.env.TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
client.login(cleanToken);
