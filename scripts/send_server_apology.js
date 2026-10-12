const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', async () => {
  try {
    const guild = client.guilds.cache.get('1487342521133830174');
    if (!guild) {
      console.error('Guild not found');
      process.exit(1);
    }

    const announcementsChannel = await guild.channels.fetch('1487573376728825967');
    if (!announcementsChannel) {
      console.error('Announcements channel not found');
      process.exit(1);
    }

    const apologyEmbed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('📢 Clarification & Apology: Erroneous DM Notices')
      .setDescription(
        'Earlier today, an automated background maintenance routine in Nora encountered an issue while parsing historical audit logs. Due to this misclassification, automated direct messages regarding underage account suspensions were erroneously sent to several active server members.\n\n' +
        '**Important Clarification:**\n' +
        '• **No active members are suspended, restricted, or banned.**\n' +
        '• All member records have been reviewed and corrected in the database.\n' +
        '• The faulty notification routine has been permanently disabled to ensure this cannot happen again.\n\n' +
        'We sincerely apologize for any alarm, distress, or confusion these mistaken notices caused. Thank you all for your patience and understanding!'
      )
      .setFooter({ text: "Milo's World • Nora System Notice", iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    const sentMessage = await announcementsChannel.send({
      content: '|| @everyone ||',
      embeds: [apologyEmbed],
      allowedMentions: { parse: ['everyone'] }
    });

    console.log(`Successfully sent apology announcement to #${announcementsChannel.name} (Message ID: ${sentMessage.id})`);
    process.exit(0);
  } catch (error) {
    console.error('Error sending apology announcement:', error);
    process.exit(1);
  }
});

const cleanToken = (process.env.TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
client.login(cleanToken);
