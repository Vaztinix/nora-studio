const { EmbedBuilder } = require('discord.js');
const { handleError, handleSuccess } = require('./embeds');
const Case = require('../database/models/Case');

// Active operations map: guildId -> Operation Object
const activeGuildOperations = new Map();

// Recent operations history: guildId -> Array of last 5 operations
const operationsHistory = new Map();

/**
 * Creates an ASCII progress bar.
 */
function createProgressBar(current, total, barLength = 16) {
    if (total <= 0) return '░'.repeat(barLength);
    const percentage = Math.min(Math.max(current / total, 0), 1);
    const filledCount = Math.round(percentage * barLength);
    const emptyCount = barLength - filledCount;
    return '█'.repeat(filledCount) + '░'.repeat(emptyCount);
}

/**
 * Robustly fetches all members in a guild with automated retry on Opcode 8 Gateway rate limits.
 */
async function fetchAllGuildMembers(guild, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const members = await guild.members.fetch({ time: 30000 });
            if (members && members.size > 0) return members;
        } catch (err) {
            console.warn(`[Bulk Role Fetch] Attempt ${attempt}/${maxRetries} hit: ${err.message}`);
            if (attempt < maxRetries) {
                const waitTime = (err.data && typeof err.data.retry_after === 'number')
                    ? Math.ceil(err.data.retry_after * 1000) + 600
                    : 2000;
                await new Promise(r => setTimeout(r, waitTime));
            }
        }
    }
    // Fallback to current memory cache
    if (guild.members.cache && guild.members.cache.size > 0) {
        console.log(`[Bulk Role Fetch] Using cached guild members (${guild.members.cache.size}).`);
        return guild.members.cache;
    }
    return null;
}

/**
 * Performs a single role operation with automated retry for 429s and transient errors.
 */
async function performRoleOperationWithRetry(member, role, isAdd, auditReason, maxRetries = 5) {
    let attempts = 0;
    while (attempts < maxRetries) {
        attempts++;
        try {
            if (isAdd) {
                await member.roles.add(role, auditReason);
            } else {
                await member.roles.remove(role, auditReason);
            }
            return { success: true, retries: attempts - 1 };
        } catch (err) {
            // Check if error is due to Discord Rate Limit (429)
            const isRateLimit = err.status === 429 || 
                                err.code === 429 || 
                                err.rawError?.code === 429 || 
                                (err.message && err.message.toLowerCase().includes('rate limit')) ||
                                (err.message && err.message.includes('429'));

            if (isRateLimit) {
                let waitMs = 5000;
                if (typeof err.retryAfter === 'number' && err.retryAfter > 0) {
                    waitMs = err.retryAfter;
                } else if (err.rawError?.retry_after) {
                    waitMs = Math.ceil(err.rawError.retry_after * 1000);
                }
                
                console.warn(`[Bulk Role Rate Limit] Hit 429 on ${member.user.tag}. Pausing for ${waitMs + 350}ms before retry ${attempts}/${maxRetries}...`);
                await new Promise(r => setTimeout(r, waitMs + 350));
                continue;
            }

            // Missing permissions or hierarchy cannot be resolved by retrying
            if (err.code === 50013 || err.code === 50028) {
                return { success: false, error: err.message, fatal: true };
            }

            // Transient network error
            if (attempts < maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * attempts));
                continue;
            }

            return { success: false, error: err.message };
        }
    }
    return { success: false, error: 'Max retries exceeded.' };
}

/**
 * Robustly parses a date/time or duration filter string.
 * Supports:
 * - Relative durations: "7d", "7d ago", "24h", "2w", "30 days ago", "1 month"
 * - Calendar dates: "YYYY-MM-DD", "YYYY-MM-DD HH:mm", "MM/DD/YYYY", "Month Day, Year"
 * - Keywords: "today", "yesterday"
 * - Timestamps: "<t:1724600000>", "1724600000" (seconds), "1724600000000" (ms)
 */
