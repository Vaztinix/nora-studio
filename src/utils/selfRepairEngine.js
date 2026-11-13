const fs = require('fs');
const path = require('path');
const Discord = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const settingsCache = require('./settingsCache');
const settingsBackupManager = require('./settingsBackupManager');

const REPAIR_LOG_PATH = path.join(__dirname, '../database/backups/self_repair_log.json');
const MAX_REPAIR_EVENTS = 150;

const state = {
    startedAt: new Date().toISOString(),
    lastCheckAt: null,
    totalChecksRun: 0,
    totalIssuesRepaired: 0,
    totalCommunityActionsBlocked: 0,
    totalInteractionsHealed: 0,
    totalDuplicateMessagesSuppressed: 0,
    status: 'HEALTHY',
    events: []
};

// Sliding window trackers for Pre-Community Safety Filters
const modActionWindow = new Map(); // guildId -> [timestamps]
const outboundMsgDedup = new Map(); // `${guildId}:${channelId}` -> { hash, timestamp, countWindowStart, count }
const trippedCircuitBreakers = new Map(); // guildId -> expiresAtMs

function loadPersistedEvents() {
    try {
        if (fs.existsSync(REPAIR_LOG_PATH)) {
            const raw = JSON.parse(fs.readFileSync(REPAIR_LOG_PATH, 'utf8'));
            if (Array.isArray(raw.events)) {
                state.events = raw.events.slice(0, MAX_REPAIR_EVENTS);
            }
            if (typeof raw.totalIssuesRepaired === 'number') state.totalIssuesRepaired = raw.totalIssuesRepaired;
            if (typeof raw.totalCommunityActionsBlocked === 'number') state.totalCommunityActionsBlocked = raw.totalCommunityActionsBlocked;
            if (typeof raw.totalInteractionsHealed === 'number') state.totalInteractionsHealed = raw.totalInteractionsHealed;
        }
    } catch (_) {}
}

