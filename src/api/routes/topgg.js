const express = require('express');
const router = express.Router();
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const GuildSettings = require('../../database/models/GuildSettings');
const UserPrefs = require('../../database/models/UserPrefs');
const { getDiscordUser } = require('../../utils/security');

module.exports = (client) => {
    /**
     * Top.gg Inbound Webhook Listener
     * Supports both modern Top.gg v2 webhooks and legacy webhook payloads.
     * Top.gg sends verification ping on creation and "vote.created" / "upvote" on votes.
     */
    const TOPGG_WEBHOOK_PATHS = [
        '/webhooks/topgg',
        '/webhooks/topgg/',
        '/webhooks/topgg/:guildId',
        '/api/webhooks/topgg',
        '/api/webhooks/topgg/',
        '/api/webhooks/topgg/:guildId',
        '/api/topgg/webhook',
        '/api/topgg/webhook/',
        '/api/topgg',
        '/api/topgg/'
    ];

    // Handle GET, HEAD, OPTIONS for Top.gg reachability checks
    router.all(TOPGG_WEBHOOK_PATHS, (req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return res.status(200).json({
                status: 'ok',
                service: 'Nora Top.gg Webhook Gateway',
                active: true,
                timestamp: new Date().toISOString()
            });
        }
        next();
    });

    router.post(TOPGG_WEBHOOK_PATHS, async (req, res) => {
        try {
            const authHeader = req.headers.authorization || req.headers.Authorization || req.query.auth || req.headers['x-topgg-signature'];
            const payload = req.body || {};
            
            let voterId = null;
            let voterName = null;
            let targetBotId = null;
            let isWeekend = false;
            let isTest = false;

            // 1. Check Modern Top.gg v1/v2 Webhook Event (type: "vote.create" or "webhook.test")
            if (payload.type === 'vote.create' || payload.type === 'webhook.test' || payload.event === 'vote.create' || payload.event === 'webhook.test') {
                if (payload.type === 'webhook.test' || payload.event === 'webhook.test') isTest = true;
                const d = payload.data || {};
                
                if (d.user) {
                    if (typeof d.user === 'object' && d.user !== null) {
                        voterId = d.user.platform_id || d.user.id;
                        voterName = d.user.name || d.user.username;
                    } else if (typeof d.user === 'string') {
                        voterId = d.user;
                    }
                }
                
                if (d.project) {
                    if (typeof d.project === 'object' && d.project !== null) {
                        targetBotId = d.project.platform_id || d.project.id;
                    } else if (typeof d.project === 'string') {
                        targetBotId = d.project;
                    }
                }
                
                if (d.weight !== undefined) {
                    isWeekend = Number(d.weight) > 1;
                }
            }

            // 2. Check Legacy Top.gg / Standard Flat Format
            if (!voterId) {
                const d = payload.data || payload;
                if (typeof d.user === 'object' && d.user !== null) {
                    voterId = d.user.platform_id || d.user.id;
                    voterName = d.user.name || d.user.username;
                } else if (typeof d.user === 'string') {
                    voterId = d.user;
                } else if (d.userId) {
                    voterId = d.userId;
                } else if (d.voterId) {
                    voterId = d.voterId;
                }

                if (typeof d.bot === 'object' && d.bot !== null) {
                    targetBotId = d.bot.platform_id || d.bot.id;
                } else if (typeof d.bot === 'string') {
                    targetBotId = d.bot;
                } else if (d.botId) {
                    targetBotId = d.botId;
                }

                if (d.isWeekend !== undefined) isWeekend = Boolean(d.isWeekend);
                if (d.type === 'test' || payload.type === 'test' || payload.event === 'test' || payload.event === 'ping') {
                    isTest = true;
                }
            }

            // 3. Handle reachability ping with no voter payload
            if (!voterId) {
                console.log('[Top.gg Webhook Reachability Ping] Successfully verified reachability:', payload);
                return res.status(200).json({
                    success: true,
                    message: 'Top.gg webhook endpoint verified successfully',
                    ping: true,
                    receivedAt: new Date().toISOString()
                });
            }

            targetBotId = targetBotId || client?.user?.id || '1375943730951098549';
            const isNoraBot = (!targetBotId || targetBotId === '1375943730951098549' || targetBotId === '593420060990005248' || targetBotId === client?.user?.id);

            // Find matching guild(s) configured for this bot or specific guild route
            let targetGuilds = [];
            const specificGuildId = req.params.guildId;

            if (specificGuildId) {
                const setting = await GuildSettings.findByPk(specificGuildId);
                if (setting) targetGuilds.push(setting);
            } else {
                // Find all guilds tracking this bot ID, or all guilds with Top.gg configured
                const allSettings = await GuildSettings.findAll();
                targetGuilds = allSettings.filter(s => {
                    // Match bot ID if configured as primary
                    if (targetBotId && s.topggBotId === targetBotId) return true;

                    // Match multi-bots array
                    if (s.topggMultiBots) {
                        try {
                            const mb = typeof s.topggMultiBots === 'string' ? JSON.parse(s.topggMultiBots) : s.topggMultiBots;
                            if (Array.isArray(mb) && mb.some(b => b.id === targetBotId)) return true;
                        } catch (e) { }
                    }

                    // Match secret if provided
                    if (authHeader && s.topggWebhookAuth && s.topggWebhookAuth === authHeader) return true;

                    // Match Nora primary bot if guild has any Top.gg config active
                    if (isNoraBot && (s.topggVoteChannelId || s.topggRewardRoleId || s.topggVerified)) {
                        return true;
                    }

                    return false;
                });

                // Fallback: If no server explicitly configured for this custom bot, check if voter is in any guild where Nora is present
                if (targetGuilds.length === 0 && voterId && client?.guilds?.cache) {
                    for (const [, g] of client.guilds.cache) {
                        const m = g.members?.cache?.get(voterId);
                        if (m) {
                            const s = await GuildSettings.findByPk(g.id);
                            if (s && (s.topggVoteChannelId || s.topggRewardRoleId)) {
                                targetGuilds.push(s);
                                break;
                            }
                        }
                    }
                }

                // If still empty and there are guilds with vote channels, use them
                if (targetGuilds.length === 0) {
                    targetGuilds = allSettings.filter(s => s.topggVoteChannelId);
                }
            }

            if (targetGuilds.length === 0) {
                console.log(`[Top.gg Webhook] Received vote for voter ${voterId} (${voterName || 'N/A'}), bot ${targetBotId || 'default'} (No matching guild configured yet)`);
                return res.status(200).json({ status: 'received_unmatched', voter: voterId, bot: targetBotId });
            }

            let results = [];

            for (const setting of targetGuilds) {
                const guildId = setting.guildId;
                const guild = client?.guilds?.cache?.get(guildId);

                // Calculate Streak & Multiplier
                let voteLogs = [];
                try {
                    voteLogs = typeof setting.topggVoteLogs === 'string' ? JSON.parse(setting.topggVoteLogs || '[]') : (setting.topggVoteLogs || []);
                } catch (e) { voteLogs = []; }

                const userPreviousVotes = voteLogs.filter(v => v.voterId === voterId);
                const lastVote = userPreviousVotes[0];
                let currentStreak = 1;

                if (lastVote && lastVote.timestamp) {
                    const diffHours = (Date.now() - new Date(lastVote.timestamp).getTime()) / (1000 * 60 * 60);
                    if (diffHours <= 36) {
                        currentStreak = (lastVote.streak || 1) + 1;
                    }
                }

                const multiplier = (isWeekend && setting.topggWeekendMultiplier !== false) ? 2 : 1;
                const baseXP = setting.topggRewardXp || 150;
                const earnedXP = baseXP * multiplier + (currentStreak > 1 && setting.topggStreakBonusEnabled ? (currentStreak * 25) : 0);

                let rewardStatus = [];

                // 1. Assign Reward Role in Discord Guild
                if (guild && setting.topggRewardRoleId) {
                    try {
                        const member = await guild.members.fetch(voterId).catch(() => null);
                        if (member && !member.roles.cache.has(setting.topggRewardRoleId)) {
                            await member.roles.add(setting.topggRewardRoleId, 'Top.gg Vote Reward');
                            rewardStatus.push(`Role Assigned (<@&${setting.topggRewardRoleId}>)`);
                        } else if (member) {
                            rewardStatus.push(`Role Retained`);
                        }
                    } catch (roleErr) {
                        console.error(`[Top.gg Role Error in ${guildId}]`, roleErr.message);
                    }
                }

                // 2. Award Leveling XP
                if (earnedXP > 0) {
                    rewardStatus.push(`+${earnedXP} XP`);
                    try {
                        const UserXP = require('../../database/models/UserXP');
                        if (UserXP) {
                            const [userXpRecord] = await UserXP.findOrCreate({
                                where: { userId: voterId, guildId: guildId },
                                defaults: { xp: 0, level: 0 }
                            });
                            userXpRecord.xp = (userXpRecord.xp || 0) + earnedXP;
                            await userXpRecord.save();
                        }
                    } catch (xpErr) {
                        console.error(`[Top.gg XP Error in ${guildId}]`, xpErr.message);
                    }
                }

                // 3. Dispatch Announcement Embed to Channel
                if (setting.topggVoteChannelId && client) {
                    const channel = client.channels?.cache?.get(setting.topggVoteChannelId) || await client.channels?.fetch(setting.topggVoteChannelId).catch(() => null);
                    if (channel && channel.send) {
                        const voterUser = client.users?.cache?.get(voterId) || await client.users?.fetch(voterId).catch(() => null);
                        const voterTag = voterUser ? voterUser.tag : `@User (${voterId})`;
                        const voterAvatar = voterUser ? voterUser.displayAvatarURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png';

                        let desc = isTest
                            ? `Test ping from **Top.gg Developer Portal** received for <@${voterId}>!\nYour Discord vote channel is actively connected and listening.`
                            : (setting.topggVoteMessage
                                ? setting.topggVoteMessage.replace(/{user}/g, `<@${voterId}>`).replace(/{bot}/g, client.user?.username || 'Nora').replace(/{streak}/g, `${currentStreak}`).replace(/{rewards}/g, rewardStatus.join(' • ') || 'Vote Verified')
                                : `Thank you <@${voterId}> for supporting our server on **Top.gg**!`);

                        const embed = new EmbedBuilder()
                            .setTitle(isTest ? '🧪 Top.gg Webhook Test Payload Received!' : '🎉 New Top.gg Upvote Received!')
                            .setURL(`https://top.gg/bot/${targetBotId || client.user?.id || '1375943730951098549'}/vote`)
                            .setColor('#FF3366') // Top.gg Signature Pink
                            .setThumbnail(voterAvatar)
                            .setDescription(desc)
                            .addFields(
                                { name: 'Voter', value: `\`${voterTag}\``, inline: true },
                                { name: 'Streak', value: `🔥 **${currentStreak}** Consecutive`, inline: true },
                                { name: 'Multiplier', value: isWeekend ? '⭐ **2x Weekend Multiplier**' : '⚡ **1x Standard**', inline: true },
                                { name: 'Rewards Granted', value: rewardStatus.join(' • ') || 'Vote Verified', inline: false }
                            )
                            .setFooter({ text: 'Top.gg Official Integration • Nora Studio', iconURL: 'https://discord.do/wp-content/uploads/2023/08/Top.gg_.jpg' })
                            .setTimestamp();

                        await channel.send({ embeds: [embed] }).catch(() => { });
                    }
                }

                // 4. Send Direct Message to Voter (if voter permits DMs)
                try {
                    const voterUser = client.users?.cache?.get(voterId) || await client.users?.fetch(voterId).catch(() => null);
                    if (voterUser) {
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('💖 Thank you for voting on Top.gg!')
                            .setColor('#FF3366')
                            .setDescription(`Your vote for **${guild ? guild.name : 'our bot'}** was received!\n\n**Rewards Earned:** ${rewardStatus.join(' • ')}\n**Current Streak:** 🔥 ${currentStreak} vote(s) in a row!`)
                            .setFooter({ text: 'You can vote again in 12 hours.' })
                            .setTimestamp();
                        await voterUser.send({ embeds: [dmEmbed] }).catch(() => { });
                    }
                } catch (dmErr) { }

                // 5. Append to Persistent Inbound Log
                const voterUser = client.users?.cache?.get(voterId);
                const logEntry = {
                    id: 'vote_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                    voterId,
                    voterTag: voterUser ? voterUser.tag : `@User (${voterId.substring(0, 6)}...)`,
                    voterAvatar: voterUser ? voterUser.displayAvatarURL({ dynamic: true }) : 'https://cdn.discordapp.com/embed/avatars/0.png',
                    targetBotId: targetBotId || client.user?.id || '593420060990005248',
                    isWeekend,
                    multiplier,
                    streak: currentStreak,
                    rewards: rewardStatus.join(', ') || 'Vote Verified',
                    timestamp: new Date().toISOString(),
                    status: 'Processed'
                };

                voteLogs.unshift(logEntry);
                if (voteLogs.length > 100) voteLogs = voteLogs.slice(0, 100);

                setting.topggVoteLogs = JSON.stringify(voteLogs);
                setting.topggVerified = true;
                await setting.save();

                results.push({ guildId, streak: currentStreak, rewards: rewardStatus });
            }

            return res.json({ success: true, processedGuilds: results.length, details: results });
        } catch (e) {
            console.error('[Top.gg Webhook Error]:', e);
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * GET /api/guilds/:guildId/topgg
     * Fetch all Top.gg configuration, connected bots, and vote logs
     */
    router.get('/api/guilds/:guildId/topgg', async (req, res) => {
        try {
            const { guildId } = req.params;
            const settings = await GuildSettings.findByPk(guildId);
            if (!settings) return res.status(404).json({ error: 'Guild not found' });

            let multiBots = [];
            let voteLogs = [];
            try {
                multiBots = typeof settings.topggMultiBots === 'string' ? JSON.parse(settings.topggMultiBots || '[]') : (settings.topggMultiBots || []);
            } catch (e) { multiBots = []; }

            try {
                voteLogs = typeof settings.topggVoteLogs === 'string' ? JSON.parse(settings.topggVoteLogs || '[]') : (settings.topggVoteLogs || []);
            } catch (e) { voteLogs = []; }

            res.json({
                success: true,
                config: {
                    topggVerified: settings.topggVerified || false,
                    topggBotId: settings.topggBotId || client?.user?.id || '593420060990005248',
                    topggWebhookAuth: settings.topggWebhookAuth || 'nora_auth_' + Math.random().toString(36).substring(2, 10),
                    topggVoteChannelId: settings.topggVoteChannelId || null,
                    topggRewardRoleId: settings.topggRewardRoleId || null,
                    topggRewardXp: settings.topggRewardXp || 150,
                    topggWeekendMultiplier: settings.topggWeekendMultiplier !== false,
                    topggStreakBonusEnabled: settings.topggStreakBonusEnabled !== false,
                    topggReminders: settings.topggReminders !== false,
                    topggVoteMessage: settings.topggVoteMessage || 'Thank you {user} for upvoting {bot}! You gained {rewards}.',
                    multiBots,
                    voteLogs
                }
            });
        } catch (e) {
            console.error('[Get Top.gg Config Error]:', e);
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * POST /api/guilds/:guildId/topgg
     * Save Top.gg configuration and multi-bot list
     */
    router.post('/api/guilds/:guildId/topgg', async (req, res) => {
        try {
            const { guildId } = req.params;
            const settings = await GuildSettings.findByPk(guildId);
            if (!settings) return res.status(404).json({ error: 'Guild not found' });

            const {
                topggBotId,
                topggWebhookAuth,
                topggApiToken,
                topggVoteChannelId,
                topggRewardRoleId,
                topggRewardXp,
                topggWeekendMultiplier,
                topggStreakBonusEnabled,
                topggReminders,
                topggVoteMessage,
                multiBots
            } = req.body;

            if (topggBotId !== undefined) settings.topggBotId = topggBotId;
            if (topggWebhookAuth !== undefined) settings.topggWebhookAuth = topggWebhookAuth;
            if (topggApiToken !== undefined) settings.topggApiToken = topggApiToken;
            if (topggVoteChannelId !== undefined) settings.topggVoteChannelId = topggVoteChannelId || null;
            if (topggRewardRoleId !== undefined) settings.topggRewardRoleId = topggRewardRoleId || null;
            if (topggRewardXp !== undefined) settings.topggRewardXp = parseInt(topggRewardXp, 10) || 150;
            if (topggWeekendMultiplier !== undefined) settings.topggWeekendMultiplier = Boolean(topggWeekendMultiplier);
            if (topggStreakBonusEnabled !== undefined) settings.topggStreakBonusEnabled = Boolean(topggStreakBonusEnabled);
            if (topggReminders !== undefined) settings.topggReminders = Boolean(topggReminders);
            if (topggVoteMessage !== undefined) settings.topggVoteMessage = topggVoteMessage;
            if (multiBots !== undefined) settings.topggMultiBots = typeof multiBots === 'object' ? JSON.stringify(multiBots) : multiBots;

            settings.topggVerified = true;
            await settings.save();

            res.json({ success: true, message: 'Top.gg integration settings updated.' });
        } catch (e) {
            console.error('[Save Top.gg Config Error]:', e);
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * POST /api/guilds/:guildId/topgg/test
     * Simulates an official Top.gg webhook payload to test reward delivery and log streaming
     */
    router.post('/api/guilds/:guildId/topgg/test', async (req, res) => {
        try {
            const { guildId } = req.params;
            const settings = await GuildSettings.findByPk(guildId);
            if (!settings) return res.status(404).json({ error: 'Guild not found' });

            const voterId = req.body.voterId || (client?.user?.id || '593420060990005248');
            const voterTag = req.body.voterTag || 'TestVoter#0001';
            const isWeekend = req.body.isWeekend !== undefined ? Boolean(req.body.isWeekend) : true;

            let voteLogs = [];
            try {
                voteLogs = typeof settings.topggVoteLogs === 'string' ? JSON.parse(settings.topggVoteLogs || '[]') : (settings.topggVoteLogs || []);
            } catch (e) { voteLogs = []; }

            const multiplier = (isWeekend && settings.topggWeekendMultiplier !== false) ? 2 : 1;
            const baseXP = settings.topggRewardXp || 150;
            const earnedXP = baseXP * multiplier;

            const testEntry = {
                id: 'test_' + Date.now(),
                voterId: voterId,
                voterTag: voterTag,
                voterAvatar: 'https://vaztinix.dev/nora.png',
                targetBotId: settings.topggBotId || '593420060990005248',
                isWeekend: isWeekend,
                multiplier: multiplier,
                streak: 1,
                rewards: `+${earnedXP} XP${settings.topggRewardRoleId ? ', Role Assigned' : ''}`,
                timestamp: new Date().toISOString(),
                status: 'Simulated Test ✔'
            };

            voteLogs.unshift(testEntry);
            if (voteLogs.length > 100) voteLogs = voteLogs.slice(0, 100);

            settings.topggVoteLogs = JSON.stringify(voteLogs);
            settings.topggVerified = true;
            await settings.save();

            // Broadcast test embed if channel is set
            if (settings.topggVoteChannelId && client) {
                const channel = client.channels?.cache?.get(settings.topggVoteChannelId) || await client.channels?.fetch(settings.topggVoteChannelId).catch(() => null);
                if (channel && channel.send) {
                    const testEmbed = new EmbedBuilder()
                        .setTitle('🧪 Top.gg Webhook Test Payload Received!')
                        .setColor('#38BDF8')
                        .setDescription(`Test simulation fired from **Nora Studio** for **${voterTag}**.\nWebhook pipeline is operational and listening for live upvotes!`)
                        .addFields(
                            { name: 'Simulated Voter', value: `\`${voterTag}\``, inline: true },
                            { name: 'Multiplier Mode', value: isWeekend ? '⭐ 2x Weekend Active' : '1x Standard', inline: true },
                            { name: 'Calculated Rewards', value: `+${earnedXP} XP`, inline: true }
                        )
                        .setFooter({ text: 'Top.gg Webhook Simulator • Nora Studio', iconURL: 'https://vaztinix.dev/nora.png' })
                        .setTimestamp();
                    await channel.send({ embeds: [testEmbed] }).catch(() => { });
                }
            }

            res.json({ success: true, log: testEntry });
        } catch (e) {
            console.error('[Top.gg Test Webhook Error]:', e);
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * POST /api/guilds/:guildId/topgg/validate-token
     * Validates a Top.gg Bot Token by querying the Top.gg v2 API
     */
    router.post('/api/guilds/:guildId/topgg/validate-token', async (req, res) => {
        try {
            const { token, botId } = req.body;
            if (!token) return res.status(400).json({ valid: false, error: 'Token is required' });

            const targetBot = botId || '593420060990005248';
            const response = await axios.get(`https://top.gg/api/bots/${targetBot}/stats`, {
                headers: { Authorization: token },
                timeout: 5000
            }).catch(err => {
                return err.response ? err.response : { status: 500, data: { error: err.message } };
            });

            if (response.status === 200) {
                return res.json({ valid: true, data: response.data });
            } else if (response.status === 401 || response.status === 403) {
                return res.json({ valid: false, error: 'Invalid or unauthorized Top.gg API Token.' });
            } else {
                return res.json({ valid: false, error: `Top.gg returned status ${response.status}` });
            }
        } catch (e) {
            res.status(500).json({ valid: false, error: e.message });
        }
    });

    return router;
};