function parseFilterDate(input, mode = 'before') {
    if (!input || typeof input !== 'string') return null;
    const str = input.trim();
    if (!str) return null;

    const now = Date.now();

    // 1. Check for Discord timestamp format: <t:1724600000:R> or <t:1724600000>
    const discordMatch = str.match(/^<t:(\d+)(?::[a-zA-Z])?>$/);
    if (discordMatch) {
        const sec = parseInt(discordMatch[1], 10);
        const ms = sec * 1000;
        return {
            timestamp: ms,
            formatted: `<t:${sec}:f> (<t:${sec}:R>)`,
            raw: str
        };
    }

    // 2. Check for raw unix timestamp (10 digits = seconds, 13 digits = ms)
    if (/^\d{10}$/.test(str)) {
        const sec = parseInt(str, 10);
        return {
            timestamp: sec * 1000,
            formatted: `<t:${sec}:f> (<t:${sec}:R>)`,
            raw: str
        };
    }
    if (/^\d{13}$/.test(str)) {
        const ms = parseInt(str, 10);
        const sec = Math.floor(ms / 1000);
        return {
            timestamp: ms,
            formatted: `<t:${sec}:f> (<t:${sec}:R>)`,
            raw: str
        };
    }

    // 3. Natural keywords: "today", "yesterday"
    if (str.toLowerCase() === 'today') {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const ms = startOfDay.getTime();
        const sec = Math.floor(ms / 1000);
        return {
            timestamp: ms,
            formatted: `Today (<t:${sec}:f>)`,
            raw: str
        };
    }
    if (str.toLowerCase() === 'yesterday') {
        const startOfYesterday = new Date();
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        startOfYesterday.setHours(0, 0, 0, 0);
        const ms = startOfYesterday.getTime();
        const sec = Math.floor(ms / 1000);
        return {
            timestamp: ms,
            formatted: `Yesterday (<t:${sec}:f>)`,
            raw: str
        };
    }

    // 4. Relative duration string: e.g. "7d", "7d ago", "2 weeks", "30 days ago", "24h", "1 month"
    const relRegex = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mon|mons|month|months|y|yr|yrs|year|years)?\s*(ago|old)?$/i;
    const relMatch = str.match(relRegex);

    if (relMatch) {
        const value = parseFloat(relMatch[1]);
        const unit = (relMatch[2] || 'd').toLowerCase();
        let multiplier = 24 * 60 * 60 * 1000; // default days

        if (unit.startsWith('s')) multiplier = 1000;
        else if (unit.startsWith('m') && !unit.startsWith('mo')) multiplier = 60 * 1000;
        else if (unit.startsWith('h')) multiplier = 60 * 60 * 1000;
        else if (unit.startsWith('d')) multiplier = 24 * 60 * 60 * 1000;
        else if (unit.startsWith('w')) multiplier = 7 * 24 * 60 * 60 * 1000;
        else if (unit.startsWith('mo')) multiplier = 30 * 24 * 60 * 60 * 1000;
        else if (unit.startsWith('y')) multiplier = 365 * 24 * 60 * 60 * 1000;

        const durationMs = Math.round(value * multiplier);
        const targetTimestamp = now - durationMs;
        const targetSec = Math.floor(targetTimestamp / 1000);

        if (mode === 'after') {
            return {
                timestamp: targetTimestamp,
                formatted: `Within last ${str.replace(/ago|old/gi, '').trim()} (<t:${targetSec}:R>)`,
                raw: str,
                isRelative: true,
                durationMs
            };
        } else {
            return {
                timestamp: targetTimestamp,
                formatted: `Older than ${str.replace(/ago|old/gi, '').trim()} ago (<t:${targetSec}:R>)`,
                raw: str,
                isRelative: true,
                durationMs
            };
        }
    }

    // 5. Absolute Date parse: "2024-05-01", "2024-05-01 14:30", "05/01/2024", "May 1 2024"
    const parsedDate = new Date(str);
    if (!isNaN(parsedDate.getTime())) {
        const ms = parsedDate.getTime();
        const sec = Math.floor(ms / 1000);
        return {
            timestamp: ms,
            formatted: `<t:${sec}:f> (<t:${sec}:R>)`,
            raw: str,
            isRelative: false
        };
    }

    return null;
}