function savePersistedEvents() {
    try {
        const dir = path.dirname(REPAIR_LOG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(REPAIR_LOG_PATH, JSON.stringify({
            updatedAt: new Date().toISOString(),
            totalIssuesRepaired: state.totalIssuesRepaired,
            totalCommunityActionsBlocked: state.totalCommunityActionsBlocked,
            totalInteractionsHealed: state.totalInteractionsHealed,
            totalDuplicateMessagesSuppressed: state.totalDuplicateMessagesSuppressed,
            events: state.events.slice(0, MAX_REPAIR_EVENTS)
        }, null, 2), 'utf8');
    } catch (_) {}
}

function recordRepairEvent(type, severity, guildId, summary, details = {}) {
    const entry = {
        id: `sr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        type,
        severity, // 'INFO' | 'HEALED' | 'SHIELD_BLOCK' | 'CRITICAL_REPAIR'
        guildId: guildId ? String(guildId) : 'GLOBAL',
        summary,
        details
    };
    state.events.unshift(entry);
    if (state.events.length > MAX_REPAIR_EVENTS) {
        state.events.length = MAX_REPAIR_EVENTS;
    }
    if (severity === 'SHIELD_BLOCK') {
        state.totalCommunityActionsBlocked++;
    } else if (severity === 'HEALED') {
        state.totalInteractionsHealed++;
    } else {
        state.totalIssuesRepaired++;
    }
    savePersistedEvents();
    console.log(`[Self-Repair Shield] [${severity}] (${entry.guildId}) ${summary}`);
    return entry;
}

/**
 * LAYER 1: Pre-Community Outbound Moderation & Message Safety Shield
 * Intercepts unintended automated kicks, bans, timeouts, and duplicate/looping channel messages BEFORE they reach Discord communities.
 */
function installCommunitySafetyShields() {
    const { GuildMember, BaseGuildTextChannel } = Discord;

    // 1A. Guard GuildMember.prototype.timeout
    if (GuildMember && GuildMember.prototype && !GuildMember.prototype._noraSafetyPatched) {
        GuildMember.prototype._noraSafetyPatched = true;

        const origTimeout = GuildMember.prototype.timeout;
        GuildMember.prototype.timeout = async function(timeoutMs, reason) {
            const guildId = this.guild?.id;
            const reasonStr = String(reason || '');
            if (guildId && timeoutMs && reasonStr.startsWith('Nora ')) {
                const allowed = await verifyAutomatedModerationAction(this.guild, 'TIMEOUT', this.id, reasonStr);
                if (!allowed) return this;
            }
            return origTimeout.call(this, timeoutMs, reason);
        };

        const origKick = GuildMember.prototype.kick;
        GuildMember.prototype.kick = async function(reason) {
            const guildId = this.guild?.id;
            const reasonStr = String(reason || '');
            if (guildId && reasonStr.startsWith('Nora ')) {
                const allowed = await verifyAutomatedModerationAction(this.guild, 'KICK', this.id, reasonStr);
                if (!allowed) return this;
            }
            return origKick.call(this, reason);
        };

        const origBan = GuildMember.prototype.ban;
        GuildMember.prototype.ban = async function(options = {}) {
            const guildId = this.guild?.id;
            const reasonStr = typeof options === 'string' ? options : String(options?.reason || '');
            if (guildId && reasonStr.startsWith('Nora ')) {
                const allowed = await verifyAutomatedModerationAction(this.guild, 'BAN', this.id, reasonStr);
                if (!allowed) return this;
            }
            return origBan.call(this, options);
        };
    }

    // 1B. Guard BaseGuildTextChannel.prototype.send against duplicate spam & runaway loops
    if (BaseGuildTextChannel && BaseGuildTextChannel.prototype && !BaseGuildTextChannel.prototype._noraSendPatched) {
        BaseGuildTextChannel.prototype._noraSendPatched = true;
        const origSend = BaseGuildTextChannel.prototype.send;

        BaseGuildTextChannel.prototype.send = async function(options) {
            try {
                const guildId = this.guild?.id;
                const channelId = this.id;
                if (guildId && channelId && options && typeof options === 'object') {
                    const now = Date.now();
                    const key = `${guildId}:${channelId}`;
                    const sig = computeMessageSignature(options);
                    const prev = outboundMsgDedup.get(key);

                    if (prev) {
                        // Suppress identical automated message sent to the exact same channel within 2.5 seconds
                        if (sig && prev.hash === sig && (now - prev.timestamp) < 2500) {
                            state.totalDuplicateMessagesSuppressed++;
                            recordRepairEvent(
                                'DUPLICATE_SPAM_SUPPRESSED',
                                'SHIELD_BLOCK',
                                guildId,
                                `Suppressed duplicate outbound message in channel #${this.name || channelId} within 2.5s window.`
                            );
                            return null;
                        }

                        // Runaway loop rate limiter: max 12 automated channel sends per 10 seconds in a single channel
                        if (now - prev.countWindowStart < 10000) {
                            prev.count++;
                            if (prev.count > 12) {
                                state.totalCommunityActionsBlocked++;
                                recordRepairEvent(
                                    'CHANNEL_FLOOD_CIRCUIT_BREAKER',
                                    'SHIELD_BLOCK',
                                    guildId,
                                    `Blocked runaway message flood in channel #${this.name || channelId} (${prev.count} msgs / 10s).`
                                );
                                return null;
                            }
                        } else {
                            prev.countWindowStart = now;
                            prev.count = 1;
                        }
                        prev.hash = sig;
                        prev.timestamp = now;
                    } else {
                        outboundMsgDedup.set(key, {
                            hash: sig,
                            timestamp: now,
                            countWindowStart: now,
                            count: 1
                        });
                    }
                }
            } catch (_) {}
            return origSend.call(this, options);
        };
    }
}

