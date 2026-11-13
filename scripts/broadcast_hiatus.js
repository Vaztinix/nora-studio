require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const sequelize = require('../src/database/db');
const SiteAlert = require('../src/database/models/SiteAlert');

const ANNOUNCEMENT_TEXT = `Nora is going on Hiatus and during the mean time we are going to fix core stability issues, relaunch with V3 rewrites of all code and release Nora Studio Dashboard 5.0.0 with our relaunch introducing our own new UI System which we will be calling Flux UI which will rely on Discord's API heavily to make server stats update more often without hitting those limits we all hate but know are there for a reason.

We will launch with 2 new shards automatically seperating our servers early on with brand new hardware to power Nora.

Not every leave is bad that is why we are taking the time to bring Nora into the spotlight. So don't get too upset because by the time you know it we will be back on our feet stronger than ever possibly even surpassing the bots we call mainstream.

We are also returning on January 5, 2027 with a brand new YouTube Channel, X, and our own support domain. This is where the future of Nora begins.

"Never give up on your dreams"
- Damien Adams (Demi) | Founder of Nora and Nora Studio's. Lets all build a better future together.`;

async function run() {
    console.log('[Hiatus Broadcast] Initializing...');

    // 1. Update Database SiteAlert
    try {
        await sequelize.authenticate();
        await SiteAlert.sync();
        await SiteAlert.create({
            title: 'Official Announcement: Nora Hiatus & Relaunch',
            message: ANNOUNCEMENT_TEXT,
            type: 'announcement',
            authorId: '1214048435632603137',
            isActive: true
        });
        console.log('[Hiatus Broadcast] SiteAlert record successfully stored in database.');
    } catch (e) {
        console.warn('[Hiatus Broadcast] Database alert notice warning:', e.message);
    }

    // 2. Connect to Discord
    const token = (process.env.TOKEN || '').trim().replace(/^["']|["']$/g, '');
    if (!token) {
        console.error('[Hiatus Broadcast] No Discord TOKEN found in environment.');
        process.exit(0);
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages
        ]
    });

    client.once('ready', async () => {
        console.log(`[Hiatus Broadcast] Logged in as ${client.user.tag}. Broadcasting to guilds...`);
        let sentCount = 0;
        let failCount = 0;

        for (const [guildId, guild] of client.guilds.cache) {
            try {
                // Find ideal channel: announcement channel -> channel with 'announcement' in name -> systemChannel -> text channel
                const me = guild.members.me;
                if (!me) continue;

                let targetChannel = guild.channels.cache.find(c => 
                    (c.type === ChannelType.GuildAnnouncement || c.type === ChannelType.GuildText) &&
                    (c.name.includes('announcement') || c.name.includes('nora-update') || c.name.includes('bot-update') || c.name.includes('news')) &&
                    c.permissionsFor(me).has(PermissionFlagsBits.SendMessages)
                );

                if (!targetChannel && guild.systemChannel && guild.systemChannel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
                    targetChannel = guild.systemChannel;
                }

                if (!targetChannel) {
                    targetChannel = guild.channels.cache.find(c => 
                        c.type === ChannelType.GuildText && 
                        c.permissionsFor(me).has(PermissionFlagsBits.SendMessages)
                    );
                }

                if (targetChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle('Official Announcement: Nora System Hiatus & V3 Relaunch')
                        .setDescription(ANNOUNCEMENT_TEXT)
                        .setColor(0x5865F2)
                        .addFields(
                            { name: 'Official Return Date', value: 'January 5, 2027', inline: true },
                            { name: 'Upcoming Features', value: 'Flux UI System, V3 Rewrites, Dashboard 5.0.0, 2-Shard Architecture', inline: true },
                            { name: 'New Platforms', value: 'Brand New YouTube Channel, X, Dedicated Support Domain', inline: false }
                        )
                        .setFooter({ text: 'Nora Studio Operations - Damien Adams (Demi) | Founder' })
                        .setTimestamp();

                    await targetChannel.send({ embeds: [embed] });
                    sentCount++;
                    console.log(`[Hiatus Broadcast] Sent to ${guild.name} (#${targetChannel.name})`);
                }
            } catch (err) {
                failCount++;
            }
        }

        console.log(`[Hiatus Broadcast] Completed. Sent to ${sentCount} guilds. Failed/Skipped: ${failCount}.`);
        setTimeout(() => {
            client.destroy();
            process.exit(0);
        }, 3000);
    });

    client.login(token).catch(err => {
        console.error('[Hiatus Broadcast] Discord login failed:', err.message);
        process.exit(0);
    });
}

run();
