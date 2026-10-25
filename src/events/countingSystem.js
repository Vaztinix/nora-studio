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
        userCounts: data.userCounts || {},
        userFails: data.userFails || {}
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

/**
 * Checks and applies the fail role if user exceeds the failure limit
 */
async function checkAndApplyFailRole(guild, member, userId, settings, guildData) {
    guildData.userFails = guildData.userFails || {};
    guildData.userFails[userId] = (guildData.userFails[userId] || 0) + 1;
    const failCount = guildData.userFails[userId];
    const threshold = settings?.countingFailThreshold || 1;

    if (!settings?.countingFailRoleId || failCount < threshold) {
        return { failCount, threshold, roleAssigned: false, notice: '' };
    }

    try {
        const { PermissionFlagsBits } = require('discord.js');
        const me = guild.members.me;
        if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return { failCount, threshold, roleAssigned: false, notice: '' };
        }

        const failRoleId = String(settings.countingFailRoleId).replace(/[^0-9]/g, '');
        const failRole = guild.roles.cache.get(failRoleId) || await guild.roles.fetch(failRoleId).catch(() => null);
        if (!failRole || failRole.position >= me.roles.highest.position || failRole.managed) {
            return { failCount, threshold, roleAssigned: false, notice: '' };
        }

        const targetMember = member || await guild.members.fetch(userId).catch(() => null);
        if (targetMember && !targetMember.roles.cache.has(failRoleId)) {
            await targetMember.roles.add(failRole, `Counting: Exceeded failure limit (${failCount}/${threshold} fails)`).catch(() => {});
            return {
                failCount,
                threshold,
                roleAssigned: true,
                roleId: failRoleId,
                notice: `\n⛔ <@${userId}> has reached **${failCount}** failed count(s) (Limit: **${threshold}**) and has been assigned the <@&${failRoleId}> role!`
            };
        }
    } catch (e) {
        console.error('[Counting Fail Role Error]:', e.message);
    }

    return { failCount, threshold, roleAssigned: false, notice: '' };
}