function computeMessageSignature(options) {
    try {
        if (typeof options === 'string') return `str:${options.substring(0, 160)}`;
        const content = options.content ? String(options.content).substring(0, 120) : '';
        const embedTitle = options.embeds?.[0]?.data?.title || options.embeds?.[0]?.title || '';
        const embedDesc = (options.embeds?.[0]?.data?.description || options.embeds?.[0]?.description || '').substring(0, 120);
        const v2Text = JSON.stringify(options.components || []).substring(0, 160);
        const hasFiles = Array.isArray(options.files) && options.files.length > 0 ? `files:${options.files.length}` : '';
        if (!content && !embedTitle && !embedDesc && v2Text === '[]' && !hasFiles) return '';
        return `${content}|${embedTitle}|${embedDesc}|${v2Text}|${hasFiles}`;
    } catch (_) {
        return '';
    }
}

async function verifyAutomatedModerationAction(guild, actionType, targetUserId, reasonStr) {
    if (!guild || !guild.id) return true;
    const guildId = String(guild.id);
    const now = Date.now();

    // Check if circuit breaker is tripped for this guild
    const breakerUntil = trippedCircuitBreakers.get(guildId);
    if (breakerUntil && now < breakerUntil) {
        recordRepairEvent(
            'CIRCUIT_BREAKER_ACTIVE',
            'SHIELD_BLOCK',
            guildId,
            `Blocked automated ${actionType} on user ${targetUserId} (${reasonStr}) — Guild circuit breaker active.`
        );
        return false;
    }

    try {
        const settings = await settingsCache.get(guildId);
        if (!settings) return false;

        // 1. Verify AutoMod actions strictly have autoModActive === true
        if (reasonStr.startsWith('Nora AutoMod:')) {
            if (!settings.autoModActive || settings.moderationEnabled === false) {
                recordRepairEvent(
                    'UNAUTHORIZED_AUTOMOD_BLOCKED',
                    'SHIELD_BLOCK',
                    guildId,
                    `Blocked AutoMod ${actionType} on user ${targetUserId} because autoModActive is OFF for ${guild.name}.`
                );
                return false;
            }
        }

        // 2. Verify Anti-Raid actions strictly have antiRaidEnabled === true
        if (reasonStr.includes('Anti-Raid') && !settings.antiRaidEnabled) {
            recordRepairEvent(
                'UNAUTHORIZED_ANTIRAID_BLOCKED',
                'SHIELD_BLOCK',
                guildId,
                `Blocked Anti-Raid ${actionType} on user ${targetUserId} because antiRaidEnabled is OFF for ${guild.name}.`
            );
            return false;
        }

        // 3. Sliding-window Mass-Action Circuit Breaker (max 8 automated actions in 30s unless lockdownMode is explicitly enabled)
        if (!settings.lockdownMode) {
            const list = (modActionWindow.get(guildId) || []).filter(ts => now - ts < 30000);
            list.push(now);
            modActionWindow.set(guildId, list);

            if (list.length > 8) {
                // Trip circuit breaker for 5 minutes to protect community from mass false-positive actions!
                trippedCircuitBreakers.set(guildId, now + 5 * 60 * 1000);
                recordRepairEvent(
                    'MASS_ACTION_CIRCUIT_BREAKER_TRIPPED',
                    'SHIELD_BLOCK',
                    guildId,
                    `Tripped 5-minute safety circuit breaker in ${guild.name}: ${list.length} automated ${actionType} actions attempted in 30s.`
                );
                return false;
            }
        }
    } catch (_) {}

    return true;
}

/**
 * LAYER 2: Global Discord Interaction Self-Healing
 * Ensures slash commands, buttons, and modals never crash or fail due to V2 flags, double-ack, or expired tokens.
 */
