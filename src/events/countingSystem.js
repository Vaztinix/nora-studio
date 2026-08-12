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

function sendCountingHelpEmbed(message, guildData) {
    const { EmbedBuilder } = require('discord.js');
    const currentCount = guildData ? (guildData.currentCount || 0) : 0;
    const highScore = guildData ? (guildData.highScore || 0) : 0;
    const nextNumber = currentCount + 1;

    const embed = new EmbedBuilder()
        .setTitle('🔢 Nora Counting Game Guide')
        .setDescription(
            `Welcome to **Nora Counting**! Work together with your server members to count as high as possible.\n\n` +
            `**📖 Rules:**\n` +
            `• Count up sequentially starting from **1** (or current number **${nextNumber}**).\n` +
            `• **You cannot count twice in a row!** Another member must count next.\n` +
            `• Mathematical expressions are supported (e.g., \`1+1\`, \`5*2\`, \`10-3\`).\n` +
            `• Making a mistake or double-counting resets the count to **0**, but preserves your server's high score best!\n\n` +
            `**⭐ Checkmark Reactions:**\n` +
            `• ✅ **Green Checkmark**: Valid count (working towards server record).\n` +
            `• ☑️ **Blue Checkmark**: **NEW SERVER RECORD / BEST SCORE!** (Exceeds server high score!)\n\n` +
            `**📊 Server Counting Stats:**\n` +
            `• **Current Count:** \`${currentCount}\`\n` +
            `• **Server High Score Best:** \`${highScore}\`\n` +
            `• **Next Required Count:** \`${nextNumber}\`\n\n` +
            `*Use \`n!help\` or \`c!help\` anytime for counting guidance.*`
        )
        .setColor(0x4F46E5)
        .setFooter({ text: 'Nora Counting System' })
        .setTimestamp();

    return message.reply({ embeds: [embed] }).catch(() => {});
}

module.exports = {
    name: Events.MessageCreate,
    sendCountingHelpEmbed,
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
        } catch (e) { }
        if (blacklistedUsers.includes(message.author.id)) {
            return; // Silently drop
        }

        // 2. Whitelisted roles check
        let whitelistedRoles = [];
        try {
            whitelistedRoles = JSON.parse(settings.countingWhitelistedRoles || '[]');
        } catch (e) { }
        if (whitelistedRoles.length > 0) {
            const hasRole = message.member?.roles.cache.some(role => whitelistedRoles.includes(role.id));
            if (!hasRole) {
                return; // Silently drop
            }
        }

        const allData = await loadCountingData();
        const guildData = allData[message.guild.id] || { currentCount: 0, lastUserId: null, highScore: 0 };
        const expectedNext = guildData.currentCount + 1;

        // Check for help commands in counting channel (n!help, c!help, !help, n!counting, c!counting)
        const contentLower = message.content.toLowerCase().trim();
        if ([
            'n!help', 'c!help', '!help', 'n!counting', 'c!counting', 
            'n!help counting', 'c!help counting', '!help counting', '/help counting'
        ].includes(contentLower)) {
            return sendCountingHelpEmbed(message, guildData);
        }

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

            const highScore = guildData.highScore || 0;
            await message.reply({ content: `You ruined it, <@${message.author.id}>! The next number was **${expectedNext}**. The count is reset back to **0**.\n\n*Server High Score Best: \`${highScore}\`. Use \`n!help\` or \`c!help\` for counting rules.*` });
            allData[message.guild.id] = { currentCount: 0, lastUserId: null, highScore };
            queueSave();
            return;
        }

        // Rule: No double-counting in a row on this specific server
        if (guildData.lastUserId === message.author.id) {
            const highScore = guildData.highScore || 0;
            await message.reply({ content: `You ruined it, <@${message.author.id}>! You can't count twice in a row. The count is reset back to **0**.\n\n*Server High Score Best: \`${highScore}\`. Use \`n!help\` or \`c!help\` for counting rules.*` });
            allData[message.guild.id] = { currentCount: 0, lastUserId: null, highScore };
            queueSave();
            return;
        }

        // Success!
        const currentHighScore = guildData.highScore || 0;
        const isNewBest = expectedNext > currentHighScore;

        if (isNewBest) {
            guildData.highScore = expectedNext;
        }

        guildData.currentCount = expectedNext;
        guildData.lastUserId = message.author.id;
        allData[message.guild.id] = guildData;
        queueSave();

        // Reactions:
        // Blue Checkmark (☑️) for NEW BEST per server!
        // Green Checkmark (✅) for normal correct count (working towards record)
        if (isNewBest) {
            await message.react('☑️').catch(() => { });
        } else {
            await message.react('✅').catch(() => { });
        }

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
