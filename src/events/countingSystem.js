const { Events } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const settingsCache = require('../utils/settingsCache');

// Persistent storage: Partitioned by Guild ID
const dataPath = path.join(__dirname, '..', '..', 'countingData.json');

// In-memory cache
let countingData = {};
let isLoaded = false;
let loadPromise = null;

async function loadCountingData() {
    if (isLoaded) return countingData;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const data = await fs.readFile(dataPath, 'utf8');
            countingData = JSON.parse(data);
        } catch (e) {
            countingData = {};
        }
        isLoaded = true;
        loadPromise = null;
        return countingData;
    })();

    return loadPromise;
}

let writeTimeout = null;
let isWriting = false;
let needsWrite = false;

async function performWrite() {
    if (isWriting) {
        needsWrite = true;
        return;
    }
    isWriting = true;
    needsWrite = false;
    try {
        const dataStr = JSON.stringify(countingData, null, 2);
        const tempPath = dataPath + '.tmp';
        await fs.writeFile(tempPath, dataStr, 'utf8');
        await fs.rename(tempPath, dataPath);
    } catch (error) {
        console.error('Failed to write counting data asynchronously to disk:', error);
    } finally {
        isWriting = false;
        if (needsWrite) {
            performWrite();
        }
    }
}

function queueSave() {
    if (writeTimeout) {
        clearTimeout(writeTimeout);
    }
    writeTimeout = setTimeout(() => {
        writeTimeout = null;
        performWrite();
    }, 1000); // 1-second debounce delay
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot) return;

        const settings = await settingsCache.get(message.guild.id);
        if (!settings || !settings.countingChannelId || message.channel.id !== settings.countingChannelId) return;

        const number = parseInt(message.content.trim(), 10);
        if (isNaN(number)) return;

        const allData = await loadCountingData();
        const guildData = allData[message.guild.id] || { currentCount: 0, lastUserId: null };
        const expectedNext = guildData.currentCount + 1;

        // Rule: No double-counting in a row on this specific server
        if (guildData.lastUserId === message.author.id) {
            await message.reply({ content: `You ruined it, <@${message.author.id}>! You can't count twice in a row. The count is reset back to 0.` });
            allData[message.guild.id] = { currentCount: 0, lastUserId: null };
            queueSave();
            return;
        }

        // Rule: Correct number must be sent
        if (number !== expectedNext) {
            await message.reply({ content: `You ruined it, <@${message.author.id}>! The next number was supposed to be **${expectedNext}**. The count is reset back to 0.` });
            allData[message.guild.id] = { currentCount: 0, lastUserId: null };
            queueSave();
            return;
        }

        // Success!
        guildData.currentCount = expectedNext;
        guildData.lastUserId = message.author.id;
        allData[message.guild.id] = guildData;
        queueSave();
        await message.react('✅').catch(() => {});

        const { checkAndAwardEgg } = require('../utils/easterEggSystem');
        checkAndAwardEgg(message, 7);
    },
};