function installInteractionSafetyGuards() {
    const { CommandInteraction, MessageComponentInteraction, ModalSubmitInteraction } = Discord;
    const classes = [CommandInteraction, MessageComponentInteraction, ModalSubmitInteraction].filter(Boolean);

    for (const Cls of classes) {
        if (!Cls.prototype || Cls.prototype._noraSelfHealPatched) continue;
        Cls.prototype._noraSelfHealPatched = true;

        const origReply = Cls.prototype.reply;
        if (typeof origReply === 'function') {
            Cls.prototype.reply = async function(options) {
                try {
                    if (this.replied || this.deferred) {
                        return await this.editReply(options);
                    }
                    return await origReply.call(this, options);
                } catch (err) {
                    return await healInteractionError(this, 'reply', origReply, options, err);
                }
            };
        }

        const origEditReply = Cls.prototype.editReply;
        if (typeof origEditReply === 'function') {
            Cls.prototype.editReply = async function(options) {
                try {
                    return await origEditReply.call(this, options);
                } catch (err) {
                    return await healInteractionError(this, 'editReply', origEditReply, options, err);
                }
            };
        }

        const origUpdate = Cls.prototype.update;
        if (typeof origUpdate === 'function') {
            Cls.prototype.update = async function(options) {
                try {
                    return await origUpdate.call(this, options);
                } catch (err) {
                    return await healInteractionError(this, 'update', origUpdate, options, err);
                }
            };
        }
    }
}

async function healInteractionError(interaction, methodName, origFn, options, err) {
    const code = err?.code;
    const msg = String(err?.message || '');

    // 1. Heal DiscordAPIError[50035]: Components V2 + legacy embeds/content collision
    if (code === 50035 && (msg.includes('IS_COMPONENTS_V2') || msg.includes('components') || msg.includes('embeds'))) {
        try {
            const clean = { ...(typeof options === 'object' ? options : { content: String(options || '') }) };
            // Strip V2 flag and send clean classic payload or pure V2 container
            if (clean.flags && (Number(clean.flags) & 32768) !== 0) {
                delete clean.embeds;
                delete clean.content;
            } else {
                const embedsUtil = require('./embeds');
                const converted = embedsUtil.sanitizeComponentsV2Payload(clean, interaction.message);
                recordRepairEvent(
                    'INTERACTION_V2_PAYLOAD_HEALED',
                    'HEALED',
                    interaction.guildId,
                    `Auto-healed 50035 Components V2 payload on ${methodName} (${interaction.commandName || interaction.customId || 'interaction'}).`
                );
                return await origFn.call(interaction, converted);
            }
            recordRepairEvent(
                'INTERACTION_50035_HEALED',
                'HEALED',
                interaction.guildId,
                `Auto-healed 50035 form body on ${methodName} (${interaction.commandName || interaction.customId || 'interaction'}).`
            );
            return await origFn.call(interaction, clean);
        } catch (_) {}
    }

    // 2. Heal InteractionAlreadyReplied (40060)
    if (code === 40060 || code === 'InteractionAlreadyReplied') {
        try {
            recordRepairEvent(
                'INTERACTION_ALREADY_REPLIED_HEALED',
                'HEALED',
                interaction.guildId,
                `Re-routed ${methodName} -> editReply for ${interaction.commandName || interaction.customId || 'interaction'}.`
            );
            return await interaction.editReply(options).catch(() => null);
        } catch (_) {
            return null;
        }
    }

    // 3. Gracefully absorb expired interactions (10062 Unknown Interaction)
    if (code === 10062 || code === 10008) {
        return null;
    }

    throw err;
}

/**
 * LAYER 3 & 4: Autonomous Database, Server Config & Subsystem Self-Repair Cycle
 */
