const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  const guild = client.guilds.cache.get('1487342521133830174');
  for (const id of ['1487573376728825967', '1511120918334800012']) {
    const ch = await guild.channels.fetch(id);
    console.log(`\n=== #${ch.name} ===`);
    const msgs = await ch.messages.fetch({ limit: 2 });
    for (const m of msgs.values()) {
      console.log(`[${m.author.username}] ${m.content}`);
    }
  }
  process.exit(0);
});

const cleanToken = (process.env.TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
client.login(cleanToken);
