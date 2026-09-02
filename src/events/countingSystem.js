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

async function getGuildCountingData(guildId) {
    const allData = await loadCountingData();
    const data = allData[guildId] || {};
    return {
        currentCount: data.currentCount || 0,
        lastUserId: data.lastUserId || null,
        lastUserTag: data.lastUserTag || null,
        lastCountAt: data.lastCountAt || null,
        highScore: data.highScore || 0,
        highScoreDate: data.highScoreDate || null,
        totalCorrectCounts: data.totalCorrectCounts || 0,
        totalResets: data.totalResets || 0,
        userCounts: data.userCounts || {}
    };
}

async function setGuildCountingData(guildId, data) {
    const allData = await loadCountingData();
    allData[guildId] = {
        ...allData[guildId],
        ...data
    };
    queueSave();
    return allData[guildId];
}

async function safeReplyOrSend(message, payload) {
    if (!message || !message.channel) return null;
    try {
        if (message.system) {
            return await message.channel.send(payload).catch(() => null);
        }
        return await message.reply(payload).catch(async () => {
            return await message.channel.send(payload).catch(() => null);
        });
    } catch (_) {
        return null;
    }
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
            `**⭐ Checkmark & Milestone Reactions:**\n` +
            `• 💯 **100 Milestone**: Special reaction when hitting **100**!\n` +
            `• ✅ **Green Checkmark**: Valid count (working towards server record).\n` +
            `• ☑️ **Blue Checkmark**: **NEW SERVER RECORD / BEST SCORE!** (Exceeds server high score!)\n\n` +
            `**📊 Server Counting Stats:**\n` +
            `• **Current Count:** \`${currentCount}\`\n` +
            `• **Server High Score Best:** \`${highScore}\`\n` +
            `• **Next Required Count:** \`${nextNumber}\`\n\n` +
            `*Use \`n!help\` anytime for counting guidance.*`
        )
        .setColor(0x4F46E5)
        .setFooter({ text: 'Nora Counting System' })
        .setTimestamp();

    return safeReplyOrSend(message, { embeds: [embed] });
}