/**
 * Main engine to process bulk role additions / removals.
 */
async function processBulkRole({
    interaction,
    isAdd,
    role,
    filter,
    filterRole,
    joinedBeforeStr,
    joinedAfterStr,
    createdBeforeStr,
    createdAfterStr,
    customReason
}) {
    const guildId = interaction.guild.id;

    // Prevent duplicate concurrent runs on the same guild
    if (activeGuildOperations.has(guildId)) {
        const currentOp = activeGuildOperations.get(guildId);
        return handleError(
            interaction,
            'Operation Already In Progress',
            `Another bulk role task (**${currentOp.isAdd ? 'Bulk Add' : 'Bulk Remove'}** for \`${currentOp.roleName}\`) is currently executing in this server.\n\nUse \`/bulkrole view\` or \`/operations view\` to monitor progress, or \`/bulkrole cancel\` to terminate it.`
        );
    }

    // 1. Hierarchy checks for executor
    if (interaction.member.roles.highest.position <= role.position && interaction.guild.ownerId !== interaction.user.id) {
        return handleError(interaction, 'Hierarchy Error', `You cannot manage the role ${role} because it is equal to or higher than your own highest role.`);
    }

    // 2. Hierarchy checks for bot
    const botHighest = interaction.guild.members.me.roles.highest.position;
    if (botHighest <= role.position) {
        return handleError(interaction, 'Bot Hierarchy Error', `I cannot manage the role ${role} because it is equal to or higher than my own highest role.`);
    }

    // 3. Validation for specific role filters
    if ((filter === 'has_role' || filter === 'lacks_role') && !filterRole) {
        return handleError(
            interaction, 
            'Missing Filter Role', 
            `You selected **${filter === 'has_role' ? 'Members With a Specific Role' : 'Members Without a Specific Role'}**, but did not provide the \`filter_role\` option.\n\n*Example:* To give everyone without Verified an unverified role, set \`filter: Members Without a Specific Role\` and \`filter_role: @Verified\`.`
        );
    }

    // 4. Validate and parse Date/Time filters if provided
    const joinedBefore = joinedBeforeStr ? parseFilterDate(joinedBeforeStr, 'before') : null;
    if (joinedBeforeStr && !joinedBefore) {
        return handleError(
            interaction,
            'Invalid Date/Time Filter',
            `Could not parse \`joined_before\`: **"${joinedBeforeStr}"**\n\n**Supported Formats:**\n• Relative: \`7d\`, \`24h\`, \`30 days ago\`, \`2w\`\n• Calendar: \`YYYY-MM-DD\` (e.g. \`2024-05-01\`), \`YYYY-MM-DD HH:mm\`\n• Keywords: \`today\`, \`yesterday\`\n• Timestamps: \`<t:1714521600>\` or \`1714521600\``
        );
    }

    const joinedAfter = joinedAfterStr ? parseFilterDate(joinedAfterStr, 'after') : null;
    if (joinedAfterStr && !joinedAfter) {
        return handleError(
            interaction,
            'Invalid Date/Time Filter',
            `Could not parse \`joined_after\`: **"${joinedAfterStr}"**\n\n**Supported Formats:**\n• Relative: \`7d\`, \`24h\`, \`30 days ago\`, \`2w\`\n• Calendar: \`YYYY-MM-DD\` (e.g. \`2024-05-01\`), \`YYYY-MM-DD HH:mm\`\n• Keywords: \`today\`, \`yesterday\`\n• Timestamps: \`<t:1714521600>\` or \`1714521600\``
        );
    }

    const createdBefore = createdBeforeStr ? parseFilterDate(createdBeforeStr, 'before') : null;
    if (createdBeforeStr && !createdBefore) {
        return handleError(
            interaction,
            'Invalid Date/Time Filter',
            `Could not parse \`created_before\`: **"${createdBeforeStr}"**\n\n**Supported Formats:**\n• Relative: \`30d\`, \`1y\`, \`2 weeks ago\`\n• Calendar: \`YYYY-MM-DD\` (e.g. \`2024-01-01\`)\n• Timestamps: \`<t:1714521600>\``
        );
    }

    const createdAfter = createdAfterStr ? parseFilterDate(createdAfterStr, 'after') : null;
    if (createdAfterStr && !createdAfter) {
        return handleError(
            interaction,
            'Invalid Date/Time Filter',
            `Could not parse \`created_after\`: **"${createdAfterStr}"**\n\n**Supported Formats:**\n• Relative: \`7d\`, \`24h\`, \`30 days\`\n• Calendar: \`YYYY-MM-DD\` (e.g. \`2024-01-01\`)\n• Timestamps: \`<t:1714521600>\``
        );
    }

    // Build human-friendly filter label
    const filterLabels = [];
    if (filter === 'humans') filterLabels.push('Humans Only');
    else if (filter === 'bots') filterLabels.push('Bots Only');
    else if (filter === 'has_role') filterLabels.push(`With ${filterRole.name}`);
    else if (filter === 'lacks_role') filterLabels.push(`Without ${filterRole.name}`);
    else filterLabels.push('All Members');

    if (joinedAfter) filterLabels.push(`Joined After: ${joinedAfter.formatted}`);
    if (joinedBefore) filterLabels.push(`Joined Before: ${joinedBefore.formatted}`);
    if (createdAfter) filterLabels.push(`Account After: ${createdAfter.formatted}`);
    if (createdBefore) filterLabels.push(`Account Before: ${createdBefore.formatted}`);

    const filterLabel = filterLabels.join(' • ');

    // Initial status embed
    await interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setTitle('⏳ Fetching Guild Members...')
                .setDescription(`Scanning server members matching filter:\n**\`${filterLabel}\`**\nto prepare bulk ${isAdd ? 'assignment' : 'removal'} for ${role}...`)
                .setColor(0x3498DB)
        ]
    }).catch(() => {});

    // Fetch full member list with automated retry
    const allMembers = await fetchAllGuildMembers(interaction.guild);

    if (!allMembers || allMembers.size === 0) {
        return handleError(interaction, 'Fetch Error', 'Failed to retrieve server members from Discord. Please try again in a few seconds.');
    }

    // Filter eligible target members
    const targets = [];
    for (const [id, member] of allMembers) {
        // Owner immunity for non-owners
        if (id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            continue;
        }

        // Bot hierarchy check: bot cannot manage users with higher/equal role
        if (botHighest <= member.roles.highest.position) {
            continue;
        }

        // Check if member already has/lacks the target role
        const hasTargetRole = member.roles.cache.has(role.id);
        if (isAdd && hasTargetRole) continue;
        if (!isAdd && !hasTargetRole) continue;

        // Apply member type & role filter criteria
        if (filter === 'humans' && member.user.bot) continue;
        if (filter === 'bots' && !member.user.bot) continue;
        if (filter === 'has_role' && filterRole && !member.roles.cache.has(filterRole.id)) continue;
        if (filter === 'lacks_role' && filterRole && member.roles.cache.has(filterRole.id)) continue;

        // Apply date/time filters
        if (joinedBefore && (!member.joinedTimestamp || member.joinedTimestamp >= joinedBefore.timestamp)) continue;
        if (joinedAfter && (!member.joinedTimestamp || member.joinedTimestamp <= joinedAfter.timestamp)) continue;
        if (createdBefore && (!member.user.createdTimestamp || member.user.createdTimestamp >= createdBefore.timestamp)) continue;
        if (createdAfter && (!member.user.createdTimestamp || member.user.createdTimestamp <= createdAfter.timestamp)) continue;

        targets.push(member);
    }

    if (targets.length === 0) {
        return handleError(
            interaction,
            'No Eligible Members',
            `Found **0** members matching the filter criteria:\n**\`${filterLabel}\`**\nthat require ${role} ${isAdd ? 'added' : 'removed'}.`
        );
    }

    const auditReason = customReason || `Bulk ${isAdd ? 'Add' : 'Remove'} by ${interaction.user.tag} (${filterLabel})`;
    const totalTargets = targets.length;

    // Create Operation State
    const opState = {
        id: `op_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        guildId,
        guildName: interaction.guild.name,
        isAdd,
        roleId: role.id,
        roleName: role.name,
        roleMention: `${role}`,
        filterLabel,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        startTime: Date.now(),
        totalTargets,
        completed: 0,
        successCount: 0,
        failedCount: 0,
        rateLimitsEncountered: 0,
        isCancelled: false,
        cancelledBy: null,
        cancelledAt: null,
        status: 'running'
    };

    activeGuildOperations.set(guildId, opState);

    let lastProgressUpdate = Date.now();

    // Helper to send progress updates safely
    const updateProgressEmbed = async (completed) => {
        opState.completed = completed;
        const percent = Math.round((completed / totalTargets) * 100);
        const bar = createProgressBar(completed, totalTargets);
        const elapsedSecs = Math.max(Math.round((Date.now() - opState.startTime) / 1000), 1);
        const avgPerSec = completed / elapsedSecs;
        const remainingSecs = avgPerSec > 0 ? Math.max(Math.round((totalTargets - completed) / avgPerSec), 0) : 0;

        const progressEmbed = new EmbedBuilder()
            .setTitle(`⚙️ Bulk Role ${isAdd ? 'Assignment' : 'Revocation'} in Progress...`)
            .setDescription(`Target: ${role}\n**Filter**: \`${filterLabel}\`\n\n\`${bar}\` **${percent}%** (${completed}/${totalTargets})\n\n` +
                `✅ **Completed**: ${opState.successCount}\n` +
                `⚠️ **Failed**: ${opState.failedCount}\n` +
                `⏱️ **Elapsed**: ${elapsedSecs}s | **Est. Remaining**: ${remainingSecs}s\n\n` +
                `*💡 Run \`/bulkrole cancel\` to stop this operation at any time.*`)
            .setColor(0xF1C40F)
            .setFooter({ text: `Op ID: ${opState.id} • Nora Rate-Limit Protected` });

        await interaction.editReply({ embeds: [progressEmbed] }).catch(() => {});
    };

    try {
        // Send initial active progress
        await updateProgressEmbed(0);

        // Process all targets sequentially with gentle spacing to avoid aggressive rate limits
        for (let i = 0; i < targets.length; i++) {
            // Check if cancelled
            if (opState.isCancelled) {
                opState.status = 'cancelled';
                break;
            }

            const member = targets[i];
            const res = await performRoleOperationWithRetry(member, role, isAdd, auditReason);

            if (res.success) {
                opState.successCount++;
                if (res.retries > 0) opState.rateLimitsEncountered += res.retries;
            } else {
                opState.failedCount++;
            }

            opState.completed = i + 1;

            // Live progress update every 3 seconds or on final member
            const isFinal = (i === targets.length - 1);
            if (isFinal || (Date.now() - lastProgressUpdate > 3000)) {
                lastProgressUpdate = Date.now();
                await updateProgressEmbed(i + 1);
            }

            // Base pacing delay between member updates (250ms spacing prevents burst 429s)
            if (!isFinal && !opState.isCancelled) {
                await new Promise(r => setTimeout(r, 250));
            }
        }

        const totalElapsedSecs = Math.max(Math.round((Date.now() - opState.startTime) / 1000), 1);
        if (!opState.isCancelled) {
            opState.status = 'completed';
        }

        // Save to operations history
        if (!operationsHistory.has(guildId)) operationsHistory.set(guildId, []);
        const historyList = operationsHistory.get(guildId);
        historyList.unshift({ ...opState, durationSecs: totalElapsedSecs });
        if (historyList.length > 5) historyList.pop();

        // Create Case record
        try {
            await Case.create({
                guildId: interaction.guild.id,
                userId: interaction.user.id,
                moderatorId: interaction.user.id,
                type: isAdd ? 'ROLE_ADD' : 'ROLE_REMOVE',
                reason: `[Bulk ${isAdd ? 'Add' : 'Remove'}${opState.isCancelled ? ' - CANCELLED' : ''}] ${role.name} (${filterLabel}) - ${opState.successCount}/${totalTargets} updated in ${totalElapsedSecs}s. ${customReason || ''}`,
                status: 'active'
            });
        } catch (e) {}

        // Build final completion / cancellation embed
        const finalEmbed = new EmbedBuilder()
            .setTitle(opState.isCancelled ? `🛑 Bulk Role ${isAdd ? 'Addition' : 'Removal'} Cancelled` : `✅ Bulk Role ${isAdd ? 'Addition' : 'Removal'} Complete!`)
            .setColor(opState.isCancelled ? 0xE67E22 : (isAdd ? 0x2ECC71 : 0xE74C3C))
            .addFields(
                { name: '🎯 Target Role', value: `${role} (\`${role.id}\`)`, inline: true },
                { name: '⚡ Action', value: isAdd ? '➕ Bulk Role Add' : '➖ Bulk Role Remove', inline: true },
                { name: '🔍 Filter Applied', value: `\`${filterLabel}\``, inline: true },
                { name: opState.isCancelled ? '⏸️ Modified Before Cancel' : '✅ Successfully Updated', value: `**${opState.successCount}** / ${totalTargets} members`, inline: true },
                { name: '⚠️ Failed / Skipped', value: `**${opState.failedCount}** members`, inline: true },
                { name: '⏱️ Total Elapsed Time', value: `\`${totalElapsedSecs}s\` ${opState.rateLimitsEncountered > 0 ? `(${opState.rateLimitsEncountered} rate limits handled)` : ''}`, inline: true }
            )
            .setFooter({ text: `Op ID: ${opState.id} • Status: ${opState.status.toUpperCase()}` })
            .setTimestamp();

        if (opState.isCancelled) {
            finalEmbed.addFields({
                name: '🛑 Cancelled By',
                value: opState.cancelledBy ? `<@${opState.cancelledBy}>` : 'Moderator Command',
                inline: false
            });
        }

        if (customReason) {
            finalEmbed.addFields({ name: '📝 Reason', value: `\`${customReason}\``, inline: false });
        }

        try {
            await interaction.editReply({ embeds: [finalEmbed] });
        } catch (webhookErr) {
            if (interaction.channel && interaction.channel.isTextBased()) {
                await interaction.channel.send({
                    content: `<@${interaction.user.id}>, your bulk role operation has finished:`,
                    embeds: [finalEmbed]
                }).catch(() => {});
            }
        }
    } finally {
        activeGuildOperations.delete(guildId);
    }
}

