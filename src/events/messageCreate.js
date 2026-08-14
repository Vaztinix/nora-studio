const { Events, EmbedBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const GlobalSettings = require('../database/models/GlobalSettings');
const NoraLeveling = require('../utils/noraLeveling');
const { formatMessage } = require('../utils/messageFormatter');

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.author || message.author.bot) return;

        // 🛡️ Route Direct Messages cleanly
        if (!message.guild) {
            if (/\bgolden\b/i.test(message.content)) {
                const { checkAndAwardGoldenEgg } = require('../utils/easterEggSystem');
                await checkAndAwardGoldenEgg(message);
            }
            return;
        }

        // Track channel activity in-memory for top channel analytics
        if (!client.channelActivity) {
            client.channelActivity = {};
        }
        const guildChannels = client.channelActivity[message.guild.id] || {};
        guildChannels[message.channel.id] = (guildChannels[message.channel.id] || 0) + 1;
        // 🔢 Prefix Command Listener: n!help / c!help for Counting
        const msgTrimmed = message.content.toLowerCase().trim();
        if (['n!help', 'c!help', 'n!help counting', 'c!help counting', '!help counting', 'n!counting', 'c!counting'].includes(msgTrimmed)) {
            const { sendCountingHelpEmbed } = require('./countingSystem');
            const fs = require('fs').promises;
            const path = require('path');
            try {
                const dataPath = path.join(__dirname, '..', '..', 'countingData.json');
                const rawData = await fs.readFile(dataPath, 'utf8').catch(() => '{}');
                const parsed = JSON.parse(rawData);
                const guildData = parsed[message.guild.id] || { currentCount: 0, lastUserId: null, highScore: 0 };
                return sendCountingHelpEmbed(message, guildData);
            } catch (e) {
                return sendCountingHelpEmbed(message, { currentCount: 0, lastUserId: null, highScore: 0 });
            }
        }

        // 🤫 Secret VC Summon — mommyiloveyou
        if (message.content.trim() === 'mommyiloveyou') {
            const voiceChannel = message.member?.voice?.channel;
            if (!voiceChannel) {
                return message.reply({ content: '❌ You need to be in a voice channel first!', allowedMentions: { repliedUser: false } })
                    .then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
            }
            try {
                // Ensure FFMPEG_PATH is available for audio transcoding
                try {
                    const ffmpegPath = require('ffmpeg-static');
                    if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;
                } catch (_) {}

                const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
                const fs = require('fs');
                const path = require('path');

                if (!message.client.vajjyVC) message.client.vajjyVC = new Map();

                // Clean up any existing connection for this user
                if (message.client.vajjyVC.has(message.author.id)) {
                    const existing = message.client.vajjyVC.get(message.author.id);
                    try { existing.player?.stop(true); } catch (_) {}
                    try { existing.connection?.destroy(); } catch (_) {}
                    message.client.vajjyVC.delete(message.author.id);
                }

                // Pick a random sound from src/assets/sounds/
                const soundsDir = path.join(__dirname, '..', 'assets', 'sounds');
                let soundFiles = [];
                if (fs.existsSync(soundsDir)) {
                    soundFiles = fs.readdirSync(soundsDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.ogg'));
                }

                const chosenFile = soundFiles.length
                    ? path.join(soundsDir, soundFiles[Math.floor(Math.random() * soundFiles.length)])
                    : null;

                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false,
                });

                let player = null;
                if (chosenFile) {
                    player = createAudioPlayer();

                    const playLoop = () => {
                        try {
                            const resource = createAudioResource(chosenFile);
                            player.play(resource);
                        } catch (e) {
                            console.error('[VajjyVC] Resource creation error:', e.message);
                        }
                    };

                    player.on(AudioPlayerStatus.Idle, () => {
                        playLoop();
                    });

                    player.on('error', (err) => {
                        console.error('[VajjyVC] Audio player error:', err.message);
                        setTimeout(playLoop, 1000);
                    });

                    connection.subscribe(player);
                    playLoop();
                }

                message.client.vajjyVC.set(message.author.id, { connection, player, guildId: message.guild.id });
                await message.react('👀').catch(() => {});
                message.delete().catch(() => {});
            } catch (err) {
                console.error('[VajjyVC] Failed to join VC / play sound:', err.message);
            }
            return;
        }

        // 🤖 Autoresponder Hook
        try {
            const Autoresponder = require('../database/models/Autoresponder');
            const responders = await Autoresponder.findAll({ where: { guildId: message.guild.id } });
            const content = message.content.toLowerCase().trim();
            for (const responder of responders) {
                const trigger = responder.trigger.toLowerCase().trim();
                let isMatch = false;
                if (responder.matchType === 'exact' && content === trigger) {
                    isMatch = true;
                } else if (responder.matchType === 'startsWith' && content.startsWith(trigger)) {
                    isMatch = true;
                } else if (responder.matchType === 'contains' && content.includes(trigger)) {
                    isMatch = true;
                }

                if (isMatch) {
                    // 🛡️ Filter checks
                    if (responder.ignoreStaffAndBots && message.member) {
                        if (message.member.permissions.has(PermissionFlagsBits.ManageMessages) || message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                            continue;
                        }
                    }

                    if (responder.ignoredChannels) {
                        try {
                            const chans = JSON.parse(responder.ignoredChannels || '[]');
                            if (chans.includes(message.channel.id)) continue;
                        } catch (e) {}
                    }

                    if (responder.ignoredRoles && message.member) {
                        try {
                            const igRoles = JSON.parse(responder.ignoredRoles || '[]');
                            if (igRoles.some(roleId => message.member.roles.cache.has(roleId))) continue;
                        } catch (e) {}
                    }

                    if (responder.allowedRoles && message.member) {
                        try {
                            const alRoles = JSON.parse(responder.allowedRoles || '[]');
                            if (alRoles.length > 0 && !alRoles.some(roleId => message.member.roles.cache.has(roleId))) continue;
                        } catch (e) {}
                    }
                    const formattedResponse = responder.response
                        .replace(/{user}/g, `<@${message.author.id}>`)
                        .replace(/{username}/g, message.author.username)
                        .replace(/{id}/g, message.author.id)
                        .replace(/{guild}/g, message.guild.name)
                        .replace(/{membercount}/g, message.guild.memberCount);

                    if (responder.isEmbed) {
                        const { EmbedBuilder } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setDescription(formattedResponse)
                            .setColor(message.guild.members.me?.roles.highest.color || 0x4F46E5);
                        await message.reply({ embeds: [embed] }).catch(() => {});
                    } else {
                        await message.reply(formattedResponse).catch(() => {});
                    }
                    return; // Match found, exit processing
                }
            }
        } catch (err) {
            console.error('[Autoresponder Event Error]:', err);
        }

        try {
            // Robust High-Performance Settings Fetch
            let settings = await GuildSettings.findOne({ where: { guildId: message.guild.id } });

            // Forward-only timeline privacy check
            const botJoinTime = settings && settings.installedAt ? new Date(settings.installedAt).getTime() : Date.now();
            const messageTime = new Date(message.createdAt).getTime();
            if (messageTime < botJoinTime) return;

            // If the guild is new, we fallback to Default-OFF
            const levelingEnabled = settings ? settings.levelingEnabled : false;
            if (!levelingEnabled) return;

            // 🛡️ AutoMod Priority: If member is timed out (likely by Discord AutoMod), skip bot-level processing
            if (message.member?.communicationDisabledUntilTimestamp > Date.now()) return;

            // Global Status Check: High-Performance Registry Pass
            const globalSettings = await GlobalSettings.findByPk(1);
            if (globalSettings) {
                const disabledCats = JSON.parse(globalSettings.disabledFeatures || '[]');
                if (disabledCats.includes('leveling')) return;
            }

            // 🛡️ Privacy Telemetry Opt-Out check
            const UserPrefs = require('../database/models/UserPrefs');
            const userPrefs = await UserPrefs.findOne({ where: { userId: message.author.id } });
            if (userPrefs && userPrefs.dashboardSettings) {
                try {
                    const parsedSettings = JSON.parse(userPrefs.dashboardSettings);
                    if (parsedSettings.nora_telemetry_enabled === 'false') {
                        return;
                    }
                } catch (e) {
                    console.error('[Telemetry Opt-Out Check Error]:', e);
                }
            }

            // Get or create XP record retries
            let userLevel = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                userLevel = await NoraLeveling.getOrInitializeUser(message.author.id, message.guild.id);
                if (userLevel) break;
                if (attempt < 3) await new Promise(r => setTimeout(r, 200));
            }
            if (!userLevel) return;

            // Cooldown Monitor (15s Anti-Farming)
            const lastMs = userLevel.lastMessageTimestamp ? new Date(userLevel.lastMessageTimestamp).getTime() : 0;
            const isOffCooldown = NoraLeveling.checkCooldown(lastMs);
            if (!isOffCooldown) return;

            // Check for XP Multipliers (Role-based, Channel-based, Promoter)
            let multiplier = 1.0;
            if (settings?.promoterRoleId && message.member?.roles.cache.has(settings.promoterRoleId)) {
                multiplier = Math.max(multiplier, 1.5);
            }

            if (settings?.xpRoleMultipliers) {
                try {
                    const rawMultipliers = typeof settings.xpRoleMultipliers === 'string' 
                        ? JSON.parse(settings.xpRoleMultipliers || '{}') 
                        : (settings.xpRoleMultipliers || {});
                    
                    for (const [targetId, multVal] of Object.entries(rawMultipliers)) {
                        const parsedMult = parseFloat(multVal);
                        if (isNaN(parsedMult) || parsedMult <= 0) continue;

                        // Check Role match
                        if (message.member?.roles.cache.has(targetId)) {
                            multiplier = Math.max(multiplier, parsedMult);
                        }
                        // Check Channel or Parent Category match
                        if (message.channel.id === targetId || message.channel.parentId === targetId) {
                            multiplier = Math.max(multiplier, parsedMult);
                        }
                    }
                } catch (e) {
                    console.warn('[XP Multiplier Error]:', e.message);
                }
            }

            // Atomic Progress Processor
            const res = await NoraLeveling.addExperience(userLevel, null, multiplier);
            await userLevel.save();

            // 🎭 Dynamic Role Reward Sync
            if (settings && settings.roleRewards) {
                try {
                    const rewards = JSON.parse(settings.roleRewards || '{}');
                    const member = message.member;
                    if (member && message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                        const myHighest = message.guild.members.me.roles.highest.position;
                        const shouldStack = settings.roleRewardsStack !== false; // Default true

                        const sortedMilestones = Object.keys(rewards)
                            .map(n => parseInt(n, 10))
                            .filter(n => !isNaN(n))
                            .sort((a, b) => a - b);

                        const earnedMilestones = sortedMilestones.filter(m => userLevel.level >= m);
                        const highestEarnedLevel = earnedMilestones.length > 0 ? Math.max(...earnedMilestones) : null;

                        for (const milestone of sortedMilestones) {
                            const roleId = rewards[milestone];
                            if (!roleId) continue;
                            const role = message.guild.roles.cache.get(roleId);
                            if (!role || role.position >= myHighest) continue;

                            if (userLevel.level >= milestone) {
                                if (shouldStack || milestone === highestEarnedLevel) {
                                    if (!member.roles.cache.has(roleId)) {
                                        await member.roles.add(role).catch(() => {});
                                    }
                                } else if (!shouldStack && milestone < highestEarnedLevel) {
                                    // Remove lower milestone role if stacking is disabled
                                    if (member.roles.cache.has(roleId)) {
                                        await member.roles.remove(role).catch(() => {});
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { }
            }

            // Level-Up Notification
            if (res.didLevelUp) {
                const level = res.newLevel;
                const notifyChannelId = settings?.levelUpChannelId || message.channel.id;
                const notifyChannel = message.guild.channels.cache.get(notifyChannelId) || message.channel;

                const template = settings?.levelUpMessage;
                const desc = template ? formatMessage(template, message.member || message.author, level) : `<@${message.author.id}> has reached level **${level}**. GG!`;
                const showPfp = settings?.levelingPfpEnabled !== false;

                if (settings?.levelUpNotificationsEnabled !== false) {
                    try {
                        const { generateLevelUpCard } = require('../utils/levelUpGenerator');
                        const imageBuffer = await generateLevelUpCard({
                            oldLevel: level - 1,
                            newLevel: level,
                            avatarUrl: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
                            showPfp: showPfp,
                            bgColor: settings?.levelingCardBgColor || '#111217',
                            accentColor: settings?.levelingCardAccentColor || '#7c3aed',
                            borderColor: settings?.levelingCardBorderColor || '#23252e'
                        });

                        await notifyChannel.send({ content: desc, files: [{ attachment: imageBuffer, name: 'level-up.png' }] }).catch(() => { });
                    } catch (err) {
                        console.error('Error generating level-up card:', err);
                        await notifyChannel.send({ content: desc }).catch(() => { });
                    }
                }

                // Send DM notification if user opted in, or if server default is enabled and user didn't opt out
                const isUserOptedOut = userPrefs && (userPrefs.dmNotificationsEnabled === false || userPrefs.dmNotifLevels === false);
                const isUserOptedIn = userPrefs && userPrefs.dmNotificationsEnabled && userPrefs.dmNotifLevels;
                const shouldSendDm = isUserOptedIn || (settings?.levelUpDmEnabled && !isUserOptedOut);

                if (shouldSendDm) {
                    try {
                        const dmDesc = `🎉 **Congratulations!** You leveled up in **${message.guild.name}**!\n${desc}`;
                        const { generateLevelUpCard } = require('../utils/levelUpGenerator');
                        const imageBuffer = await generateLevelUpCard({
                            oldLevel: level - 1,
                            newLevel: level,
                            avatarUrl: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
                            showPfp: showPfp,
                            bgColor: settings?.levelingCardBgColor || '#111217',
                            accentColor: settings?.levelingCardAccentColor || '#7c3aed',
                            borderColor: settings?.levelingCardBorderColor || '#23252e'
                        }).catch(() => null);

                        const payload = { content: dmDesc };
                        if (imageBuffer) {
                            payload.files = [{ attachment: imageBuffer, name: 'level-up.png' }];
                        }
                        await message.author.send(payload).catch(() => {});
                    } catch (dmErr) {
                        console.error('Failed to send level-up DM:', dmErr.message);
                    }
                }
            }
        } catch (error) {
            console.error('[System Leveling Error] Global Fault:', error.message);
        }
    },
};
