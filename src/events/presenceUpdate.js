const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const { handlePresenceUpdate } = require('../utils/activityVoiceRouter');

/**
 * Evaluates whether custom status matches the promoter requirement.
 * @param {string} statusText - The member's custom status text
 * @param {string} targetText - The required promotion phrase configured by server staff
 * @param {string} matchMode - 'contains' | 'exact'
 * @param {string} caseFilter - 'mixed' | 'caps' | 'lowercase' | 'exact'
 * @returns {boolean}
 */
function checkPromoMatch(statusText, targetText, matchMode, caseFilter) {
    if (!statusText || !targetText) return false;

    const s = String(statusText).trim();
    const t = String(targetText).trim();
    if (!s || !t) return false;

    if (caseFilter === 'caps') {
        const requiredCaps = t.toUpperCase();
        if (matchMode === 'exact') {
            return s === requiredCaps;
        } else {
            return s.includes(requiredCaps);
        }
    } else if (caseFilter === 'lowercase') {
        const requiredLower = t.toLowerCase();
        if (matchMode === 'exact') {
            return s === requiredLower;
        } else {
            return s.includes(requiredLower);
        }
    } else if (caseFilter === 'exact' || caseFilter === 'exact_case') {
        if (matchMode === 'exact') {
            return s === t;
        } else {
            return s.includes(t);
        }
    } else {
        // 'mixed' (flexible / case-insensitive)
        const sLower = s.toLowerCase();
        const tLower = t.toLowerCase();
        if (matchMode === 'exact') {
            return sLower === tLower;
        } else {
            return sLower.includes(tLower);
        }
    }
}

module.exports = {
    name: Events.PresenceUpdate,
    async execute(oldPresence, newPresence) {
        if (!newPresence || !newPresence.guild || !newPresence.member) return;
        if (newPresence.member.user?.bot) return;

        // 🎮 1. Current User Activities: Automatic Voice Channel Router
        try {
            await handlePresenceUpdate(oldPresence, newPresence);
        } catch (actErr) {
            console.error('[Activity VC Router Error]:', actErr.message);
        }

        try {
            // High-Performance Settings Fetch (with safety fallback for schema sync)
            const settings = await GuildSettings.findOne({ where: { guildId: newPresence.guild.id } }).catch(() => null);
            if (!settings || !settings.promoterRoleId) return;

            const promoterRole = newPresence.guild.roles.cache.get(settings.promoterRoleId);
            if (!promoterRole) return;

            const activities = newPresence.activities || [];
            // Type 4 is CUSTOM_STATUS
            const customStatus = activities.find(a => a.type === 4);

            const targetText = (settings.promoterCustomStatus && settings.promoterCustomStatus.trim()) || 'vaztinix.dev';
            const matchMode = settings.promoterMatchMode || 'contains';
            const caseFilter = settings.promoterCaseFilter || 'mixed';

            const userStatusText = customStatus ? (customStatus.state || customStatus.name || '') : '';
            const hasPromo = Boolean(customStatus && checkPromoMatch(userStatusText, targetText, matchMode, caseFilter));

            const hasRole = newPresence.member.roles.cache.has(settings.promoterRoleId);

            if (hasPromo && !hasRole) {
                // Check hierarchy and permissions
                const botMember = newPresence.guild.members.me;
                if (!botMember.permissions.has('ManageRoles')) {
                    console.error('[Promoter System] FAILED: Nora lacks ManageRoles permission.');
                    return;
                }
                if (promoterRole.position >= botMember.roles.highest.position) {
                    console.error(`[Promoter System] FAILED: Role ${promoterRole.name} is higher than Nora's role.`);
                    return;
                }

                // Award the role
                await newPresence.member.roles.add(promoterRole).catch(err => {
                    console.error(`[Promoter System] Error adding role to ${newPresence.member.user.tag}:`, err.message);
                });
                console.log(`[Promoter System] Awarded role to ${newPresence.member.user.tag} in ${newPresence.guild.name}`);

                // Opt-in notification
                if (settings.promoterNotifyOptIn) {
                    try {
                        const embed = new EmbedBuilder()
                            .setColor('#10b981')
                            .setTitle('🎉 Status Promoter Role Awarded!')
                            .setDescription(`You have received the **${promoterRole.name}** role in **${newPresence.guild.name}** for featuring our server in your custom status!\n\nThank you for supporting our community!`)
                            .setFooter({ text: newPresence.guild.name, iconURL: newPresence.guild.iconURL({ dynamic: true }) || undefined })
                            .setTimestamp();
                        await newPresence.member.send({ embeds: [embed] }).catch(() => {});
                    } catch (_) {}
                }

            } else if (!hasPromo && hasRole) {
                // Remove the role
                await newPresence.member.roles.remove(promoterRole).catch(() => { });
                console.log(`[Promoter System] Removed role from ${newPresence.member.user.tag} in ${newPresence.guild.name}`);

                // Opt-out notification
                if (settings.promoterNotifyOptOut) {
                    try {
                        const embed = new EmbedBuilder()
                            .setColor('#f43f5e')
                            .setTitle('ℹ️ Status Promoter Role Removed')
                            .setDescription(`The **${promoterRole.name}** role in **${newPresence.guild.name}** was removed because your custom status no longer matches the server's promotion requirement.\n\nTo regain this role, add **${targetText}** back into your custom status!`)
                            .setFooter({ text: newPresence.guild.name, iconURL: newPresence.guild.iconURL({ dynamic: true }) || undefined })
                            .setTimestamp();
                        await newPresence.member.send({ embeds: [embed] }).catch(() => {});
                    } catch (_) {}
                }
            }

        } catch (error) {
            console.error('[Promoter System] Presence Update Error:', error);
        }
    },
};