async function runSelfRepairCycle(trigger = 'SCHEDULED', client = null) {
    state.lastCheckAt = new Date().toISOString();
    state.totalChecksRun++;
    let repairsInThisCycle = 0;

    try {
        const allSettings = await GuildSettings.findAll();

        const jsonArrayCols = [
            'allowedInvites',
            'automodAllowedDomains',
            'customBlockedContexts',
            'automodImmuneRoles',
            'automodImmuneChannels',
            'countingWhitelistedRoles',
            'countingBlacklistedUsers',
            'robloxGroupBindings',
            'ticketPanels',
            'starboardRoleRewards',
            'activityVcRules',
            'webhookLogFilters'
        ];

        const jsonObjectCols = [
            'roleRewards',
            'xpRoleMultipliers',
            'customModResponses',
            'loggingChannels',
            'warnEscalationRules'
        ];

        for (const row of allSettings) {
            const updates = {};
            const gid = String(row.guildId);

            // 1. Repair malformed JSON array columns so JSON.parse never crashes commands/dashboard
            for (const col of jsonArrayCols) {
                const val = row[col];
                if (val !== null && val !== undefined && typeof val === 'string' && val.trim() !== '') {
                    const trimmed = val.trim();
                    if (trimmed.startsWith('[')) {
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (!Array.isArray(parsed)) updates[col] = '[]';
                        } catch (_) {
                            updates[col] = '[]';
                        }
                    }
                }
            }

            // 2. Repair malformed JSON object columns
            for (const col of jsonObjectCols) {
                const val = row[col];
                if (val !== null && val !== undefined && typeof val === 'string' && val.trim() !== '') {
                    try {
                        const parsed = JSON.parse(val);
                        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                            updates[col] = '{}';
                        }
                    } catch (_) {
                        updates[col] = '{}';
                    }
                }
            }

            // 3. Repair contradictory role assignments (e.g. welcomeRoleId === unverifiedRoleId)
            if (row.welcomeRoleId && row.unverifiedRoleId && String(row.welcomeRoleId).trim() === String(row.unverifiedRoleId).trim()) {
                updates.welcomeRoleId = null;
                recordRepairEvent(
                    'CONTRADICTORY_ROLE_REPAIRED',
                    'CRITICAL_REPAIR',
                    gid,
                    `Cleared welcomeRoleId (${row.welcomeRoleId}) because it matched unverifiedRoleId on guild ${gid}.`
                );
            }

            // 4. Repair missing Early Adopter Premium on any server
            if (!row.isPremium || !row.isManualPremium) {
                updates.isPremium = true;
                updates.isManualPremium = true;
                recordRepairEvent(
                    'PREMIUM_ENTITLEMENT_RESTORED',
                    'CRITICAL_REPAIR',
                    gid,
                    `Restored Early Adopter Lifetime Premium on guild ${gid}.`
                );
            }

            // 5. Ensure numeric bounds are valid
            if (row.aiRateLimitPerMinute !== null && (isNaN(Number(row.aiRateLimitPerMinute)) || Number(row.aiRateLimitPerMinute) < 1)) {
                updates.aiRateLimitPerMinute = 6;
            }
            if (row.spamThreshold !== null && (isNaN(Number(row.spamThreshold)) || Number(row.spamThreshold) < 2)) {
                updates.spamThreshold = 5;
            }

            if (Object.keys(updates).length > 0) {
                await row.update(updates);
                settingsCache.invalidate(gid);
                repairsInThisCycle += Object.keys(updates).length;
            }
        }

        // 6. Heal Gemini API Key Pool if all keys are stuck in cooldown
        try {
            const geminiKeyManager = require('./geminiKeyManager');
            if (geminiKeyManager && typeof geminiKeyManager.getAvailableKey === 'function') {
                const avail = geminiKeyManager.getAvailableKey();
                if (!avail && geminiKeyManager.cooldowns && geminiKeyManager.cooldowns.size > 0) {
                    geminiKeyManager.cooldowns.clear();
                    repairsInThisCycle++;
                    recordRepairEvent(
                        'AI_KEY_POOL_COOLDOWN_RESET',
                        'CRITICAL_REPAIR',
                        'GLOBAL',
                        'All Gemini API keys were in cooldown; auto-cleared stale cooldown locks to keep Nora AI responsive.'
                    );
                }
            }
        } catch (_) {}

        // 7. If a live Discord client is available, verify every cached guild has a GuildSettings row & backup
        if (client && client.guilds && client.guilds.cache) {
            const existingIds = new Set(allSettings.map(r => String(r.guildId)));
            for (const [guildId] of client.guilds.cache) {
                if (!existingIds.has(String(guildId))) {
                    // Check if a disk backup exists for this guild!
                    const diskBackupPath = path.join(__dirname, `../database/backups/guilds/${guildId}.json`);
                    if (fs.existsSync(diskBackupPath)) {
                        await settingsBackupManager.restoreGuildBackup(guildId, 'disk', {
                            actorName: 'Nora Self-Repair Engine'
                        });
                        repairsInThisCycle++;
                        recordRepairEvent(
                            'MISSING_GUILD_CONFIG_RESTORED_FROM_BACKUP',
                            'CRITICAL_REPAIR',
                            guildId,
                            `Automatically restored missing GuildSettings for ${guildId} from disk backup.`
                        );
                    } else {
                        await GuildSettings.findOrCreate({
                            where: { guildId: String(guildId) },
                            defaults: {
                                guildId: String(guildId),
                                isPremium: true,
                                isManualPremium: true,
                                autoModActive: false,
                                antiRaidEnabled: false,
                                welcomerEnabled: false,
                                levelingEnabled: false
                            }
                        });
                        repairsInThisCycle++;
                    }
                }
            }
        }

        state.status = 'HEALTHY';
        return {
            success: true,
            trigger,
            checkedAt: state.lastCheckAt,
            repairsInThisCycle,
            status: getSelfRepairStatus()
        };
    } catch (err) {
        state.status = 'DEGRADED';
        recordRepairEvent('SELF_REPAIR_CYCLE_ERROR', 'INFO', 'GLOBAL', `Self-repair scan encountered error: ${err.message}`);
        return {
            success: false,
            error: err.message,
            status: getSelfRepairStatus()
        };
    }
}

