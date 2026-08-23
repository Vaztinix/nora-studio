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
 * Main engine to process bulk role additions / removals.
 */
async function processBulkRole({ interaction, isAdd, role, filter, filterRole, customReason }) {
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

    // Initial status embed
    await interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setTitle('⏳ Fetching Guild Members...')
                .setDescription(`Scanning all server members to prepare bulk ${isAdd ? 'assignment' : 'removal'} for ${role}...`)
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

        // Apply filter criteria
        if (filter === 'humans' && member.user.bot) continue;
        if (filter === 'bots' && !member.user.bot) continue;
        if (filter === 'has_role' && filterRole && !member.roles.cache.has(filterRole.id)) continue;
        if (filter === 'lacks_role' && filterRole && member.roles.cache.has(filterRole.id)) continue;

        targets.push(member);
    }

    let filterLabel = 'All Members (Humans & Bots)';
    if (filter === 'humans') filterLabel = 'Humans Only';
    else if (filter === 'bots') filterLabel = 'Bots Only';
    else if (filter === 'has_role') filterLabel = `Members with ${filterRole.name}`;
    else if (filter === 'lacks_role') filterLabel = `Members without ${filterRole.name}`;

    if (targets.length === 0) {
        return handleError(
            interaction,
            'No Eligible Members',
            `Found **0** members matching the filter criteria (\`${filterLabel}\`) that require ${role} ${isAdd ? 'added' : 'removed'}.`
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
    performRoleOperationWithRetry,
    createProgressBar,
    fetchAllGuildMembers,
    cancelBulkOperation,
    getActiveBulkOperation,
    getOperationsHistory,
    handleViewOperations,
    handleCancelOperation
};
