const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  const guild = client.guilds.cache.get('1487342521133830174');
  if (!guild) {
    console.log('Guild not found');
    process.exit(0);
  }

  const channels = guild.channels.cache
    .filter(c => c.isTextBased())
    .map(c => `${c.name} (${c.id})`);
  console.log('Channels in ' + guild.name + ':\n' + channels.join('\n'));
  process.exit(0);
});

const cleanToken = (process.env.TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
client.login(cleanToken);
