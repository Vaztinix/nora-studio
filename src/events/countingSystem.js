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

        // Forward-only timeline privacy check
        const botJoinTime = settings && settings.installedAt ? new Date(settings.installedAt).getTime() : Date.now();
        const messageTime = new Date(message.createdAt).getTime();
        if (messageTime < botJoinTime) return;

        // 1. Blacklisted users check
        let blacklistedUsers = [];
        try {
            blacklistedUsers = JSON.parse(settings.countingBlacklistedUsers || '[]');
        } catch (e) {}
        if (blacklistedUsers.includes(message.author.id)) {
            return; // Silently drop
        }

        // 2. Whitelisted roles check
        let whitelistedRoles = [];
        try {
            whitelistedRoles = JSON.parse(settings.countingWhitelistedRoles || '[]');
        } catch (e) {}
        if (whitelistedRoles.length > 0) {
            const hasRole = message.member?.roles.cache.some(role => whitelistedRoles.includes(role.id));
            if (!hasRole) {
                return; // Silently drop
            }
        }

        const allData = await loadCountingData();
        const guildData = allData[message.guild.id] || { currentCount: 0, lastUserId: null };
        const expectedNext = guildData.currentCount + 1;

        // 3. Evaluate expression using evaluateCountingInput
        const { evaluateCountingInput } = require('../bot/engines/counter');
        const evalResult = evaluateCountingInput(message.content.trim(), expectedNext);

        if (!evalResult.isValid) {
            // Silently ignore non-counting content: pure emojis, text, or malformed expressions
            // Only reset the count if someone deliberately typed a wrong number
            if (evalResult.reason && (
                evalResult.reason.includes("Security rejection") ||
                evalResult.reason.includes("Non-counting content") ||
                evalResult.reason.includes("Calculation error")
            )) {
                return; 
            }
            
            await message.reply({ content: `You ruined it, <@${message.author.id}>! ${evalResult.reason} The count is reset back to 0.` });
            allData[message.guild.id] = { currentCount: 0, lastUserId: null };
            queueSave();
            return;
        }

        // Rule: No double-counting in a row on this specific server
        if (guildData.lastUserId === message.author.id) {
            await message.reply({ content: `You ruined it, <@${message.author.id}>! You can't count twice in a row. The count is reset back to 0.` });
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

        // Award XP for successful count
        try {
            const xpReward = settings.countingChannelXpReward !== undefined ? settings.countingChannelXpReward : 15;
            if (xpReward > 0) {
                const NoraLeveling = require('../utils/noraLeveling');
                const userLevel = await NoraLeveling.getOrInitializeUser(message.author.id, message.guild.id);
                if (userLevel) {
                    await NoraLeveling.addExperience(userLevel, xpReward);
                    await userLevel.save();
                }
            }
        } catch (e) {
            console.error('Failed to award counting XP:', e);
        }

        const { checkAndAwardEgg } = require('../utils/easterEggSystem');
        checkAndAwardEgg(message, 7);
    },
};
