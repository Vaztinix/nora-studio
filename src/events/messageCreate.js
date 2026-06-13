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
        client.channelActivity[message.guild.id] = guildChannels;

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

            // Check for Promoter Bonus
            let multiplier = 1.0;
            if (settings?.promoterRoleId && message.member.roles.cache.has(settings.promoterRoleId)) {
                multiplier = 1.5;
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
                        for (const [milestone, roleId] of Object.entries(rewards)) {
                            if (userLevel.level >= parseInt(milestone)) {
                                if (!member.roles.cache.has(roleId)) {
                                    const role = message.guild.roles.cache.get(roleId);
                                    if (role && role.position < myHighest) {
                                        await member.roles.add(role).catch(() => { });
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

                if (settings?.levelUpNotificationsEnabled !== false) {
                    const template = settings?.levelUpMessage;
                    const desc = template ? formatMessage(template, message.member || message.author, level) : `<@${message.author.id}> has reached level **${level}**. GG!`;

                    const showPfp = settings?.levelingPfpEnabled !== false;

                    try {
                        const { generateLevelUpCard } = require('../utils/levelUpGenerator');
                        const imageBuffer = await generateLevelUpCard({
                            oldLevel: level - 1,
                            newLevel: level,
                            avatarUrl: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
                            showPfp: showPfp
                        });

                        const attachment = new AttachmentBuilder(imageBuffer, { name: 'level-up.png' });
                        await notifyChannel.send({ content: desc, files: [attachment] }).catch(() => { });
                    } catch (err) {
                        console.error('Error generating level-up card:', err);
                        await notifyChannel.send({ content: desc }).catch(() => { });
                    }
                }
            }
        } catch (error) {
            console.error('[System Leveling Error] Global Fault:', error.message);
        }
    },
};
