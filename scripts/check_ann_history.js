const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  const guild = client.guilds.cache.get('1487342521133830174');
  const ch = await guild.channels.fetch('1487573376728825967');
  const msgs = await ch.messages.fetch({ limit: 5 });
  for (const m of Array.from(msgs.values()).reverse()) {
    console.log(`[${m.author.username}] (${m.createdAt.toISOString()}): ${m.content.slice(0, 150)}`);
  }
  process.exit(0);
});

const cleanToken = (process.env.TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
client.login(cleanToken);
