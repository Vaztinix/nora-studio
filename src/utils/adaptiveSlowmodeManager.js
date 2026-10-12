const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const settingsCache = require('./settingsCache');
const { logServerAction } = require('./actionLogger');

class AdaptiveSlowmodeManager {
    constructor() {
        /**
         * Map of channelId -> {
         *   guildId: string,
         *   messages: Array<{ timestamp: number, authorId: string, length: number }>,
         *   currentSlowmode: number,
         *   lastApiUpdate: number,
         *   lastDecayTime: number,
         *   currentTier: string
         * }
         */
        this.channelBuffers = new Map();
        this.decayInterval = null;
    }

    /**
     * Start background decay monitoring
     * @param {import('discord.js').Client} client 
     */
    initDecayInterval(client) {
        if (this.decayInterval) clearInterval(this.decayInterval);
        
        this.decayInterval = setInterval(() => {
            this.processDecay(client).catch(err => {
                console.error('[AdaptiveSlowmode Decay Error]:', err.message);
            });
        }, 5000); // Check every 5 seconds
    }

    /**
     * Process message event for adaptive slowmode calculations
     * @param {import('discord.js').Message} message 
     */
    async recordMessage(message) {
        if (!message.guild || !message.channel || message.author.bot) return;

        const guildId = message.guild.id;
        const channelId = message.channel.id;

        // Fetch settings efficiently from cache
        const settings = await settingsCache.get(guildId);
        if (!settings || settings.adaptiveSlowmodeEnabled !== true) return;

        // Check if channel is text-based and bot has permissions
        if (!message.channel.isTextBased() || typeof message.channel.setRateLimitPerUser !== 'function') return;

        const botMember = message.guild.members.me;
        if (!botMember || !message.channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
            return;
        }

        // Check channel whitelist (if configured)
        let allowedChannels = [];
        if (settings.adaptiveSlowmodeChannels) {
            try {
                allowedChannels = JSON.parse(settings.adaptiveSlowmodeChannels);
            } catch (_) {}
        }
        if (Array.isArray(allowedChannels) && allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
            return; // Channel is not in the monitored list
        }

        // Add message to sliding window (All messages count toward channel velocity even if staff are active)
        const now = Date.now();
        let buffer = this.channelBuffers.get(channelId);
        if (!buffer) {
            buffer = {
                guildId,
                messages: [],
                currentSlowmode: message.channel.rateLimitPerUser || 0,
                lastApiUpdate: 0,
                lastDecayTime: now,
                currentTier: 'INACTIVE',
                aiScore: 0
            };
            this.channelBuffers.set(channelId, buffer);
        }

        // Add message content metadata and prune messages older than 10 seconds
        buffer.messages.push({
            timestamp: now,
            authorId: message.author.id,
            length: message.content?.length || 0,
            content: (message.content || '').slice(0, 100).toLowerCase()
        });
        buffer.messages = buffer.messages.filter(m => now - m.timestamp <= 10000);

        // Calculate velocity and metrics in the 10-second sliding window
        const msgCount = buffer.messages.length;
        const uniqueAuthors = new Set(buffer.messages.map(m => m.authorId)).size;

        // Custom thresholds and tiers (lowest allowed is 0 = Off)
        const inactiveSec = Math.max(0, settings.adaptiveSlowmodeInactiveSec ?? 0);
        const smallSec = Math.max(0, settings.adaptiveSlowmodeSmallSec ?? 3);
        const largeSec = Math.max(0, settings.adaptiveSlowmodeLargeSec ?? 6);
        const surgeSec = Math.max(0, settings.adaptiveSlowmodeSurgeSec ?? 10);

        const smallThresh = settings.adaptiveSlowmodeSmallThreshold ?? 3;
        const largeThresh = settings.adaptiveSlowmodeLargeThreshold ?? 7;
        const surgeThresh = settings.adaptiveSlowmodeSurgeThreshold ?? 13;

        // 🧠 AI Velocity & Threat Analysis: Assess flood patterns, repetition, and swarm speed
        let aiBoostTier = null;
        let aiReason = '';
        if (settings.adaptiveSlowmodeAiEnabled !== false && msgCount >= 3) {
            // Repetition check: count duplicate messages in window
            const contentCounts = {};
            for (const m of buffer.messages) {
                if (m.content) contentCounts[m.content] = (contentCounts[m.content] || 0) + 1;
            }
            const maxRepeated = Math.max(...Object.values(contentCounts), 0);
            const isCopyPasteFlood = maxRepeated >= 3;
            const isSwarmFlood = msgCount >= 6 && uniqueAuthors >= 4;
            const isSingleUserSpam = msgCount >= 5 && uniqueAuthors === 1;

            if (isCopyPasteFlood || (msgCount >= surgeThresh - 3 && isSwarmFlood)) {
                aiBoostTier = 'SURGE';
                aiReason = isCopyPasteFlood ? 'AI Detected Repetitive Flood Attack' : 'AI Detected High-Velocity Swarm Burst';
            } else if (isSingleUserSpam || msgCount >= largeThresh - 2) {
                aiBoostTier = 'LARGE';
                aiReason = isSingleUserSpam ? 'AI Detected Rapid Single-User Flood' : 'AI Detected Velocity Spike';
            }
        }

        let targetSec = inactiveSec;
        let targetTier = 'INACTIVE';

        if (aiBoostTier === 'SURGE' || msgCount >= surgeThresh || (msgCount >= surgeThresh - 2 && uniqueAuthors >= 4)) {
            targetSec = surgeSec;
            targetTier = 'SURGE';
        } else if (aiBoostTier === 'LARGE' || msgCount >= largeThresh || (msgCount >= largeThresh - 2 && uniqueAuthors >= 3)) {
            targetSec = largeSec;
            targetTier = 'LARGE';
        } else if (msgCount >= smallThresh) {
            targetSec = smallSec;
            targetTier = 'SMALL';
        }

        const currentRateLimit = message.channel.rateLimitPerUser || 0;
        buffer.currentSlowmode = currentRateLimit;

        // ESCALATION: If target is higher than current slowmode, escalate immediately with rate limit guard
        if (targetSec > currentRateLimit) {
            const timeSinceLastUpdate = now - buffer.lastApiUpdate;
            const minCooldown = (targetTier === 'SURGE') ? 4000 : 8000;

            if (timeSinceLastUpdate >= minCooldown) {
                await this.applySlowmode(message.channel, targetSec, targetTier, msgCount, uniqueAuthors, settings, false, aiReason);
                buffer.currentSlowmode = targetSec;
                buffer.currentTier = targetTier;
                buffer.lastApiUpdate = now;
            }
        }
    }