function sendCountingHelpEmbed(message, guildData) {
    const { EmbedBuilder } = require('discord.js');
    const currentCount = guildData ? (guildData.currentCount || 0) : 0;
    const highScore = guildData ? (guildData.highScore || 0) : 0;
    const nextNumber = currentCount + 1;

    const embed = new EmbedBuilder()
        .setTitle('🔢 Nora Counting Game & Math Syntax Manual')
        .setDescription(
            `Welcome to **Nora Counting**! Work together with your server members to count as high as possible using standard integers or advanced mathematical expressions.\n\n` +
            `**📖 Core Rules:**\n` +
            `• Count up sequentially starting from **1** (Next required number: **${nextNumber}**).\n` +
            `• **You cannot count twice in a row!** Another member must count next.\n` +
            `• **Formatting edits are allowed!** You may edit your message for bolding, italics, or spoilers as long as alphanumeric characters remain untouched.\n` +
            `• Making a mistake or double-counting resets the server count to **0** and wipes the offender's personal score!`
        )
        .addFields(
            {
                name: '🧮 Division & Basic Arithmetic',
                value:
                    '• **Colon Division (`:`)**: `(2^2^1+38):7-2 = 4`, `42:7 = 6`, `10:2 = 5`\n' +
                    '• **Obelus & Slashes (`÷`, `/`, `∕`, `⁄`)**: `20 ÷ 5 = 4`, `16 / 4 = 4`\n' +
                    '• **Subtraction & Dashes (`-`, `−`, `–`, `—`)**: `10 − 6 = 4`, `8 - 4 = 4`\n' +
                    '• **Grouping Symbols (`(...)`, `[...]`, `{...}`)**: `[(2+3)*2] - 6 = 4`',
                inline: false
            },
            {
                name: '✖️ Multiplication & Powers',
                value:
                    '• **Multiplication Signs (`*`, `×`, `•`, `·`, `⋅`, `∙`)**: `2 × 2 = 4`, `2 • 2 = 4`\n' +
                    '• **Algebraic & Implicit Multiplication**: `2(2) = 4`, `(2)(2) = 4`, `2x2 = 4`\n' +
                    '• **Exponents (`^`, `**`)**: `2^2 = 4`, `2**3 = 8`\n' +
                    '• **Unicode Superscripts (`⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻`)**: `2² = 4`, `2³ = 8`, `10⁴ = 10000`, `2²⁺¹ = 8`',
                inline: false
            },
            {
                name: '📐 Roots, Radicals & Absolute Values',
                value:
                    '• **Roots (`√`, `∛`, `∜`, `nthRoot`)**: `√16 = 4`, `∛8 = 2`, `∜16 = 2`, `nthRoot(81, 4) = 3`\n' +
                    '• **Absolute Values (`|x|`, `abs`)**: `|-4| = 4`, `|2 - 6| = 4`, `abs(-4) = 4`\n' +
                    '• **Rounding & Sign**: `round(3.6) = 4`, `floor(4.9) = 4`, `ceil(3.1) = 4`, `trunc(4.8) = 4`',
                inline: false
            },
            {
                name: '🎲 Combinatorics, Modulo & Advanced Functions',
                value:
                    '• **Combinations & Permutations**: `4 choose 2 = 6`, `4 nCr 2 = 6`, `4 nPr 2 = 12`\n' +
                    '• **Factorials**: `4! = 24`, `fact(4) = 24`\n' +
                    '• **Modulo & Bases**: `10 % 3 = 1`, `10 mod 3 = 1`, Hex `0x10 = 16`, Binary `0b100 = 4`\n' +
                    '• **Constants & Functions**: `pi` (`π`), `tau` (`τ`), `phi` (`ϕ`), `e`, `ln(e) = 1`, `hypot(3, 4) = 5`, `gcd(12, 8) = 4`, `lcm(2, 4) = 4`',
                inline: false
            },
            {
                name: '📊 Server Counting Stats',
                value:
                    `• **Current Streak:** \`${currentCount}\`\n` +
                    `• **Server Record:** \`${highScore}\`\n` +
                    `• **Next Target:** \`${nextNumber}\``,
                inline: false
            }
        )
        .setColor(0x4F46E5)
        .setFooter({ text: 'Nora Counting System • Type n!help counting for rules & math guide' })
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

        // 2. Blacklisted roles check
        let blacklistedRoles = [];
        try {
            blacklistedRoles = JSON.parse(settings.countingBlacklistedRoles || '[]');
        } catch (e) { }
        if (blacklistedRoles.length > 0) {
            const hasBlacklistedRole = message.member?.roles?.cache?.some(role => blacklistedRoles.includes(role.id));
            if (hasBlacklistedRole) {
                return; // Silently drop
            }
        }

        // 3. Whitelisted roles check
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

        // Check specifically for counting help commands (n!help counting, !help counting, /help counting)
        const contentLower = message.content.toLowerCase().trim();
        if ([
            'n!help counting', '!help counting', '/help counting',
            'n!counting help', '!counting help', 'n!counting rules', '!counting rules'
        ].includes(contentLower)) {
            return sendCountingHelpEmbed(message, guildData);
        }

        // Evaluate expression using sandboxed advanced math engine
        const { evaluateCountingInput } = require('../bot/engines/counter');
        const evalResult = evaluateCountingInput(message.content.trim(), expectedNext);

        if (!evalResult.isValid) {
            // Silently ignore regular chat, greetings, or pure emojis (non-counting content)
            if (evalResult.isNonCounting) {
                return;
            }

            // A wrong count was submitted! Reset count, wipe offender's count, and check fail role
            const previousStreak = guildData.currentCount || 0;
            const highScore = guildData.highScore || 0;
            guildData.totalResets = (guildData.totalResets || 0) + 1;
            guildData.currentCount = 0;
            guildData.lastUserId = null;
            guildData.lastMessageId = null;
            guildData.lastMessageContent = null;
            guildData.recentCountMessages = {};

            // Actually reset the user's individual count!
            guildData.userCounts = guildData.userCounts || {};
            guildData.userCounts[message.author.id] = 0;
            if (guildData.currentTopCounterId === message.author.id) {
                guildData.currentTopCounterId = null;
            }

            // Check and apply fail role immediately (No AI latency)
            const failInfo = await checkAndApplyFailRole(message.guild, message.member, message.author.id, settings, guildData);

            allData[message.guild.id] = guildData;
            queueSave();

            const limitDisplay = settings.countingFailThreshold ? ` / \`${settings.countingFailThreshold}\`` : '';
            await safeReplyOrSend(message, { 
                content: `❌ You broke the count, <@${message.author.id}>! The next number was **${expectedNext}**.\n` +
                    `• **Lost Streak:** \`${previousStreak}\`\n` +
                    `• **Server Record:** \`${highScore}\`\n` +
                    `• **Your Personal Count:** Reset to \`0\`\n` +
                    `• **Fail Count:** \`${failInfo.failCount}\`${limitDisplay}` +
                    failInfo.notice + `\n\n` +
                    `The count has been reset to **0**. Start again at **1**!` 
            });
            return;
        }

        // Rule: No double-counting in a row
        if (guildData.lastUserId === message.author.id) {
            const previousStreak = guildData.currentCount || 0;
            const highScore = guildData.highScore || 0;
            guildData.totalResets = (guildData.totalResets || 0) + 1;
            guildData.currentCount = 0;
            guildData.lastUserId = null;
            guildData.lastMessageId = null;
            guildData.lastMessageContent = null;
            guildData.recentCountMessages = {};

            // Actually reset the user's individual count!
            guildData.userCounts = guildData.userCounts || {};
            guildData.userCounts[message.author.id] = 0;
            if (guildData.currentTopCounterId === message.author.id) {
                guildData.currentTopCounterId = null;
            }

            // Check and apply fail role immediately (No AI latency)
            const failInfo = await checkAndApplyFailRole(message.guild, message.member, message.author.id, settings, guildData);

            allData[message.guild.id] = guildData;
            queueSave();

            const limitDisplay = settings.countingFailThreshold ? ` / \`${settings.countingFailThreshold}\`` : '';
            await safeReplyOrSend(message, { 
                content: `❌ You cannot count twice in a row, <@${message.author.id}>!\n` +
                    `• **Lost Streak:** \`${previousStreak}\`\n` +
                    `• **Server Record:** \`${highScore}\`\n` +
                    `• **Your Personal Count:** Reset to \`0\`\n` +
                    `• **Fail Count:** \`${failInfo.failCount}\`${limitDisplay}` +
                    failInfo.notice + `\n\n` +
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

        // 4. Top Counter Role Reward Assignment
        if (settings?.countingTopCounterRoleId) {
            try {
                const { PermissionFlagsBits } = require('discord.js');
                const me = message.guild.members.me;
                if (me && me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    const topRoleId = String(settings.countingTopCounterRoleId).replace(/[^0-9]/g, '');
                    const roleObj = message.guild.roles.cache.get(topRoleId) || await message.guild.roles.fetch(topRoleId).catch(() => null);

                    if (roleObj && roleObj.position < me.roles.highest.position && !roleObj.managed) {
                        let leaderId = null;
                        let maxCounts = 0;
                        for (const [uId, countVal] of Object.entries(guildData.userCounts)) {
                            if (countVal > maxCounts) {
                                maxCounts = countVal;
                                leaderId = uId;
                            }
                        }

                        const previousLeaderId = guildData.currentTopCounterId || null;

                        if (leaderId && leaderId !== previousLeaderId) {
                            if (previousLeaderId) {
                                const prevMember = await message.guild.members.fetch(previousLeaderId).catch(() => null);
                                if (prevMember && prevMember.roles.cache.has(topRoleId)) {
                                    await prevMember.roles.remove(roleObj, 'Counting: Overtaken by new #1 Top Counter').catch(() => {});
                                }
                            }

                            const newLeaderMember = await message.guild.members.fetch(leaderId).catch(() => null);
                            if (newLeaderMember && !newLeaderMember.roles.cache.has(topRoleId)) {
                                await newLeaderMember.roles.add(roleObj, `Counting: Reached #1 Top Counter with ${maxCounts} counts`).catch(() => {});
                            }

                            guildData.currentTopCounterId = leaderId;

                            await message.channel.send({
                                content: `👑 <@${leaderId}> has taken the lead as the **#1 Top Counter** with **${maxCounts}** counts and earned the <@&${topRoleId}> role! 🎉`,
                                allowedMentions: { users: [leaderId], roles: [] }
                            }).catch(() => {});
                        } else if (leaderId && leaderId === message.author.id && !message.member.roles.cache.has(topRoleId)) {
                            await message.member.roles.add(roleObj, `Counting: Leader role sync (${maxCounts} counts)`).catch(() => {});
                            guildData.currentTopCounterId = leaderId;
                        }
                    }
                }
            } catch (roleErr) {
                console.error('[Counting Top Counter Role Error]:', roleErr.message);
            }
        }

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

        // Milestone Announcement for major accomplishments (Fast, zero AI delay)
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
            // Check if no new numbers or letters were added (allowing markdown formatting like bold, italics, spoiler, etc.)
            const oldAlphaNum = (oldContent.match(/[a-zA-Z0-9]/g) || []).join('');
            const newAlphaNum = (newContent.match(/[a-zA-Z0-9]/g) || []).join('');

            if (oldAlphaNum === newAlphaNum) {
                // Formatting change only! (e.g. bolding **5**, italics *5*, underline __5__, spoiler ||5||)
                // Numbers and letters are identical. Allow the edit without breaking the count!
                if (isRecentCount) {
                    guildData.recentCountMessages[newMessage.id].content = newContent;
                }
                if (isLastCount) {
                    guildData.lastMessageContent = newContent;
                }
                allData[guild.id] = guildData;
                queueSave();
                return;
            }

            // Alphanumeric content was changed, added, or removed — ILLEGAL EDIT!
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

            // Actually reset the user's individual count!
            guildData.userCounts = guildData.userCounts || {};
            guildData.userCounts[author.id] = 0;
            if (guildData.currentTopCounterId === author.id) {
                guildData.currentTopCounterId = null;
            }

            // Check and apply fail role immediately (No AI latency)
            const failInfo = await checkAndApplyFailRole(guild, newMessage.member, author.id, settings, guildData);

            allData[guild.id] = guildData;
            queueSave();

            const limitDisplay = settings.countingFailThreshold ? ` / \`${settings.countingFailThreshold}\`` : '';
            await safeReplyOrSend(newMessage, {
                content: `❌ <@${author.id}>, **you cannot change numbers or letters in the counting channel!**\n` +
                    `*(Formatting edits such as bolding or italics are allowed, but numbers and letters cannot be altered)*\n\n` +
                    `• **Original:** \`${originalDisplay}\`\n` +
                    `• **Edited To:** \`${editedDisplay}\`\n` +
                    `• **Lost Streak:** \`${previousStreak}\`\n` +
                    `• **Server Record:** \`${highScore}\`\n` +
                    `• **Your Personal Count:** Reset to \`0\`\n` +
                    `• **Fail Count:** \`${failInfo.failCount}\`${limitDisplay}` +
                    failInfo.notice + `\n\n` +
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
            const authorId = author ? author.id : (isRecentCount ? isRecentCount.authorId : null);

            guildData.totalResets = (guildData.totalResets || 0) + 1;
            guildData.currentCount = 0;
            guildData.lastUserId = null;
            guildData.lastMessageId = null;
            guildData.lastMessageContent = null;
            guildData.recentCountMessages = {};

            let failNotice = '';
            if (authorId) {
                guildData.userCounts = guildData.userCounts || {};
                guildData.userCounts[authorId] = 0;
                if (guildData.currentTopCounterId === authorId) {
                    guildData.currentTopCounterId = null;
                }
                const failInfo = await checkAndApplyFailRole(message.guild, message.member, authorId, settings, guildData);
                const limitDisplay = settings.countingFailThreshold ? ` / \`${settings.countingFailThreshold}\`` : '';
                failNotice = `\n• **Personal Count:** Reset to \`0\`\n• **Fail Count:** \`${failInfo.failCount}\`${limitDisplay}${failInfo.notice}`;
            }

            allData[message.guild.id] = guildData;
            queueSave();

            await message.channel.send({
                content: `❌ ${authorMention} **deleted their count (${deletedNumber}) in the counting channel!**\n` +
                    `Deleting counts ruins the channel count history.\n` +
                    `• **Lost Streak:** \`${previousStreak}\`\n` +
                    `• **Server Record:** \`${highScore}\`` +
                    failNotice + `\n\n` +
                    `The count has been reset to **0**. Start again at **1**!`
            }).catch(() => {});
        }
    } catch (err) {
        console.error('[Counting] Error in handleCountingMessageDelete:', err);
    }
}
