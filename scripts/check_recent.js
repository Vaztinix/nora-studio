const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  const guild = client.guilds.cache.get('1487342521133830174');
  const checkCh = async (id, name) => {
    try {
      const ch = await guild.channels.fetch(id);
      const msgs = await ch.messages.fetch({ limit: 3 });
      console.log('=== ' + name + ' ===');
      for (const m of msgs.values()) {
        console.log('[' + m.author.tag + ']: ' + (m.content || '(embed/attachment)').slice(0, 100));
      }
    } catch (e) {
      console.log(name, e.message);
    }
  };
  const ch = await guild.channels.fetch('1487573515547840512');
  const msgs = await ch.messages.fetch({ limit: 25 });
  for (const m of Array.from(msgs.values()).reverse()) {
    console.log(`[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`);
  }
  process.exit(0);
});

const cleanToken = (process.env.TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
client.login(cleanToken);