    /**
     * Background decay loop to reduce slowmode when chat cools down
     * @param {import('discord.js').Client} client 
     */
    async processDecay(client) {
        const now = Date.now();

        for (const [channelId, buffer] of this.channelBuffers.entries()) {
            const channel = client.channels.cache.get(channelId);
            if (!channel || !channel.isTextBased() || typeof channel.setRateLimitPerUser !== 'function') {
                this.channelBuffers.delete(channelId);
                continue;
            }

            const currentRateLimit = channel.rateLimitPerUser || 0;
            buffer.currentSlowmode = currentRateLimit;

            // If slowmode is already 0 or at inactive floor, clean old messages
            buffer.messages = buffer.messages.filter(m => now - m.timestamp <= 10000);
            if (currentRateLimit === 0 && buffer.messages.length === 0) {
                // Buffer is completely idle, keep memory clean
                continue;
            }

            // Get guild settings
            const settings = await settingsCache.get(buffer.guildId);
            if (!settings || settings.adaptiveSlowmodeEnabled !== true) {
                // If adaptive slowmode was disabled, reset channel to 0 if we altered it
                if (currentRateLimit > 0) {
                    await channel.setRateLimitPerUser(0, 'Adaptive Slowmode Disabled').catch(() => {});
                }
                this.channelBuffers.delete(channelId);
                continue;
            }

            const inactiveSec = settings.adaptiveSlowmodeInactiveSec ?? 0;
            const smallSec = settings.adaptiveSlowmodeSmallSec ?? 3;
            const largeSec = settings.adaptiveSlowmodeLargeSec ?? 6;
            const decayTimeoutMs = (settings.adaptiveSlowmodeDecaySec ?? 20) * 1000;

            if (currentRateLimit > inactiveSec) {
                const newestMsgTime = buffer.messages.length > 0 
                    ? Math.max(...buffer.messages.map(m => m.timestamp)) 
                    : (buffer.lastApiUpdate || now - decayTimeoutMs);
                
                const quietDuration = now - newestMsgTime;

                // Check if channel has been quiet for the configured decay time
                if (quietDuration >= decayTimeoutMs && (now - buffer.lastApiUpdate >= 8000)) {
                    let nextDecaySec = inactiveSec;
                    let nextTier = 'INACTIVE';

                    // Smooth multi-step decay: SURGE -> LARGE -> SMALL -> INACTIVE
                    if (currentRateLimit > largeSec && quietDuration < decayTimeoutMs + 10000) {
                        nextDecaySec = largeSec;
                        nextTier = 'LARGE';
                    } else if (currentRateLimit > smallSec && quietDuration < decayTimeoutMs + 15000) {
                        nextDecaySec = smallSec;
                        nextTier = 'SMALL';
                    }

                    if (nextDecaySec !== currentRateLimit) {
                        await this.applySlowmode(channel, nextDecaySec, nextTier, 0, 0, settings, true);
                        buffer.currentSlowmode = nextDecaySec;
                        buffer.currentTier = nextTier;
                        buffer.lastApiUpdate = now;
                    }
                }
            }
        }
    }