/**
 * Cancels any active bulk operation running in the guild.
 */
function cancelBulkOperation(guildId, userId) {
    const op = activeGuildOperations.get(guildId);
    if (!op) return null;
    op.isCancelled = true;
    op.cancelledBy = userId;
    op.cancelledAt = Date.now();
    return op;
}

/**
 * Returns the active operation for a guild or null.
 */
function getActiveBulkOperation(guildId) {
    return activeGuildOperations.get(guildId) || null;
}

/**
 * Returns recent operation history for a guild.
 */
function getOperationsHistory(guildId) {
    return operationsHistory.get(guildId) || [];
}

/**
 * Handles `/bulkrole view` or `/operations view`.
 */
async function handleViewOperations(interaction) {
    const guildId = interaction.guild.id;
    const activeOp = getActiveBulkOperation(guildId);
    const history = getOperationsHistory(guildId);

    if (activeOp) {
        const percent = Math.round((activeOp.completed / activeOp.totalTargets) * 100);
        const bar = createProgressBar(activeOp.completed, activeOp.totalTargets);
        const elapsedSecs = Math.max(Math.round((Date.now() - activeOp.startTime) / 1000), 1);
        const avgPerSec = activeOp.completed / elapsedSecs;
        const remainingSecs = avgPerSec > 0 ? Math.max(Math.round((activeOp.totalTargets - activeOp.completed) / avgPerSec), 0) : 0;

        const embed = new EmbedBuilder()
            .setTitle(`🔄 Active Server Operation: ${activeOp.isAdd ? 'Bulk Role Add' : 'Bulk Role Remove'}`)
            .setColor(0x3498DB)
            .setDescription(`**Target Role**: ${activeOp.roleMention} (\`${activeOp.roleId}\`)\n` +
                `**Filter**: \`${activeOp.filterLabel}\`\n` +
                `**Moderator**: <@${activeOp.moderatorId}>\n\n` +
                `\`${bar}\` **${percent}%** (${activeOp.completed}/${activeOp.totalTargets})\n\n` +
                `✅ **Updated**: ${activeOp.successCount} | ⚠️ **Failed**: ${activeOp.failedCount}\n` +
                `⏱️ **Running For**: ${elapsedSecs}s | **Est. Remaining**: ${remainingSecs}s`)
            .addFields({
                name: '⚡ Quick Action',
                value: 'Run `/bulkrole cancel` or `/operations cancel` to stop this task immediately.',
                inline: false
            })
            .setFooter({ text: `Op ID: ${activeOp.id} • Server: ${interaction.guild.name}` })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    }

    if (history.length === 0) {
        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('📋 Server Operations Status')
                    .setDescription('No active or recent bulk operations found for this server.')
                    .setColor(0x7289DA)
                    .setFooter({ text: 'Use /bulkrole add or /bulkrole remove to start a task.' })
            ]
        });
    }

    // Display history of past operations
    const historyEmbed = new EmbedBuilder()
        .setTitle('📋 Recent Server Operations History')
        .setDescription('No bulk operations are currently running. Here are the most recent operations:')
        .setColor(0x2ECC71);

    history.forEach((h, idx) => {
        const timeAgo = `<t:${Math.floor(h.startTime / 1000)}:R>`;
        const statusBadge = h.status === 'completed' ? '✅ Completed' : (h.status === 'cancelled' ? '🛑 Cancelled' : '⚠️ Interrupted');
        historyEmbed.addFields({
            name: `${idx + 1}. ${h.isAdd ? '➕ Bulk Add' : '➖ Bulk Remove'} - ${h.roleName} (${statusBadge})`,
            value: `**Filter**: \`${h.filterLabel}\`\n**Updated**: ${h.successCount}/${h.totalTargets} members in \`${h.durationSecs || 0}s\`\n**Moderator**: <@${h.moderatorId}> • Started ${timeAgo}`,
            inline: false
        });
    });

    return interaction.editReply({ embeds: [historyEmbed] });
}

