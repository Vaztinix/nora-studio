const { Events, EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

module.exports = {
    name: Events.PresenceUpdate,
    async execute(oldPresence, newPresence) {
        if (!newPresence || !newPresence.guild || !newPresence.member) return;
        if (newPresence.member.user.bot) return;

        try {
            // High-Performance Settings Fetch (with safety fallback for schema sync)
            const settings = await GuildSettings.findOne({ where: { guildId: newPresence.guild.id } }).catch(() => null);
            if (!settings || !settings.promoterRoleId) return;

            const promoterRole = newPresence.guild.roles.cache.get(settings.promoterRoleId);
            if (!promoterRole) return;

            const activities = newPresence.activities || [];
            const customStatus = activities.find(a => a.type === 4); // 4 is CUSTOM_STATUS

            const PROMO_LINK_1 = 'vaztinix.github.io/Nora';
            const PROMO_LINK_2 = 'vaztinix.dev';
            const hasPromo = customStatus && (
                customStatus.state?.includes(PROMO_LINK_1) || 
                customStatus.name?.includes(PROMO_LINK_1) ||
                customStatus.state?.includes(PROMO_LINK_2) || 
                customStatus.name?.includes(PROMO_LINK_2)
            );

            // console.log(`[Promoter DEBUG] User: ${newPresence.member.user.tag}, Status: "${customStatus ? customStatus.state : 'None'}", Match: ${hasPromo}`);

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

            } else if (!hasPromo && hasRole) {
                // Remove the role
                await newPresence.member.roles.remove(promoterRole).catch(() => { });
                console.log(`[Promoter System] Removed role from ${newPresence.member.user.tag} in ${newPresence.guild.name}`);
            }

        } catch (error) {
            console.error('[Promoter System] Presence Update Error:', error);
        }
    },
};