    /**
     * Apply slowmode adjustment to Discord channel and log/notify if configured
     */
    async applySlowmode(channel, seconds, tier, msgCount, uniqueAuthors, settings, isDecay = false, aiReason = '') {
        try {
            const finalSeconds = Math.max(0, seconds);
            const reasonPrefix = aiReason ? `[${aiReason}] ` : '';
            const reason = isDecay 
                ? `Adaptive Slowmode: Chat cooled down -> ${finalSeconds}s (${tier})`
                : `${reasonPrefix}Adaptive Slowmode: Velocity surge (${msgCount} msgs/10s by ${uniqueAuthors} users) -> ${finalSeconds}s (${tier})`;

            await channel.setRateLimitPerUser(finalSeconds, reason);

            // Optional in-channel subtle notification
            if (settings?.adaptiveSlowmodeNotify && !isDecay && seconds > 0) {
                const notifyEmbed = new EmbedBuilder()
                    .setColor(seconds >= (settings.adaptiveSlowmodeLargeSec ?? 6) ? 0xF59E0B : 0x5865F2)
                    .setDescription(`⚡ **Adaptive Slowmode Activated**\nChat velocity increased (${msgCount} msgs/10s). Slowmode temporarily set to **${seconds}s**.`);

                const notice = await channel.send({ embeds: [notifyEmbed] }).catch(() => null);
                if (notice) {
                    setTimeout(() => notice.delete().catch(() => {}), 6000);
                }
            }

            // Optional Mod Log logging
            if (settings?.adaptiveSlowmodeModLog) {
                await logServerAction({
                    guildId: channel.guild.id,
                    userId: channel.client.user.id,
                    username: 'Nora Adaptive Shield',
                    userAvatar: channel.client.user.displayAvatarURL(),
                    action: isDecay ? 'SLOWMODE_DECAY' : 'SLOWMODE_SURGE',
                    details: `Channel #${channel.name} set to ${seconds}s slowmode [Tier: ${tier}]. ${isDecay ? 'Chat cooled down.' : `${msgCount} msgs/10s.`}`
                }).catch(() => {});
            }
        } catch (err) {
            console.error(`[AdaptiveSlowmode] Failed to update rate limit on #${channel.name}:`, err.message);
        }
    }

    /**
     * Get live telemetry and channel status for slash command and dashboard
     * @param {string} channelId 
     * @param {import('discord.js').Guild} guild 
     */
    async getStatus(channelId, guild) {
        const settings = await settingsCache.get(guild.id);
        const buffer = this.channelBuffers.get(channelId);
        const now = Date.now();

        const channel = guild.channels.cache.get(channelId);
        const currentRateLimit = channel?.rateLimitPerUser || 0;

        const activeMsgs = buffer ? buffer.messages.filter(m => now - m.timestamp <= 10000) : [];
        const uniqueAuthors = new Set(activeMsgs.map(m => m.authorId)).size;

        let monitoredChannels = [];
        if (settings?.adaptiveSlowmodeChannels) {
            try {
                monitoredChannels = JSON.parse(settings.adaptiveSlowmodeChannels);
            } catch (_) {}
        }

        let ignoredRoles = [];
        if (settings?.adaptiveSlowmodeIgnoredRoles) {
            try {
                ignoredRoles = JSON.parse(settings.adaptiveSlowmodeIgnoredRoles);
            } catch (_) {}
        }

        return {
            enabled: settings?.adaptiveSlowmodeEnabled || false,
            channelId,
            currentRateLimit,
            recentMessages10s: activeMsgs.length,
            uniqueChatters10s: uniqueAuthors,
            currentTier: buffer?.currentTier || (currentRateLimit > 0 ? 'ACTIVE' : 'INACTIVE'),
            inactiveSec: settings?.adaptiveSlowmodeInactiveSec ?? 0,
            smallSec: settings?.adaptiveSlowmodeSmallSec ?? 3,
            largeSec: settings?.adaptiveSlowmodeLargeSec ?? 6,
            surgeSec: settings?.adaptiveSlowmodeSurgeSec ?? 10,
            smallThreshold: settings?.adaptiveSlowmodeSmallThreshold ?? 3,
            largeThreshold: settings?.adaptiveSlowmodeLargeThreshold ?? 7,
            surgeThreshold: settings?.adaptiveSlowmodeSurgeThreshold ?? 13,
            decaySec: settings?.adaptiveSlowmodeDecaySec ?? 20,
            monitoredChannelCount: monitoredChannels.length,
            isChannelMonitored: monitoredChannels.length === 0 || monitoredChannels.includes(channelId),
            ignoredRoleCount: ignoredRoles.length
        };
    }

    /**
     * Manually reset a channel's slowmode and state
     * @param {import('discord.js').GuildTextBasedChannel} channel 
     */
    async manualReset(channel) {
        if (!channel || typeof channel.setRateLimitPerUser !== 'function') return;
        this.channelBuffers.delete(channel.id);
        await channel.setRateLimitPerUser(0, 'Adaptive Slowmode Manual Reset').catch(() => {});
    }
}

const adaptiveSlowmodeManager = new AdaptiveSlowmodeManager();
module.exports = adaptiveSlowmodeManager;