/**
 * Handles `/bulkrole cancel` or `/operations cancel`.
 */
async function handleCancelOperation(interaction) {
    const guildId = interaction.guild.id;
    const activeOp = cancelBulkOperation(guildId, interaction.user.id);

    if (!activeOp) {
        return handleError(
            interaction,
            'No Active Operation',
            'There are no bulk operations currently running in this server to cancel.'
        );
    }

    const cancelEmbed = new EmbedBuilder()
        .setTitle('🛑 Cancellation Signal Sent')
        .setDescription(`Successfully sent the cancellation command to Operation **\`${activeOp.id}\`** (${activeOp.isAdd ? 'Bulk Add' : 'Bulk Remove'} for **${activeOp.roleName}**).\n\nThe operation will halt gracefully on the next member and produce a final summary.`)
        .setColor(0xE67E22)
        .addFields(
            { name: 'Cancelled By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Progress at Cancel', value: `${activeOp.completed}/${activeOp.totalTargets} members processed`, inline: true }
        )
        .setTimestamp();

    return interaction.editReply({ embeds: [cancelEmbed] });
}

module.exports = {
    processBulkRole,
    parseFilterDate,
    performRoleOperationWithRetry,
    createProgressBar,
    fetchAllGuildMembers,
    cancelBulkOperation,
    getActiveBulkOperation,
    getOperationsHistory,
    handleViewOperations,
    handleCancelOperation
};
