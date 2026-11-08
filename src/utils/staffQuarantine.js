const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const settingsCache = require('./settingsCache');
const GuildSettings = require('../database/models/GuildSettings');
const Case = require('../database/models/Case');

// In-memory sliding window tracker per moderator: Map<`${guildId}_${userId}_${actionType}`, Array<timestamp>>
const staffActionTracker = new Map();

// Periodic cleanup of stale tracking entries every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of staffActionTracker.entries()) {
        const fresh = timestamps.filter(t => now - t < 60000);
        if (fresh.length === 0) {
            staffActionTracker.delete(key);
        } else {
            staffActionTracker.set(key, fresh);
        }
    }
}, 60000);

/**
 * Wick-style Anti-Nuke & Staff Quarantine Handler
 * Intercepts destructive staff actions (mass channel deletes, mass role deletes, mass kicks, mass bans).
 * If a staff member exceeds thresholds within 15 seconds, immediately revokes administrative roles,
 * assigns Quarantine Role, issues timeout, creates an audit case, and dispatches an emergency DM alert to the server owner.
 */
async function handleStaffAction(guild, executor, actionType, targetResource) {
    if (!guild || !executor || executor.bot) return;
    if (executor.id === guild.ownerId) return; // Server Owner can never be quarantined

    try {
        const settings = await settingsCache.get(guild.id) || await GuildSettings.findByPk(guild.id);
        if (!settings || !settings.staffQuarantineEnabled) return;

        // Check trusted roles exemption
        let trustedRoles = [];
        try {
            if (settings.staffQuarantineTrustedRoles) {
                trustedRoles = typeof settings.staffQuarantineTrustedRoles === 'string'
                    ? JSON.parse(settings.staffQuarantineTrustedRoles)
                    : settings.staffQuarantineTrustedRoles;
            }
        } catch (_) {}

        const member = guild.members.cache.get(executor.id) || await guild.members.fetch(executor.id).catch(() => null);
        if (!member) return;

        if (Array.isArray(trustedRoles) && trustedRoles.length > 0 && member.roles?.cache?.some(r => trustedRoles.includes(r.id))) {
            return; // Trusted role whitelist
        }

        const now = Date.now();
        const key = `${guild.id}_${executor.id}_${actionType}`;
        if (!staffActionTracker.has(key)) staffActionTracker.set(key, []);
        const history = staffActionTracker.get(key).filter(t => now - t < 15000); // 15-second window
        history.push(now);
        staffActionTracker.set(key, history);

        let threshold = 3;
        if (actionType === 'CHANNEL_DELETE') threshold = parseInt(settings.staffQuarantineMaxChannels || 2, 10);
        else if (actionType === 'ROLE_DELETE') threshold = parseInt(settings.staffQuarantineMaxRoles || 2, 10);
        else if (actionType === 'MEMBER_BAN') threshold = parseInt(settings.staffQuarantineMaxBans || 4, 10);
        else if (actionType === 'MEMBER_KICK') threshold = parseInt(settings.staffQuarantineMaxKicks || 4, 10);

        if (history.length >= threshold) {
            console.warn(`[Staff Quarantine Triggered] ${executor.tag || executor.id} in "${guild.name}" exceeded ${actionType} limit (${history.length}/${threshold})`);

            // 1. Strip dangerous management & administrative roles
            const dangerousRoles = member.roles?.cache?.filter(r =>
                r.id !== guild.id &&
                (r.permissions.has(PermissionFlagsBits.Administrator) ||
                 r.permissions.has(PermissionFlagsBits.ManageGuild) ||
                 r.permissions.has(PermissionFlagsBits.ManageChannels) ||
                 r.permissions.has(PermissionFlagsBits.ManageRoles) ||
                 r.permissions.has(PermissionFlagsBits.BanMembers) ||
                 r.permissions.has(PermissionFlagsBits.KickMembers))
            );

            if (dangerousRoles && dangerousRoles.size > 0 && guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
                await member.roles.remove(dangerousRoles, 'Nora Wick Anti-Nuke: Staff Quarantine triggered').catch(() => null);
            }

            // 2. Assign Quarantine Role if configured
            const quarantineRoleId = settings.staffQuarantineRoleId || settings.quarantineRoleId;
            if (quarantineRoleId && guild.roles.cache.has(quarantineRoleId) && guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
                await member.roles.add(quarantineRoleId, 'Nora Wick Anti-Nuke: Assigned Quarantine Role').catch(() => null);
            }

            // 3. Timeout the rogue staff member for 1 hour to prevent further deletions or spam
            if (member.moderatable) {
                await member.timeout(3600000, `Staff Quarantine: Exceeded ${actionType} threshold (${history.length}/${threshold} in 15s)`).catch(() => null);
            }

            // 4. Create an official Audit Case
            await Case.create({
                guildId: guild.id,
                action: 'QUARANTINE',
                targetId: executor.id,
                moderatorId: guild.client.user.id,
                reason: `[Wick Anti-Nuke] Exceeded ${actionType} threshold (${history.length}/${threshold} in 15s). Stripped administrative roles and applied quarantine.`
            }).catch(() => null);

            // 5. Emergency Alert to Guild Owner via DM
            const owner = await guild.fetchOwner().catch(() => null);
            if (owner) {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('🚨 URGENT: Staff Quarantine Activated on Your Server!')
                    .setColor(0xED4245)
                    .setDescription(`Nora's **Wick-Style Staff Anti-Nuke System** detected abnormal destructive actions by staff member **${executor.tag || executor.id}** (\`${executor.id}\`) in **${guild.name}**.`)
                    .addFields(
                        { name: 'Trigger Action', value: `\`${actionType}\` (${history.length} actions in 15s)`, inline: true },
                        { name: 'Threshold Exceeded', value: `\`${threshold}\` allowed`, inline: true },
                        { name: 'Target Resource', value: targetResource ? `\`${targetResource.name || targetResource.id || 'N/A'}\`` : 'Multiple', inline: true },
                        { name: 'Protective Measures Taken', value: '• Revoked all administrative & management roles\n• Assigned Quarantine Role\n• Applied 1-hour containment timeout', inline: false }
                    )
                    .setFooter({ text: 'Nora Zero-Trust Anti-Nuke Protection' })
                    .setTimestamp();

                await owner.send({ embeds: [dmEmbed] }).catch(() => null);
            }

            // 6. Post to Mod Log Channel
            const logChannelId = settings.modLogChannelId || settings.auditLogChannelId;
            if (logChannelId) {
                const logChannel = guild.channels.cache.get(logChannelId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('🚨 Anti-Nuke Staff Quarantine Triggered')
                        .setColor(0xED4245)
                        .setDescription(`Staff member **${executor.tag || executor.id}** (\`${executor.id}\`) has been automatically quarantined after executing multiple destructive actions in rapid succession.`)
                        .addFields(
                            { name: 'Action', value: `\`${actionType}\``, inline: true },
                            { name: 'Volume / Limit', value: `\`${history.length} / ${threshold}\` (in 15s)`, inline: true },
                            { name: 'Status', value: '⚠️ Dangerous roles revoked & quarantined', inline: true }
                        )
                        .setFooter({ text: 'Nora Wick Anti-Nuke Guard' })
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }
        }
    } catch (err) {
        console.error('[Staff Quarantine Error]:', err);
    }
}

module.exports = {
    handleStaffAction
};
