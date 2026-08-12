const fs = require('fs').promises;
const path = require('path');

const dataPath = path.join(__dirname, '..', '..', 'oneWordStoryData.json');

let storyData = {};
let isLoaded = false;
let loadPromise = null;

async function loadStoryData() {
    if (isLoaded) return storyData;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const data = await fs.readFile(dataPath, 'utf8');
            storyData = JSON.parse(data);
        } catch (e) {
            storyData = {};
        }
        isLoaded = true;
        loadPromise = null;
        return storyData;
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
        const dataStr = JSON.stringify(storyData, null, 2);
        const tempPath = dataPath + '.tmp';
        await fs.writeFile(tempPath, dataStr, 'utf8');
        await fs.rename(tempPath, dataPath);
    } catch (error) {
        console.error('Failed to write One Word Story data to disk:', error);
    } finally {
        isWriting = false;
        if (needsWrite) {
            performWrite();
        }
    }
}

function queueSave() {
    if (writeTimeout) clearTimeout(writeTimeout);
    writeTimeout = setTimeout(() => {
        writeTimeout = null;
        performWrite();
    }, 1000);
}

function formatStory(wordsArray) {
    if (!wordsArray || wordsArray.length === 0) return 'No words submitted yet.';
    let result = '';
    for (let i = 0; i < wordsArray.length; i++) {
        const item = wordsArray[i];
        const w = typeof item === 'object' ? item.word : String(item);
        if (i === 0) {
            result += w;
        } else {
            // Attach punctuation directly without a space if word is punctuation only
            if (/^[.,!?;:'"System]+$/.test(w)) {
                result += w;
            } else {
                result += ' ' + w;
            }
        }
    }
    return result;
}

module.exports = {
    async getActiveGame(channelId) {
        await loadStoryData();
        const session = storyData[channelId];
        return session && session.active ? session : null;
    },

    async startGame(guildId, channelId, userId) {
        await loadStoryData();
        if (storyData[channelId] && storyData[channelId].active) {
            return { success: false, error: 'A game is already in progress in this channel.' };
        }

        storyData[channelId] = {
            guildId,
            channelId,
            startedBy: userId,
            startedAt: new Date().toISOString(),
            words: [],
            lastUserId: null,
            active: true
        };

        queueSave();
        return { success: true, game: storyData[channelId] };
    },

    async endGame(guildId, channelId) {
        await loadStoryData();
        const session = storyData[channelId];
        if (!session || !session.active) {
            return { success: false, error: 'No active game session found in this channel.' };
        }

        session.active = false;
        session.endedAt = new Date().toISOString();

        // Calculate contributor stats
        const contributorMap = {};
        for (const entry of session.words) {
            const key = entry.username || entry.userId;
            contributorMap[key] = (contributorMap[key] || 0) + 1;
        }

        const topContributors = Object.entries(contributorMap)
            .map(([username, count]) => ({ username, count }))
            .sort((a, b) => b.count - a.count);

        const storyText = formatStory(session.words);

        queueSave();

        return {
            success: true,
            story: storyText,
            wordCount: session.words.length,
            contributorsCount: Object.keys(contributorMap).length,
            topContributors,
            startedAt: session.startedAt,
            endedAt: session.endedAt
        };
    },

    async processWord(channelId, rawContent, user, allowConsecutive = false) {
        await loadStoryData();
        const session = storyData[channelId];

        if (!session || !session.active) {
            return { success: false, reason: 'no_game' };
        }

        const content = rawContent ? rawContent.trim() : '';
        if (!content) {
            return { success: false, reason: 'empty' };
        }

        // 1. Prevent commands
        if (/^[/!?.#$&-]/.test(content)) {
            return { success: false, reason: 'command' };
        }

        // 2. Prevent mentions & unsafe patterns (@everyone, @here, <@123>, <@&123>, URLs)
        if (/@everyone|@here|<@!?\d+>|<@&\d+>|https?:\/\/|discord\.gg/i.test(content)) {
            return { success: false, reason: 'unsafe_mention' };
        }

        // 3. Single word validation (splitting on whitespace must result in 1 element)
        const parts = content.split(/\s+/);
        if (parts.length > 1) {
            return { success: false, reason: 'multiple_words', message: 'You must submit exactly one word per turn.' };
        }

        const word = parts[0];

        // Sanity check word length (max 45 chars for standard longest words)
        if (word.length > 45) {
            return { success: false, reason: 'too_long', message: 'Word is too long.' };
        }

        // 4. Consecutive user turn protection
        if (!allowConsecutive && session.lastUserId === user.id) {
            return { success: false, reason: 'consecutive', message: 'You cannot submit two words in a row! Wait for someone else.' };
        }

        // Add valid word entry
        const entry = {
            word,
            userId: user.id,
            username: user.username || user.tag || 'User',
            timestamp: Date.now()
        };

        session.words.push(entry);
        session.lastUserId = user.id;

        queueSave();

        return {
            success: true,
            word,
            wordCount: session.words.length,
            lastUserId: user.id,
            story: formatStory(session.words)
        };
    },

    async getStoryFormatted(channelId) {
        await loadStoryData();
        const session = storyData[channelId];
        if (!session) return 'No story found.';
        return formatStory(session.words);
    }
};
