const { EmbedBuilder, Events } = require('discord.js');
const UserLevel = require('../database/models/UserLevel');
const GuildSettings = require('../database/models/GuildSettings');
const settingsCache = require('./settingsCache');

// In-memory cache of guild invites: Map<guildId, Map<inviteCode, uses>>
// Also caches vanity URL uses: Map<guildId, number>
const guildInvitesCache = new Map();
const guildVanityCache = new Map();

/**
 * Caches all invites for a single guild
 */
async function cacheGuildInvites(guild) {
    if (!guild) return;
    try {
        const me = guild.members.me || await guild.members.fetch(guild.client.user.id).catch(() => null);
        if (!me || !me.permissions.has('ManageGuild')) return;

        const invites = await guild.invites.fetch().catch(() => null);
        if (invites) {
            const inviteMap = new Map();
            for (const [code, invite] of invites) {
                inviteMap.set(code, {
                    uses: invite.uses || 0,
                    inviterId: invite.inviter?.id || null,
                    inviterTag: invite.inviter?.tag || null,
                    code: invite.code
                });
            }
            guildInvitesCache.set(guild.id, inviteMap);
        }

        // Cache vanity uses if guild has a vanity URL
        if (guild.vanityURLCode) {
            const vanity = await guild.fetchVanityData().catch(() => null);
            if (vanity && typeof vanity.uses === 'number') {
                guildVanityCache.set(guild.id, vanity.uses);
            }
        }
    } catch (err) {
        // Silently catch missing permissions or rate limits
    }
}

/**
 * Initializes invite caching across all available guilds on bot startup
 */
async function initInviteCache(client) {
    if (!client) return;
    client.invites = guildInvitesCache;

    for (const guild of client.guilds.cache.values()) {
        await cacheGuildInvites(guild);
    }
    console.log(`[Invite Tracker] Always-on invite tracker initialized across ${guildInvitesCache.size} authorized servers.`);
}

/**
 * Handles real-time invite creation
 */
function handleInviteCreate(invite) {
    if (!invite || !invite.guild) return;
    const guildMap = guildInvitesCache.get(invite.guild.id) || new Map();
    guildMap.set(invite.code, {
        uses: invite.uses || 0,
        inviterId: invite.inviter?.id || null,
        inviterTag: invite.inviter?.tag || null,
        code: invite.code
    });
    guildInvitesCache.set(invite.guild.id, guildMap);
}

/**
 * Handles real-time invite deletion
 */
function handleInviteDelete(invite) {
    if (!invite || !invite.guild) return;
    const guildMap = guildInvitesCache.get(invite.guild.id);
    if (guildMap) {
        guildMap.delete(invite.code);
    }
}

/**
 * Tracks which invite was used when a new member joins and processes rewards
 */
