const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');
const { formatMessage } = require('../utils/messageFormatter');

// In-memory Join Tracker for Anti-Raid
const joinLog = new Map();

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            const settings = await GuildSettings.findOne({ where: { guildId: member.guild.id } });
            // console.log(`[Logger DEBUG] MemberJoin event in ${member.guild.name}. LogChannelSet: ${!!settings?.loggingChannelId}, Toggle: ${settings?.logMemberJoins}, WelcomeChannelSet: ${!!settings?.welcomeChannelId}, Toggle: ${settings?.welcomerEnabled}`);
            if (!settings) return;

            // --- 🛡️ Nora Security Shield: GLOBAL LOCKDOWN ---
            if (settings.lockdownMode) {
                try {
                    await member.send({ content: `⚠️ **Security Alert**: **${member.guild.name}** is currently in **Emergency Lockdown Mode**. New joins are temporarily restricted. Please try again later.` }).catch(() => {});
                    await member.kick('Nora Security: Global Lockdown Enabled').catch(() => {});
                } catch (e) {}
                
                if (settings.loggingChannelId) {
                    const logChannel = member.guild.channels.cache.get(settings.loggingChannelId);
                    if (logChannel) {
                        const lockEmbed = new EmbedBuilder()
                            .setTitle('🛡️ Security Guard: Lockdown Block')
                            .setColor(0xff0000)
                            .setDescription(`**User**: ${member.user.tag} (\`${member.id}\`)\n**Status**: Join blocked due to active server-wide lockdown.`)
                            .setTimestamp();
                        await logChannel.send({ embeds: [lockEmbed] }).catch(() => {});
                    }
                }
                return; // Stop processing
            }

            // --- 🛡️ Nora Security Shield: PROFILE PICTURE (PFP) REQUIREMENT ---
            if (settings.requirePFP && !member.user.avatar) {
                try {
                    await member.send({ content: `⚠️ **Security Alert**: **${member.guild.name}** requires all members to have a **Profile Picture** to join. This helps prevent automated bot raids. Please set an avatar and try again.` }).catch(() => {});
                    await member.kick('Nora Security: Profile Picture Required').catch(() => {});
                } catch (e) {}

                if (settings.loggingChannelId) {
                    const logChannel = member.guild.channels.cache.get(settings.loggingChannelId);
                    if (logChannel) {
                        const pfpEmbed = new EmbedBuilder()
                            .setTitle('🛡️ Security Guard: PFP Required')
                            .setColor(0xffa500)
                            .setDescription(`**User**: ${member.user.tag} (\`${member.id}\`)\n**Status**: Join blocked because the account has no profile picture.`)
                            .setTimestamp();
                        await logChannel.send({ embeds: [pfpEmbed] }).catch(() => {});
                    }
                }
                return; // Stop processing
            }

            // --- 🛡️ Nora Security Shield: ACCOUNT AGE FIREBREAK ---
            if (settings.minAccountAge > 0) {
                const now = Date.now();
                const accountAgeDays = (now - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
                
                if (accountAgeDays < settings.minAccountAge) {
                    const action = settings.minAccountAgeAction || 'kick';
                    const reason = `Nora Security: Account too new (${Math.floor(accountAgeDays)}/${settings.minAccountAge} days).`;
                    
                    try {
                        await member.send({ content: `⚠️ **Security Alert**: Your account is too new to join **${member.guild.name}**. Requirement: **${settings.minAccountAge} days**.` }).catch(() => {});
                    } catch (e) {}

                    if (action === 'kick') await member.kick(reason).catch(() => {});
                    else if (action === 'ban_perm' || action.startsWith('ban_')) await member.ban({ reason, deleteMessageSeconds: 604800 }).catch(() => {});
                    
                    if (settings.loggingChannelId) {
                        const logChannel = member.guild.channels.cache.get(settings.loggingChannelId);
                        if (logChannel) {
                            const ageEmbed = new EmbedBuilder()
                                .setTitle(`🛡️ Security Guard: Account Age Gate`)
                                .setColor(0xff0000)
                                .setDescription(`**User**: ${member.user.tag} (\`${member.id}\`)\n**Age**: ${Math.floor(accountAgeDays)}d (Req: ${settings.minAccountAge}d)\n**Action**: ${action.toUpperCase()}`)
                                .setTimestamp();
                            await logChannel.send({ embeds: [ageEmbed] }).catch(() => {});
                        }
                    }
                    return;
                }
            }

            // --- 🛡️ Nora Security Shield: NICKNAME RAID FILTER ---
            if (settings.nicknameRaidFilter) {
                const lowerName = member.user.username.toLowerCase();
                // Common Patterns: Random alphanumeric strings, generic bot descriptors, or known scam prefixes
                const raidPatterns = [/^[a-z]{2,3}[0-9]{4,6}$/, /nora.*supp/i, /verify.*bot/i, /^[0-9]{5,}.*$/];
                const isSuspicious = raidPatterns.some(regex => regex.test(lowerName));

                if (isSuspicious) {
                   const reason = `Nora Security: Nickname filter violation (${member.user.username})`;
                   await member.kick(reason).catch(() => {});
                   
                   if (settings.loggingChannelId) {
                       const logChannel = member.guild.channels.cache.get(settings.loggingChannelId);
                       if (logChannel) {
                           const nickEmbed = new EmbedBuilder()
                               .setTitle('🛡️ Security Guard: Nickname Filter')
                               .setColor(0xffa500)
                               .setDescription(`**User**: ${member.user.tag} (\`${member.id}\`)\n**Status**: Join blocked due to suspicious naming pattern matching anti-raid definitions.`)
                               .setTimestamp();
                           await logChannel.send({ embeds: [nickEmbed] }).catch(() => {});
                       }
                   }
                   return;
                }
            }

            // 1. --- Anti-Raid Detection Logic ---
            if (settings.antiRaidEnabled) {
                const guildId = member.guild.id;
                const now = Date.now();
                const windowMs = settings.antiRaidWindow || 10000;

                if (!joinLog.has(guildId)) joinLog.set(guildId, []);
                const timestamps = joinLog.get(guildId);

                const recentJoins = timestamps.filter(t => (now - t) < windowMs);
                recentJoins.push(now);
                joinLog.set(guildId, recentJoins);

                if (recentJoins.length > settings.antiRaidThreshold) {
                    const alertChannel = member.guild.channels.cache.get(settings.loggingChannelId || settings.welcomeChannelId);
                    if (alertChannel) {
                        const raidEmbed = new EmbedBuilder()
                            .setTitle('🛡️ Anti-Raid Alert: Surge Detected')
                            .setDescription(`Massive join surge detected! **${recentJoins.length}** members joined in **${windowMs / 1000}s**.\n\n**Action Configuration:** \`${settings.antiRaidAction || 'notify'}\``)
                            .setColor(0xff0000)
                            .setTimestamp();
                        await alertChannel.send({ embeds: [raidEmbed] }).catch(() => { });
                    }

                    // --- Handle Surge Actions ---
                    if (settings.antiRaidAction === 'lockdown') {
                        settings.lockdownMode = true;
                        await settings.save();
                        if (alertChannel) await alertChannel.send({ content: '🚨 **Auto-Mod**: Join surge threshold exceeded. **Global Lockdown** has been automatically activated.' }).catch(() => {});
                    } else if (settings.antiRaidAction === 'kick_new') {
                        try {
                            await member.send({ content: `⚠️ **Security Alert**: **${member.guild.name}** is currently experiencing a join surge. You have been kicked to protect the server. Please try again in a few minutes.` }).catch(() => {});
                            await member.kick('Nora Security: Anti-Raid Surge Protection (Kick New)').catch(() => {});
                        } catch (e) {}
                        return; // Stop processing for this specific join
                    }
                }
            }

            // ─── Role Recovery restoration logic ───
            try {
                const MemberRolesHistory = require('../database/models/MemberRolesHistory');
                const history = await MemberRolesHistory.findOne({
                    where: { userId: member.id, guildId: member.guild.id }
                });
                
                if (history && history.roles) {
                    const roleIds = JSON.parse(history.roles || '[]');
                    if (roleIds.length > 0) {
                        const rolesToRestore = [];
                        const skippedRoles = [];
                        
                        for (const roleId of roleIds) {
                            const role = member.guild.roles.cache.get(roleId);
                            if (!role) continue;
                            
                            // Check for sensitive permissions: Administrator, Manage Guild (Manage Server), Manage Roles, Manage Channels, Kick Members, Ban Members
                            const isSensitive = role.permissions.has(PermissionFlagsBits.Administrator) ||
                                                role.permissions.has(PermissionFlagsBits.ManageGuild) ||
                                                role.permissions.has(PermissionFlagsBits.ManageRoles) ||
                                                role.permissions.has(PermissionFlagsBits.ManageChannels) ||
                                                role.permissions.has(PermissionFlagsBits.KickMembers) ||
                                                role.permissions.has(PermissionFlagsBits.BanMembers);
                                                
                            if (isSensitive) {
                                skippedRoles.push(role.name);
                            } else {
                                // Also ensure the bot can actually assign this role (role position is below the bot's highest role)
                                const botHighest = member.guild.members.me.roles.highest.position;
                                if (role.position < botHighest) {
                                    rolesToRestore.push(role);
                                } else {
                                    skippedRoles.push(`${role.name} (Higher than bot)`);
                                }
                            }
                        }
                        
                        if (rolesToRestore.length > 0) {
                            await member.roles.add(rolesToRestore, 'Nora: Automatic Role Recovery on Rejoin').catch(err => {
                                console.error(`[Role Recovery] Failed to assign roles for ${member.user.tag}:`, err.message);
                            });
                        }
                        
                        const loggerUtil = require('../utils/logger');
                        const logChannelId = loggerUtil.resolveLogChannelId(settings, 'memberJoins');
                        if (logChannelId) {
                            const logChannel = member.guild.channels.cache.get(logChannelId) ||
                                               await member.guild.channels.fetch(logChannelId).catch(() => null);
                            if (logChannel) {
                                const restoreEmbed = new EmbedBuilder()
                                    .setTitle('🛡️ Role Recovery')
                                    .setColor(0xffffff) // Pure white theme for Nora Studio
                                    .setDescription(`Restored roles for **${member.user.tag}** on rejoin.`)
                                    .addFields(
                                        { name: 'Restored Roles', value: rolesToRestore.length > 0 ? rolesToRestore.map(r => `<@&${r.id}>`).join(', ') : 'None' },
                                        { name: 'Skipped Roles (Sensitive/High)', value: skippedRoles.length > 0 ? skippedRoles.join(', ') : 'None' }
                                    )
                                    .setTimestamp();
                                await logChannel.send({ embeds: [restoreEmbed] }).catch(() => {});
                            }
                        }
                    }
                }
            } catch (roleRestoreErr) {
                console.error('[Role Recovery Error] Failed to restore roles:', roleRestoreErr.message);
            }

            // 2. --- Join Logging (Audit Logs) ---
            if (settings.logMemberJoins) {
                const loggerUtil = require('../utils/logger');
                const logChannelId = loggerUtil.resolveLogChannelId(settings, 'memberJoins');
                if (logChannelId) {
                    let logChannel = member.guild.channels.cache.get(logChannelId);
                    if (!logChannel) logChannel = await member.guild.channels.fetch(logChannelId).catch(() => null);

                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('Member Joined')
                            .setColor(0x43b581) // Green for joins
                            .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
                            .addFields(
                                { name: 'User', value: `<@${member.id}>`, inline: true },
                                { name: 'ID', value: `\`${member.id}\``, inline: true },
                                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
                            )
                            .setTimestamp();
                        await logChannel.send({ embeds: [logEmbed] }).catch(() => { });
                    }
                }
            }

            // 2.5. --- Add Welcome Role on Join ---
            if (settings.welcomeRoleId) {
                const role = member.guild.roles.cache.get(settings.welcomeRoleId);
                if (role) {
                    await member.roles.add(role, 'Nora: Welcome Role assigned on join').catch(err => {
                        console.error(`[Welcome Role] Failed to assign role ${role.name} for ${member.user.tag}:`, err.message);
                    });
                }
            }

            // 3. --- Welcome Announcement (Welcomer Module) ---
            if (settings.welcomerEnabled && settings.welcomeChannelId) {
                let welcomeChannel = member.guild.channels.cache.get(settings.welcomeChannelId);
                if (!welcomeChannel) welcomeChannel = await member.guild.channels.fetch(settings.welcomeChannelId).catch(() => null);

                if (welcomeChannel) {
                    const template = settings.logJoinMessage;
                    const desc = template ? formatMessage(template, member) : `Welcome, <@${member.id}>! We're glad you're here!`;

                    const embed = new EmbedBuilder()
                        .setTitle(`Welcome to ${member.guild.name}!`)
                        .setDescription(desc)
                        .setColor(0xffffff) // Pure white theme for Nora Studio
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                        .setFooter({ text: `Member #${member.guild.memberCount}` })
                        .setTimestamp();
                    await welcomeChannel.send({ embeds: [embed] }).catch(() => { });
                }
            }

            // 4. --- Invite Tracker Module ---
            if (settings.inviteTrackerEnabled && settings.inviteTrackerChannelId) {
                try {
                    const trackingChannel = member.guild.channels.cache.get(settings.inviteTrackerChannelId);
                    if (trackingChannel) {
                        const newInvites = await member.guild.invites.fetch().catch(() => null);
                        const cachedInvites = member.client.invites?.get(member.guild.id);
                        
                        let usedInvite = null;
                        if (newInvites && cachedInvites) {
                            for (const [code, invite] of newInvites.entries()) {
                                const oldUses = cachedInvites.get(code) || 0;
                                if (invite.uses > oldUses) {
                                    usedInvite = invite;
                                    break;
                                }
                            }
                            
                            // Update cache
                            member.client.invites.set(member.guild.id, new Map(newInvites.map(inv => [inv.code, inv.uses])));
                        }

                        let inviteInfo = `joined using a vanity link or unknown invite.`;
                        if (usedInvite) {
                            const inviter = usedInvite.inviter;
                            inviteInfo = `Invited by: ${inviter ? `<@${inviter.id}> (\`${inviter.username}\`, ID: \`${inviter.id}\`)` : 'Unknown'}\nInvite Link: [${usedInvite.code}](https://discord.gg/${usedInvite.code})\nUses: **${usedInvite.uses}**`;
                        }

                        const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
                        const accountAgeStr = accountAgeDays === 0 ? 'Today (New Account!)' : `${accountAgeDays} days ago (${new Date(member.user.createdTimestamp).toLocaleDateString()})`;

                        const inviteEmbed = new EmbedBuilder()
                            .setTitle('📥 Member Join Invite Tracker')
                            .setColor(0x57acf2)
                            .setDescription(`**User:** <@${member.id}> (\`${member.user.username}\`, ID: \`${member.id}\`)\n\n**Invite Details:**\n${inviteInfo}`)
                            .addFields(
                                { name: 'Account Age', value: accountAgeStr, inline: true },
                                { name: 'Join Position', value: `Member #${member.guild.memberCount}`, inline: true }
                            )
                            .setTimestamp()
                            .setFooter({ text: `Member ID: ${member.id}`, iconURL: member.user.displayAvatarURL() });
                        await trackingChannel.send({ embeds: [inviteEmbed] }).catch(() => {});
                    }
                } catch (inviteTrackErr) {
                    console.error('[Invite Tracker Engine Error]:', inviteTrackErr.message);
                }
            }
        } catch (error) {
            console.error('[Logger] Error in MemberJoin:', error);
        }
    },
};
