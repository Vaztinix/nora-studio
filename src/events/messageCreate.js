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
