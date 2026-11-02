const { Events } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const settingsCache = require('../utils/settingsCache');

// Persistent storage: Partitioned by Guild ID
const dataPath = path.join(__dirname, '..', '..', 'guessNumberData.json');

let guessData = {};
let isLoaded = false;
let loadPromise = null;

async function loadGuessData() {
    if (isLoaded) return guessData;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const data = await fs.readFile(dataPath, 'utf8');
            guessData = JSON.parse(data);
        } catch (e) {
            guessData = {};
        }
        isLoaded = true;
        loadPromise = null;
        return guessData;
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
        const dataStr = JSON.stringify(guessData, null, 2);
        const tempPath = dataPath + '.tmp';
        await fs.writeFile(tempPath, dataStr, 'utf8');
        await fs.rename(tempPath, dataPath);
    } catch (error) {
        console.error('Failed to write guess number data to disk:', error);
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
    }, 1000);
}

/**
 * Automatically states in the configured channel that Guess the Number is set up and starts the game.
 */
async function announceAndStartGame(guild, settings) {
    if (!guild || !settings || settings.guessGameEnabled === false || !settings.guessNumberChannelId) {
        console.warn('[Guess the Number] Missing guild, settings, or guessNumberChannelId:', {
            hasGuild: Boolean(guild),
            guessGameEnabled: settings?.guessGameEnabled,
            guessNumberChannelId: settings?.guessNumberChannelId
        });
        return null;
    }

    const channelId = String(settings.guessNumberChannelId).trim();
    let channel = guild.channels?.cache?.get(channelId);
    if (!channel && guild.channels?.fetch) {
        channel = await guild.channels.fetch(channelId).catch(() => null);
    }

    if (!channel) {
        console.warn(`[Guess the Number] Channel ${channelId} could not be resolved in guild ${guild.id}`);
        return null;
    }

    // Check bot permissions safely without false-positive null checks
    try {
        const me = guild.members?.me || (guild.members?.fetchMe ? await guild.members.fetchMe().catch(() => null) : null);
        if (me && typeof channel.permissionsFor === 'function') {
            const perms = channel.permissionsFor(me);
            if (perms && !perms.has(['ViewChannel', 'SendMessages'])) {
                console.warn(`[Guess the Number] Nora lacks ViewChannel/SendMessages in #${channel.name || channelId}`);
                return null;
            }
        }
    } catch (permErr) {
        console.warn('[Guess the Number] Perm check notice:', permErr.message);
    }

    // Start / reset the game round
    const state = await startOrResetGame(guild.id, settings);

    const min = state.min;
    const max = state.max;
    const guessLimit = state.guessLimit;
    const xpReward = Math.max(10, parseInt(settings.guessGameXpReward, 10) || 50);

    const setupEmbed = {
        title: '🎲 Guess the Number is Ready!',
        description: `The Number Guessing game has been successfully configured and is now active in this channel!\n\n` +
            `🔢 **Range**: Between **${min.toLocaleString()}** and **${max.toLocaleString()}**\n` +
            `🎯 **Guess Limit**: **${guessLimit}** ${guessLimit === 1 ? 'guess' : 'guesses'} per round\n` +
            `🏆 **Win XP Reward**: **+${xpReward} XP**\n\n` +
            `**How to Play**:\n` +
            `Simply type any whole number in this channel to submit your guess. Nora will instantly react:\n` +
            `• ⏬ The secret number is **lower**\n` +
            `• ⏫ The secret number is **higher**\n` +
            `• ✅ **You got it!** (Awards XP & immediately picks a new number)\n` +
            `• ❌ **Out of guesses!** (Reveals the secret number & automatically restarts)\n\n` +
            `*A secret number between ${min.toLocaleString()} and ${max.toLocaleString()} has been chosen! The first guess starts the round.*`,
        color: 0x5865F2,
        footer: { text: `Nora Games Engine • Round #${state.round} • Continuous Play` },
        timestamp: new Date().toISOString()
    };

    const { buildEmbedV2Container } = require('../utils/embeds');
    let sent = false;

    // Try Components V2 Container
    if (settings.embedsVersion !== 'v1') {
        try {
            const v2 = buildEmbedV2Container(setupEmbed);
            await channel.send({ ...v2 });
            sent = true;
        } catch (v2Err) {
            console.warn('[Guess the Number] V2 send failed, attempting standard embed:', v2Err.message);
        }
    }

    // Fallback standard embed
    if (!sent) {
        try {
            await channel.send({ embeds: [setupEmbed] });
            sent = true;
        } catch (embedErr) {
            console.warn('[Guess the Number] Embed send failed, attempting plain text fallback:', embedErr.message);
        }
    }

    // Final fallback: plain text message (if bot lacks EmbedLinks permission)
    if (!sent) {
        try {
            await channel.send(`🎲 **Guess the Number is Active!** Range: **${min.toLocaleString()}** to **${max.toLocaleString()}** (Limit: ${guessLimit} guesses | +${xpReward} XP). Type your guess in this channel to start!`);
            sent = true;
        } catch (textErr) {
            console.error('[Guess the Number] All send attempts failed in channel:', textErr.message);
            return null;
        }
    }

    return state;
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (!message || !message.guild || message.author.bot || message.webhookId) return;

        // Check content: must be an integer guess
        const rawContent = message.content ? message.content.trim() : '';
        if (!/^-?\d+$/.test(rawContent)) return;

        const guess = parseInt(rawContent, 10);
        if (isNaN(guess)) return;

        let settings = null;
        try {
            settings = await settingsCache.get(message.guild.id);
        } catch (e) {
            return;
        }

        if (!settings || settings.guessGameEnabled === false || !settings.guessNumberChannelId) return;
        if (message.channel.id !== settings.guessNumberChannelId) return;

        // Calculate allowed bounds (min 0, max 100,000)
        const min = Math.max(0, parseInt(settings.guessGameMin, 10) || 0);
        const max = Math.min(100000, Math.max(min + 1, parseInt(settings.guessGameMax, 10) || 100));
        const range = max - min + 1;

        // Guess limit cannot be greater than range, defaults to 6
        const configuredLimit = parseInt(settings.guessNumberGuessLimit, 10) || 6;
        const guessLimit = Math.min(range, Math.max(1, configuredLimit));

        // Skip guesses outside current configured range to be fair
        if (guess < min || guess > max) return;

        const allData = await loadGuessData();
        let state = allData[message.guild.id];

        // Initialize state or re-seed if range shifted
        if (!state || typeof state.target !== 'number' || state.target < min || state.target > max) {
            state = {
                target: Math.floor(Math.random() * range) + min,
                guessesRemaining: guessLimit,
                attempts: 0,
                totalWins: state?.totalWins || 0,
                round: (state?.round || 0) + 1
            };
            allData[message.guild.id] = state;
        }

        state.attempts = (state.attempts || 0) + 1;
        state.guessesRemaining = (typeof state.guessesRemaining === 'number' ? state.guessesRemaining : guessLimit) - 1;

        if (guess === state.target) {
            // ✅ Got the number!
            await message.react('✅').catch(() => {});

            // Award XP
            const xpReward = Math.max(10, parseInt(settings.guessGameXpReward, 10) || 50);
            try {
                const NoraLeveling = require('../utils/noraLeveling');
                const userLevel = await NoraLeveling.getOrInitializeUser(message.author.id, message.guild.id);
                if (userLevel) {
                    await NoraLeveling.addExperience(userLevel, xpReward);
                    await userLevel.save();
                }
            } catch (xpErr) {
                console.error('[Guess Game XP Error]:', xpErr);
            }

            const winEmbed = {
                title: '🎉 Number Guessed Correctly!',
                description: `Congratulations <@${message.author.id}>! You found the secret number **${state.target}** in **${state.attempts}** ${state.attempts === 1 ? 'guess' : 'guesses'}!\n\n**+${xpReward} XP** has been added to your profile.\n\n🔄 *A new secret number between **${min.toLocaleString()}** and **${max.toLocaleString()}** has been selected (Limit: **${guessLimit}** guesses). Start guessing!*`,
                color: 0x10b981
            };

            const { buildEmbedV2Container } = require('../utils/embeds');
            if (settings.embedsVersion !== 'v1') {
                const v2 = buildEmbedV2Container(winEmbed);
                await message.channel.send({ ...v2 }).catch(async () => {
                    await message.channel.send({ embeds: [winEmbed] }).catch(() => {});
                });
            } else {
                await message.channel.send({ embeds: [winEmbed] }).catch(() => {});
            }

            // Always restart immediately
            state.target = Math.floor(Math.random() * range) + min;
            state.guessesRemaining = guessLimit;
            state.attempts = 0;
            state.round = (state.round || 1) + 1;
            state.totalWins = (state.totalWins || 0) + 1;
            queueSave();

        } else if (state.guessesRemaining <= 0) {
            // ❌ Ran out of guesses!
            await message.react('❌').catch(() => {});

            const failEmbed = {
                title: '❌ Out of Guesses!',
                description: `Nobody guessed it! The secret number was **${state.target}**.\n\n🔄 *A new secret number between **${min.toLocaleString()}** and **${max.toLocaleString()}** has been selected (Limit: **${guessLimit}** guesses). Good luck!*`,
                color: 0xef4444
            };

            const { buildEmbedV2Container } = require('../utils/embeds');
            if (settings.embedsVersion !== 'v1') {
                const v2 = buildEmbedV2Container(failEmbed);
                await message.channel.send({ ...v2 }).catch(async () => {
                    await message.channel.send({ embeds: [failEmbed] }).catch(() => {});
                });
            } else {
                await message.channel.send({ embeds: [failEmbed] }).catch(() => {});
            }

            // Always restart immediately
            state.target = Math.floor(Math.random() * range) + min;
            state.guessesRemaining = guessLimit;
            state.attempts = 0;
            state.round = (state.round || 1) + 1;
            queueSave();

        } else {
            // Number is still in play: ⏬ for lower, ⏫ for higher
            if (state.target < guess) {
                // Target is LOWER than the guess
                await message.react('⏬').catch(() => {});
            } else {
                // Target is HIGHER than the guess
                await message.react('⏫').catch(() => {});
            }
            queueSave();
        }
    },
    startOrResetGame,
    announceAndStartGame,
    loadGuessData
};
