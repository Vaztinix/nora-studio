const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { broadcastSiteAlert } = require('../src/utils/pushManager');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const ANNOUNCEMENTS_CHANNEL_ID = '1487573376728825967'; // #📢┃announcements in Milo's World

client.once('ready', async () => {
  try {
    console.log('[Public Release] Logged in as', client.user.tag);
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

    // 1. Post Official Discord Announcement in #announcements
    const releaseEmbed = new EmbedBuilder()
      .setColor('#7C3AED')
      .setTitle('🚀 Nora AI is Officially Released to the Public!')
      .setDescription(
        'We are thrilled to announce that **Nora AI** is officially out of private testing and fully released to the public across all servers! 🎉✨\n\n' +
        'Here is everything you can now experience with Nora:\n\n' +
        '💬 **Conversational Chat & Multimodal Vision**\n' +
        '• Simply mention <@' + client.user.id + '> or reply to any of her messages to chat!\n' +
        '• Send images, screenshots, or artwork and ask Nora to explain, review, or analyze them.\n' +
        '• Adaptive mood matching, persistent user memory, and real-time web search built right in.\n\n' +
        '🎨 **Neural AI Image Generation**\n' +
        '• Ask Nora to draw or generate any artwork directly in Discord!\n' +
        '• Try asking: `"@Nora draw a cyberpunk city at sunset"` or `"@Nora generate an image of a cute space cat"`.\n\n' +
        '🎙️ **Real-Time Voice AI**\n' +
        '• Summon Nora into any voice channel with `/voice-ai join` or by typing `JoinNoraAI`.\n' +
        '• Experience real-time speech-to-text transcription and conversational spoken voice responses.\n' +
        '• Check active status anytime with `/voice-ai status` or dismiss her with `/voice-ai leave`.\n\n' +
        '🌐 **Open Everywhere**\n' +
        '• All servers and community members now have full access with no whitelist or beta barriers required.\n\n' +
        'Thank you all for your support, feedback, and patience as we built and refined Nora AI. Enjoy chatting, creating, and exploring!'
      )
      .setImage('https://media.giphy.com/media/26AHONQJhMhRX5EzK/giphy.gif')
      .setFooter({ text: "Nora AI • Public Release • Developed by Vaztinix", iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    const sentMessage = await announcementsChannel.send({
      embeds: [releaseEmbed]
    });
    console.log(`[Public Release] Successfully posted Discord announcement (ID: ${sentMessage.id})`);

    // 2. Broadcast to Web Dashboard & Push Notification Subscribers
    try {
      const { alertRecord, sentPushCount } = await broadcastSiteAlert(
        '🚀 Nora AI Officially Released to the Public!',
        'Nora AI (Conversational Intelligence, Multimodal Vision, Image Synthesis, and Real-Time Voice AI) is now officially unlocked and available to all servers!',
        'success',
        '1214048435632603137'
      );
      console.log(`[Public Release] Site alert broadcasted (ID: ${alertRecord.id}), push delivered to ${sentPushCount} devices.`);
    } catch (pushErr) {
      console.warn('[Public Release] Site alert error:', pushErr.message);
    }

    console.log('[Public Release] All tasks completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[Public Release] Fatal error:', err);
    process.exit(1);
  }
});

const cleanToken = (process.env.TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
client.login(cleanToken);
