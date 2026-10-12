const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  const guild = client.guilds.cache.get('1487342521133830174');
  const checkPerms = async (id, name) => {
    const ch = await guild.channels.fetch(id);
    const perms = ch.permissionsFor(guild.members.me);
    console.log(name, {
      canView: perms.has(PermissionsBitField.Flags.ViewChannel),
      canSend: perms.has(PermissionsBitField.Flags.SendMessages),
      canEmbed: perms.has(PermissionsBitField.Flags.EmbedLinks),
      canMentionEveryone: perms.has(PermissionsBitField.Flags.MentionEveryone)
    });
  };
  await checkPerms('1487573376728825967', '#announcements');
  await checkPerms('1511120918334800012', '#server-updates');
  await checkPerms('1487573515547840512', '#general');
  process.exit(0);
});

const cleanToken = (process.env.TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
client.login(cleanToken);
