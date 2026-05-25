const NoraLeveling = require('./noraLeveling');
const { EmbedBuilder } = require('discord.js');
const GuildSettings = require('../database/models/GuildSettings');

/**
 * Nora Voice Tracker - awards XP every 5 minutes to active voice participants.
 * Also enforces Anti-AFK (15m solo limit).
 */

const soloTracker = new Map(); // Global memory for solo detection (memberId-guildId -> count)

module.exports = {
    start: (client) => {
        const INTERVAL = NoraLeveling.getVoiceInterval(); // 5 Minutes
        const MEDIUM_XP = NoraLeveling.getMediumXP(); // 60 XP
        
        console.log(`[System Voice] Engagement engine physically online. Tick: ${INTERVAL/1000}s`);

        setInterval(async () => {
            for (const [guildId, guild] of client.guilds.cache) {
                try {
                    // Check if leveling or security features are enabled
                    let settings;
                    try {
                        settings = await GuildSettings.findOne({ where: { guildId } });
                    } catch (dbErr) {
                        continue;
                    }
                    if (!settings) continue;

                    // Scan voice channels
                    for (const [, channel] of guild.channels.cache.filter(c => c.isVoiceBased())) {
                        const allMembers = channel.members.filter(m => !m.user.bot);
                        const activeMembers = allMembers.filter(m => !m.voice.selfDeaf && !m.voice.serverDeaf);
                        
                        // --- Part 1: Engagement Rewards (Leveling) ---
                        if (settings.levelingEnabled && activeMembers.size >= 2) {
                            for (const [, member] of activeMembers) {
                                try {
                                    const userLevel = await NoraLeveling.getOrInitializeUser(member.id, guildId);
                                    if (!userLevel) continue;

                                    const res = await NoraLeveling.addExperience(userLevel, MEDIUM_XP);
                                    await userLevel.save();

                                    if (res.didLevelUp) {
                                        console.log(`[System Voice] ${member.user.tag} reached Level ${res.newLevel}`);
                                    }
                                } catch (err) {
                                    console.error(`[System Voice Error] Member ${member.id}:`, err.message);
                                }
                            }
                        }

                        // --- Part 2: Security Enforcement (Anti-AFK) ---
                        // If a VC has exactly 1 person inside it
                        if (allMembers.size === 1) {
                            const member = allMembers.first();
                            const key = `${member.id}-${guildId}`;
                            const count = (soloTracker.get(key) || 0) + 1;
                            
                            // 3 Ticks * 5 Minutes = 15 Minutes
                            if (count >= 3) {
                                try {
                                    // Remove from VC
                                    await member.voice.disconnect('Solo Idling 15m+ (Anti-AFK)');
                                    soloTracker.delete(key);

                                    // Log the event to configured logging channel
                                    if (settings.loggingChannelId) {
                                        let logChannel = guild.channels.cache.get(settings.loggingChannelId);
                                        if (!logChannel) logChannel = await guild.channels.fetch(settings.loggingChannelId).catch(() => null);

                                        if (logChannel) {
                                            const embed = new EmbedBuilder()
                                                .setAuthor({ 
                                                    name: 'Nora Security • Anti-AFK', 
                                                    iconURL: client.user.displayAvatarURL() 
                                                })
                                                .setDescription(`**${member.user.tag}** was removed from <#${channel.id}> for solo idling.`)
                                                .addFields({ name: 'Duration', value: '15+ Minutes', inline: true })
                                                .setColor('#607d8b') // Modern Slate
                                                .setTimestamp();
                                            
                                            await logChannel.send({ embeds: [embed] }).catch(() => {});
                                        }
                                    }
                                    
                                    console.log(`[System Voice] ${member.user.tag} removed from solo VC in ${guild.name}.`);
                                } catch (kickErr) {
                                    // Likely missing permissions or user moved at the last second
                                    soloTracker.delete(key);
                                }
                            } else {
                                soloTracker.set(key, count);
                            }
                        } else if (allMembers.size > 1) {
                            // Reset tracker for everyone in the channel if they have company
                            for (const [, member] of allMembers) {
                                soloTracker.delete(`${member.id}-${guildId}`);
                            }
                        }
                    }

                    // --- Part 3: Memory Hygiene ---
                    // Cleanup tracker for users no longer in any VC in this guild
                    for (const [key, value] of soloTracker) {
                        const [userId, gId] = key.split('-');
                        if (gId === guildId) {
                            const member = guild.members.cache.get(userId);
                            if (!member || !member.voice.channel) {
                                soloTracker.delete(key);
                            }
                        }
                    }

                } catch (error) {
                    console.error('[System Voice Error] Global Fault:', error.message);
                }
            }
        }, INTERVAL);
    }
};