async function processMemberJoin(member, settings) {
    if (!member || !member.guild || member.user.bot) return null;

    let usedInvite = null;
    let isVanity = false;
    let inviterUser = null;
    let totalInvitesCount = 0;
    let rewardGrantedText = '';

    try {
        const me = member.guild.members.me || await member.guild.members.fetch(member.client.user.id).catch(() => null);
        const hasPerms = me && me.permissions.has('ManageGuild');

        if (hasPerms) {
            const freshInvites = await member.guild.invites.fetch().catch(() => null);
            const cachedMap = guildInvitesCache.get(member.guild.id);

            if (freshInvites && cachedMap) {
                for (const [code, freshInv] of freshInvites) {
                    const cached = cachedMap.get(code);
                    const oldUses = cached ? cached.uses : 0;
                    if (freshInv.uses > oldUses) {
                        usedInvite = freshInv;
                        break;
                    }
                }
            }

            // Check Vanity URL if no regular invite was matched
            if (!usedInvite && member.guild.vanityURLCode) {
                const freshVanity = await member.guild.fetchVanityData().catch(() => null);
                const oldVanityUses = guildVanityCache.get(member.guild.id) || 0;
                if (freshVanity && freshVanity.uses > oldVanityUses) {
                    isVanity = true;
                    guildVanityCache.set(member.guild.id, freshVanity.uses);
                }
            }

            // Refresh the cache
            if (freshInvites) {
                const newMap = new Map();
                for (const [code, inv] of freshInvites) {
                    newMap.set(code, {
                        uses: inv.uses || 0,
                        inviterId: inv.inviter?.id || null,
                        inviterTag: inv.inviter?.tag || null,
                        code: inv.code
                    });
                }
                guildInvitesCache.set(member.guild.id, newMap);
            }
        }
    } catch (err) {
        console.error('[Invite Tracker Fetch Error]:', err.message);
    }

    inviterUser = usedInvite ? usedInvite.inviter : null;

    // Process Inviter Level, XP, and Milestone Rewards
    if (inviterUser && !inviterUser.bot && inviterUser.id !== member.id) {
        try {
            const [inviterLevel] = await UserLevel.findOrCreate({
                where: { userId: inviterUser.id, guildId: member.guild.id }
            });

            inviterLevel.invitesCount = (inviterLevel.invitesCount || 0) + 1;
            totalInvitesCount = inviterLevel.invitesCount;

            // Award XP for invite
            const xpGain = settings?.inviteXpReward !== undefined ? Number(settings.inviteXpReward) : 50;
            if (xpGain > 0) {
                inviterLevel.xp = (inviterLevel.xp || 0) + xpGain;
                inviterLevel.totalXp = (inviterLevel.totalXp || 0) + xpGain;
            }
            await inviterLevel.save();

            // Check Milestone Invite Rewards
            let rawRewards = settings?.inviteRewards;
            if (typeof rawRewards === 'string') {
                try { rawRewards = JSON.parse(rawRewards); } catch (e) { rawRewards = []; }
            }
            if (Array.isArray(rawRewards) && rawRewards.length > 0) {
                const inviterMember = await member.guild.members.fetch(inviterUser.id).catch(() => null);
                if (inviterMember) {
                    for (const rewardRule of rawRewards) {
                        const reqInv = Number(rewardRule.reqInvites || rewardRule.invites || 0);
                        const rewardRoleId = rewardRule.roleId || rewardRule.role;
                        if (reqInv > 0 && totalInvitesCount >= reqInv && rewardRoleId) {
                            const roleToGrant = member.guild.roles.cache.get(rewardRoleId);
                            if (roleToGrant && !inviterMember.roles.cache.has(roleToGrant.id)) {
                                await inviterMember.roles.add(roleToGrant, `Nora Invite Rewards: Reached ${totalInvitesCount} invites`).catch(() => {});
                                rewardGrantedText += `\n🎉 **Invite Reward Unlocked:** Granted <@&${roleToGrant.id}> to <@${inviterUser.id}> for reaching **${reqInv} invites**!`;
                            }
                        }
                    }
                }
            }
        } catch (invErr) {
            console.error('[Invite Reward Processing Error]:', invErr);
        }
    }

    // Post to Invite Tracker Channel if enabled or configured
    try {
        const trackingChannelId = settings?.inviteTrackerChannelId;
        const trackingChannel = trackingChannelId ? member.guild.channels.cache.get(trackingChannelId) : null;

        if (trackingChannel && (settings?.inviteTrackerEnabled !== false)) {
            let inviteInfo = `Joined using an unknown invite or direct join.`;
            if (isVanity) {
                inviteInfo = `Joined using the server's **Vanity URL** (\`discord.gg/${member.guild.vanityURLCode}\`).`;
            } else if (usedInvite && inviterUser) {
                inviteInfo = `**Invited by:** <@${inviterUser.id}> (\`${inviterUser.username}\`, ID: \`${inviterUser.id}\`)\n**Invite Code:** [${usedInvite.code}](https://discord.gg/${usedInvite.code})\n**Inviter Total:** **${totalInvitesCount || usedInvite.uses}** invites${rewardGrantedText}`;
            }

            const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
            const accountAgeStr = accountAgeDays === 0 ? 'Today (New Account!)' : `${accountAgeDays} days ago (${new Date(member.user.createdTimestamp).toLocaleDateString()})`;

            const inviteEmbed = new EmbedBuilder()
                .setTitle('📥 Member Joined (Invite Tracked)')
                .setColor(0x57ACF2)
                .setDescription(`**User:** <@${member.id}> (\`${member.user.username}\`, ID: \`${member.id}\`)\n\n${inviteInfo}`)
                .addFields(
                    { name: 'Account Age', value: accountAgeStr, inline: true },
                    { name: 'Member Number', value: `#${member.guild.memberCount}`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: `Member ID: ${member.id}`, iconURL: member.user.displayAvatarURL() });

            await trackingChannel.send({ embeds: [inviteEmbed] }).catch(() => {});
        }
    } catch (chanErr) {
        console.error('[Invite Tracker Channel Dispatch Error]:', chanErr.message);
    }

    return {
        usedInvite,
        isVanity,
        inviterUser,
        totalInvitesCount
    };
}

module.exports = {
    guildInvitesCache,
    cacheGuildInvites,
    initInviteCache,
    handleInviteCreate,
    handleInviteDelete,
    processMemberJoin
};
