const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  const guild = client.guilds.cache.get('1487342521133830174');
  if (!guild) {
    console.log('Guild not found');
    process.exit(0);
  }
  const channels = await guild.channels.fetch();
  for (const [id, c] of channels) {
    if (c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)) {
      console.log(`${c.type === ChannelType.GuildAnnouncement ? '[ANNOUNCEMENT]' : '[TEXT]'} #${c.name} (${c.id})`);
    }
  }
  process.exit(0);
});

const cleanToken = (process.env.TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
client.login(cleanToken);