function getSelfRepairStatus() {
    return {
        status: state.status,
        startedAt: state.startedAt,
        lastCheckAt: state.lastCheckAt,
        totalChecksRun: state.totalChecksRun,
        totalIssuesRepaired: state.totalIssuesRepaired,
        totalCommunityActionsBlocked: state.totalCommunityActionsBlocked,
        totalInteractionsHealed: state.totalInteractionsHealed,
        totalDuplicateMessagesSuppressed: state.totalDuplicateMessagesSuppressed,
        activeCircuitBreakers: Array.from(trippedCircuitBreakers.entries())
            .filter(([, exp]) => exp > Date.now())
            .map(([guildId, expiresAt]) => ({ guildId, expiresAt: new Date(expiresAt).toISOString() })),
        recentEvents: state.events.slice(0, 40)
    };
}

let repairInterval = null;

function initializeSelfRepairSystem(client = null) {
    loadPersistedEvents();
    installCommunitySafetyShields();
    installInteractionSafetyGuards();

    // Run initial repair check on startup
    setTimeout(() => {
        runSelfRepairCycle('STARTUP_BOOT', client).catch(() => {});
    }, 3500);

    // Run continuous self-repair every 5 minutes
    if (!repairInterval) {
        repairInterval = setInterval(() => {
            runSelfRepairCycle('CONTINUOUS_5M_WATCHDOG', client).catch(() => {});
        }, 5 * 60 * 1000);
        if (repairInterval.unref) repairInterval.unref();
    }

    console.log('[Self-Repair Shield] Autonomous Pre-Community Safety Filter & Self-Repair Watchdog online.');
}

module.exports = {
    initializeSelfRepairSystem,
    runSelfRepairCycle,
    getSelfRepairStatus,
    recordRepairEvent,
    verifyAutomatedModerationAction
};