module.exports = {
    name: Events.MessageCreate,
    sendCountingHelpEmbed,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot || message.system) return;

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
            const hasRole = message.member?.roles?.cache?.some(role => whitelistedRoles.includes(role.id));
            if (!hasRole) {
                return; // Silently drop
            }
        }

        const allData = await loadCountingData();
        const guildData = allData[message.guild.id] || { currentCount: 0, lastUserId: null, highScore: 0 };
        const expectedNext = guildData.currentCount + 1;

        // Check for help commands in counting channel (n!help, !help, n!counting)
        const contentLower = message.content.toLowerCase().trim();
        if ([
            'n!help', '!help', 'n!counting', 
            'n!help counting', '!help counting', '/help counting'
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

            const previousStreak = guildData.currentCount || 0;
            const highScore = guildData.highScore || 0;
            guildData.totalResets = (guildData.totalResets || 0) + 1;
            guildData.currentCount = 0;
            guildData.lastUserId = null;
            guildData.lastMessageId = null;
            guildData.lastMessageContent = null;
            guildData.recentCountMessages = {};
            allData[message.guild.id] = guildData;
            queueSave();

            await safeReplyOrSend(message, { 
                content: `❌ You broke the count, <@${message.author.id}>! The next number was **${expectedNext}**.\n` +
                    `• **Lost Streak:** \`${previousStreak}\`\n` +
                    `• **Server Record:** \`${highScore}\`\n\n` +
                    `The count has been reset to **0**. Start again at **1**!` 
            });
            return;
        }

        // Rule: No double-counting in a row on this specific server
        if (guildData.lastUserId === message.author.id) {
            const previousStreak = guildData.currentCount || 0;
            const highScore = guildData.highScore || 0;
            guildData.totalResets = (guildData.totalResets || 0) + 1;
            guildData.currentCount = 0;
            guildData.lastUserId = null;
            guildData.lastMessageId = null;
            guildData.lastMessageContent = null;
            guildData.recentCountMessages = {};
            allData[message.guild.id] = guildData;
            queueSave();

            await safeReplyOrSend(message, { 
                content: `❌ You cannot count twice in a row, <@${message.author.id}>!\n` +
                    `• **Lost Streak:** \`${previousStreak}\`\n` +
                    `• **Server Record:** \`${highScore}\`\n\n` +
                    `The count has been reset to **0**. Start again at **1**!` 
            });
            return;
        }

        // Success!
        const currentHighScore = guildData.highScore || 0;
        const isNewBest = expectedNext > currentHighScore;

        if (isNewBest) {
            guildData.highScore = expectedNext;
            guildData.highScoreDate = Date.now();
        }

        guildData.currentCount = expectedNext;
        guildData.lastUserId = message.author.id;
        guildData.lastUserTag = message.author.tag || message.author.username;
        guildData.lastCountAt = Date.now();
        guildData.lastMessageId = message.id;
        guildData.lastMessageContent = message.content;
        guildData.totalCorrectCounts = (guildData.totalCorrectCounts || 0) + 1;
        guildData.userCounts = guildData.userCounts || {};
        guildData.userCounts[message.author.id] = (guildData.userCounts[message.author.id] || 0) + 1;

        guildData.recentCountMessages = guildData.recentCountMessages || {};
        guildData.recentCountMessages[message.id] = {
            count: expectedNext,
            authorId: message.author.id,
            content: message.content,
            timestamp: Date.now()
        };
        const messageIds = Object.keys(guildData.recentCountMessages);
        if (messageIds.length > 50) {
            delete guildData.recentCountMessages[messageIds[0]];
        }

        allData[message.guild.id] = guildData;
        queueSave();

        // Reactions:
        // 💯 Emoji for count hitting 100 (or 100 milestones!)
        // Blue Checkmark (☑️) for NEW BEST per server!
        // Green Checkmark (✅) for normal correct count (working towards record)
        if (expectedNext === 100 || (expectedNext > 0 && expectedNext % 100 === 0)) {
            await message.react('💯').catch(() => { });
        } else if (isNewBest) {
            await message.react('☑️').catch(() => { });
        } else {
            await message.react('✅').catch(() => { });
        }

        // Milestone Announcement for major accomplishments
        if (expectedNext > 0 && (expectedNext === 50 || expectedNext % 100 === 0 || expectedNext === 500 || expectedNext === 1000)) {
            const { EmbedBuilder } = require('discord.js');
            const milestoneEmbed = new EmbedBuilder()
                .setTitle(`🎉 Milestone Reached: ${expectedNext}!`)
                .setDescription(
                    `Incredible teamwork! **${message.guild.name}** has reached **${expectedNext}**!\n\n` +
                    `• **Counted by:** <@${message.author.id}>\n` +
                    `• **Next Number:** **${expectedNext + 1}**\n` +
                    `• **All-Time Server Record:** \`${guildData.highScore}\``
                )
                .setColor(0xFEE75C)
                .setFooter({ text: 'Nora Counting Milestone' })
                .setTimestamp();

            await message.channel.send({ embeds: [milestoneEmbed] }).catch(() => {});
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
    handleCountingMessageEdit,
    handleCountingMessageDelete,
    getGuildCountingData,
    setGuildCountingData,
    loadCountingData,
    queueSave
};

async function handleCountingMessageEdit(oldMessage, newMessage, settings) {
    try {
        if (!newMessage || !oldMessage) return;
        const guild = newMessage.guild || oldMessage.guild;
        if (!guild || !settings || !settings.countingChannelId) return;
        if (newMessage.channel.id !== settings.countingChannelId) return;

        const author = newMessage.author || oldMessage.author;
        if (!author || author.bot) return;

        const oldContent = (oldMessage.content || '').trim();
        const newContent = (newMessage.content || '').trim();
        if (oldContent === newContent) return; // Ignore embed or pin/reaction updates

        const allData = await loadCountingData();
        const guildData = allData[guild.id];
        if (!guildData || guildData.currentCount === 0) return;

        // Check if the edited message was part of the active counting game
        const isLastCount = guildData.lastMessageId && guildData.lastMessageId === newMessage.id;
        const isRecentCount = guildData.recentCountMessages && guildData.recentCountMessages[newMessage.id];

        // Also check if either oldContent or newContent looks like a number/count attempt
        const { evaluateCountingInput } = require('../bot/engines/counter');
        const oldEval = oldContent ? evaluateCountingInput(oldContent, guildData.currentCount) : null;
        const newEval = newContent ? evaluateCountingInput(newContent, guildData.currentCount) : null;
        const hadCountContent = (oldEval && (oldEval.isValid || oldEval.result !== undefined)) || (newEval && (newEval.isValid || newEval.result !== undefined));

        if (isLastCount || isRecentCount || hadCountContent) {
            // Remove checkmark reactions if present
            try {
                const reactions = newMessage.reactions.cache;
                for (const r of reactions.values()) {
                    if (['✅', '☑️', '💯'].includes(r.emoji.name)) {
                        await r.users.remove(newMessage.client.user.id).catch(() => {});
                    }
                }
                await newMessage.react('❌').catch(() => {});
            } catch (_) {}

            const originalDisplay = oldContent || (isRecentCount ? isRecentCount.content : (guildData.lastMessageContent || 'N/A'));
            const editedDisplay = newContent || '*[Empty]*';
            const previousStreak = guildData.currentCount || 0;
            const highScore = guildData.highScore || 0;

            guildData.totalResets = (guildData.totalResets || 0) + 1;
            guildData.currentCount = 0;
            guildData.lastUserId = null;
            guildData.lastMessageId = null;
            guildData.lastMessageContent = null;
            guildData.recentCountMessages = {};
            allData[guild.id] = guildData;
            queueSave();

            await safeReplyOrSend(newMessage, {
                content: `❌ <@${author.id}>, **you cannot edit your messages in the counting channel!**\n` +
                    `• **Original:** \`${originalDisplay}\`\n` +
                    `• **Edited To:** \`${editedDisplay}\`\n` +
                    `• **Lost Streak:** \`${previousStreak}\`\n` +
                    `• **Server Record:** \`${highScore}\`\n\n` +
                    `The count has been broken and reset to **0**. Start again at **1**!`
            });
        }
    } catch (err) {
        console.error('[Counting] Error in handleCountingMessageEdit:', err);
    }
}

async function handleCountingMessageDelete(message, settings) {
    try {
        if (!message || !message.guild || !settings || !settings.countingChannelId) return;
        if (message.channel.id !== settings.countingChannelId) return;

        const author = message.author;
        if (author && author.bot) return;

        const allData = await loadCountingData();
        const guildData = allData[message.guild.id];
        if (!guildData || guildData.currentCount === 0) return;

        const isLastCount = guildData.lastMessageId && guildData.lastMessageId === message.id;
        const isRecentCount = guildData.recentCountMessages && guildData.recentCountMessages[message.id];

        if (isLastCount || isRecentCount) {
            const deletedNumber = isRecentCount ? isRecentCount.count : guildData.currentCount;
            const previousStreak = guildData.currentCount || 0;
            const highScore = guildData.highScore || 0;
            const authorMention = author ? `<@${author.id}>` : (isRecentCount ? `<@${isRecentCount.authorId}>` : 'Someone');

            guildData.totalResets = (guildData.totalResets || 0) + 1;
            guildData.currentCount = 0;
            guildData.lastUserId = null;
            guildData.lastMessageId = null;
            guildData.lastMessageContent = null;
            guildData.recentCountMessages = {};
            allData[message.guild.id] = guildData;
            queueSave();

            await message.channel.send({
                content: `❌ ${authorMention} **deleted their count (${deletedNumber}) in the counting channel!**\n` +
                    `Deleting counts ruins the channel count history.\n` +
                    `• **Lost Streak:** \`${previousStreak}\`\n` +
                    `• **Server Record:** \`${highScore}\`\n\n` +
                    `The count has been reset to **0**. Start again at **1**!`
            }).catch(() => {});
        }
    } catch (err) {
        console.error('[Counting] Error in handleCountingMessageDelete:', err);
    }
}
