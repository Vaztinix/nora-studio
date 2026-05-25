const { Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const GuildSettings = require('../database/models/GuildSettings');

// Persistent storage: Now partitioned by Guild ID
const dataPath = path.join(__dirname, '..', '..', 'countingData.json');

function getCountingData() {
    if (!fs.existsSync(dataPath)) return {};
    try {
        return JSON.parse(fs.readFileSync(dataPath));
    } catch (e) {
        return {};
    }
}

function saveCountingData(data) {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot) return;

        const settings = await GuildSettings.findOne({ where: { guildId: message.guild.id } });
        if (!settings || !settings.countingChannelId || message.channel.id !== settings.countingChannelId) return;

        const number = parseInt(message.content.trim(), 10);
        if (isNaN(number)) return; 

        const allData = getCountingData();
        const guildData = allData[message.guild.id] || { currentCount: 0, lastUserId: null };
        const expectedNext = guildData.currentCount + 1;

        // Rule: No double-counting in a row on this specific server
        if (guildData.lastUserId === message.author.id) {
            await message.reply({ content: `You ruined it, <@${message.author.id}>! You can't count twice in a row. The count is reset back to 0.` });
            allData[message.guild.id] = { currentCount: 0, lastUserId: null };
            saveCountingData(allData);
            return;
        }

        // Rule: Correct number must be sent
        if (number !== expectedNext) {
            await message.reply({ content: `You ruined it, <@${message.author.id}>! The next number was supposed to be **${expectedNext}**. The count is reset back to 0.` });
            allData[message.guild.id] = { currentCount: 0, lastUserId: null };
            saveCountingData(allData);
            return;
        }

        // Success!
        guildData.currentCount = expectedNext;
        guildData.lastUserId = message.author.id;
        allData[message.guild.id] = guildData;
        saveCountingData(allData);
        await message.react('✅').catch(() => {});

        const { checkAndAwardEgg } = require('../utils/easterEggSystem');
        checkAndAwardEgg(message, 7);
    },
};
