require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const sequelize = require('./database/db');

// Require models to sync them
require('./database/models/GuildSettings');
require('./database/models/UserLevel');
require('./database/models/Giveaway');
require('./database/models/EasterEgg');
require('./database/models/GlobalSettings');
require('./database/models/OneTimeEvent');
require('./database/models/Warning');
require('./database/models/UserMemory');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.AutoModerationExecution,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember, Partials.ThreadMember]
});

client.commands = new Collection();

// Execute handlers
const commandHandler = require('./handlers/commandHandler');
const eventHandler = require('./handlers/eventHandler');

commandHandler(client);
eventHandler(client);

// Sync database and login with high-stability index handling
sequelize.sync().then(() => {
    console.log('Nora - Database Synchronized (Leveling Indices Healthy)');
    
    // 🛡️ Nora System Persistence (System Backup) - V17.2
    const { systemBackup } = require('./utils/persistence');
    systemBackup();

    // Start autonomous systems
    require('./utils/presence').startPresence();
    require('./utils/voiceTracker').start(client);
    require('./utils/giveawayManager').startGiveawayManager(client);
    
    // Final check for token stability
    client.login(process.env.TOKEN);
}).catch(err => {
    console.error('Nora - Database Connection Failure:', err);
});

// Global Error Handling to prevent the bot from going offline on minor errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

// 🗳️ System Vote HQ Tracker (Webhook Server) & AutoPoster
const { AutoPoster } = require('topgg-autoposter');
const express = require('express');
const Topgg = require('@top-gg/sdk');
const app = express();
const PORT = process.env.PORT || 3000;
const { EmbedBuilder } = require('discord.js');
const noraLeveling = require('./utils/noraLeveling');
const GuildSettings = require('./database/models/GuildSettings');

const webhook = new Topgg.Webhook(process.env.VOTE_SECRET || 'NORA_VOTE_SECRET_2026');
const NORA_SERVER_ID = '1351304498185900184';
const NORA_V0 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJib3QiOiJ0cnVlIiwiaWQiOiIxMzc1OTQzNzMwOTUxMDk4NTQ5IiwiaWF0IjoiMTc3MDc3MTYxNCJ9.o96WlKCfGM-Gzidt0laP_TYy2vEj6aaQ20qMXJRwc44';

app.post('/topgg/webhook', webhook.listener(async (vote) => {
    console.log(`[Top.gg] Received vote from User: ${vote.user} for Bot: ${vote.bot}`);

    try {
        const userId = vote.user;
        
        // Award XP in Nora Mainframe (HQ)
        const userRecord = await noraLeveling.getOrInitializeUser(userId, NORA_SERVER_ID);
        if (userRecord) {
            await noraLeveling.addExperience(userRecord, 50);
            userRecord.voteCount = (userRecord.voteCount || 0) + 1;
            userRecord.lastVoteTimestamp = new Date();
            await userRecord.save();
        }

        // Log to HQ
        const hqSettings = await GuildSettings.findOne({ where: { guildId: NORA_SERVER_ID } });
        if (hqSettings && hqSettings.voteLogChannelId) {
            const hqGuild = client.guilds.cache.get(NORA_SERVER_ID);
            if (hqGuild) {
                const logChannel = hqGuild.channels.cache.get(hqSettings.voteLogChannelId);
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle('New Top.gg Vote! 🗳️')
                        .setDescription(`User <@${userId}> just voted for Nora!`)
                        .addFields(
                            { name: 'Reward', value: '50 XP Added', inline: true },
                            { name: 'Total Votes', value: `${userRecord ? userRecord.voteCount : 1}`, inline: true }
                        )
                        .setColor(0xFFA500)
                        .setTimestamp();
                    await logChannel.send({ embeds: [embed] }).catch(() => {});
                }
            }
        }
    } catch (error) {
        console.error('[Top.gg] Error processing vote:', error);
    }
}));

app.listen(PORT, () => {
    console.log(`[System] Top.gg Webhook listener online at port ${PORT}`);
    
    // Start AutoPoster using the v0 token for statistics
    const ap = AutoPoster(NORA_V0, client);
    ap.on('posted', () => {
        console.log('[Top.gg] Statistics automatically posted.');
    });
});





