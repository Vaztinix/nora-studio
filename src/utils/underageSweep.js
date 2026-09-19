const { EmbedBuilder } = require('discord.js');

const TARGET_GUILD_ID = '1487342521133830174';
const UNDERAGE_ROLE_ID = '1539395288811446302';
const LOG_CHANNEL_ID = '1510677727206969625';
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Process and kick an underage member, send advisory DM, and log to audit channel.
 * @param {import('discord.js').GuildMember} member
 * @param {import('discord.js').Client} client
 */
async function processUnderageMember(member, client) {
    if (!member || !member.user) return;
    const guild = member.guild;
    const user = member.user;

    console.log(`[Underage Sweep] [DETECTED] User: ${user.tag} (ID: ${user.id}) in Server: "${guild.name}" (ID: ${guild.id}) has target underage role ID ${UNDERAGE_ROLE_ID}`);

    // 🛡️ 0. Age Verification Immunity Check (Protected Role)
    try {
        const GuildSettings = require('../database/models/GuildSettings');
        const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
        const verifiedRoleId = settings ? settings.ageVerifiedRoleId : null;

        const isRoleVerified = verifiedRoleId && member.roles && member.roles.cache && member.roles.cache.has(verifiedRoleId);

        if (isRoleVerified) {
            console.log(`[Underage Sweep] [IMMUNITY BLOCKED] User ${user.tag} (${user.id}) holds Age-Verified Protected Role (${verifiedRoleId}). Aborting kick and stripping underage role.`);

            // Automatically strip the accidental underage role
            if (member.roles.cache.has(UNDERAGE_ROLE_ID)) {
                await member.roles.remove(UNDERAGE_ROLE_ID, 'Automated Shield: Member has Age-Verified Immunity role.').catch(() => {});
            }

            // Log immunity protection to #modlog
            let logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
            if (!logChannel) logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
            if (logChannel && logChannel.isTextBased()) {
                const immunityEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Age-Verified Member Shielded from Underage Action')
                    .setColor(0x2ECC71)
                    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                    .setDescription(`User <@${user.id}> (\`${user.id}\`) is recognized as **Age Verified** with protected role <@&${verifiedRoleId}>.`)
                    .addFields(
                        { name: '👤 Member', value: `${user.tag} (\`${user.id}\`)\n<@${user.id}>`, inline: true },
                        { name: '🛡️ Protected Role', value: `<@&${verifiedRoleId}>\n\`${verifiedRoleId}\``, inline: true },
                        { name: '🛑 Shield Enforcement', value: 'Underage kick was **blocked**. Underage role was automatically removed.', inline: false }
                    )
                    .setFooter({ text: 'Nora Age Verification Shield • Complete Immunity' })
                    .setTimestamp();
                await logChannel.send({ embeds: [immunityEmbed] }).catch(() => {});
            }
            return;
        }
    } catch (immunityErr) {
        console.error('[Underage Sweep] Immunity check error:', immunityErr.message);
    }

    // 🛡️ 0.5. Check if suspension is LIFTED in database registry
    try {
        const UnderageSuspension = require('../database/models/UnderageSuspension');
        const record = await UnderageSuspension.findOne({
            where: {
                guildId: guild.id,
                userId: user.id
            }
        });

        if (record && record.status === 'lifted') {
            console.log(`[Underage Sweep] [LIFT SHIELD ACTIVE] User ${user.tag} (${user.id}) suspension is LIFTED in registry. Aborting kick and stripping underage role.`);

            // Automatically strip the underage role so they are not kicked repeatedly
            if (member.roles.cache.has(UNDERAGE_ROLE_ID)) {
                await member.roles.remove(UNDERAGE_ROLE_ID, 'Automated Shield: Underage suspension for this member has been lifted by staff.').catch(() => {});
            }

            // Log lift shield activation to #modlog
            let logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
            if (!logChannel) logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
            if (logChannel && logChannel.isTextBased()) {
                const liftEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Underage Role Stripped: Member Suspension is Lifted')
                    .setColor(0x2ECC71)
                    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                    .setDescription(`User <@${user.id}> (\`${user.id}\`) had the underage role <@&${UNDERAGE_ROLE_ID}> detected, but their suspension was **LIFTED / AGE PROVED** by staff.`)
                    .addFields(
                        { name: '👤 Member', value: `${user.tag} (\`${user.id}\`)\n<@${user.id}>`, inline: true },
                        { name: '🟢 Registry Status', value: '✅ **Lifted / Age Verified**', inline: true },
                        { name: '🛡️ Lifted By', value: record.liftedBy ? `<@${record.liftedBy}> (\`${record.liftedBy}\`)` : '*Staff / System*', inline: true },
                        { name: '📅 Lifted Date', value: record.liftedAt ? `<t:${Math.floor(new Date(record.liftedAt).getTime() / 1000)}:F>` : '*Recorded*', inline: true },
                        { name: '📝 Staff Note', value: record.staffNote || '*None recorded*', inline: false },
                        { name: '🛑 Shield Action', value: 'Underage kick was **blocked**. Underage role was automatically removed to prevent repeated kicks.', inline: false }
                    )
                    .setFooter({ text: 'Nora Underage Shield • Lift Protection Active' })
                    .setTimestamp();
                await logChannel.send({ embeds: [liftEmbed] }).catch(() => {});
            }
            return;
        }
    } catch (dbCheckErr) {
        console.error('[Underage Sweep] DB Lift check error:', dbCheckErr.message);
    }

    // 1. Send Direct Message to the user before kicking
    let dmDelivered = false;
    let dmErrorReason = null;

    try {
        console.log(`[Underage Sweep] [DM ATTEMPT] Dispatching advisory DM to ${user.tag} (${user.id})...`);
        const dmEmbed = new EmbedBuilder()
            .setTitle('⚠️ Notice: Underage Account Policy Enforcement')
            .setDescription(
                `Hello <@${user.id}>,\n\n` +
                `You have been removed from **${guild.name}** because you have been determined to be underage for Discord.\n\n` +
                `You are strongly recommended to delete Discord and refrain from using the platform until you are at least **13 years of age** in accordance with Discord Terms of Service.`
            )
            .setColor(0xff4757)
            .addFields(
                { name: 'Server', value: guild.name, inline: true },
                { name: 'Enforcement Action', value: 'Server Kick', inline: true },
                { name: 'Reason', value: 'Determined underage for Discord (Recommended minimum age: 13)', inline: false }
            )
            .setThumbnail(guild.iconURL({ dynamic: true }) || client.user.displayAvatarURL())
            .setFooter({ text: 'Discord Safety & Underage Policy Enforcement' })
            .setTimestamp();

        // Ensure DM channel is open and send
        const dmChannel = await user.createDM();
        await dmChannel.send({ embeds: [dmEmbed] });
        dmDelivered = true;
        console.log(`[Underage Sweep] [DM SUCCESS] Advisory DM successfully delivered to ${user.tag} (${user.id}). Waiting grace period before kick...`);
        
        // ⏳ Grace buffer so Discord push notification and message sync completely on user's device
        await new Promise(r => setTimeout(r, 1500));
    } catch (dmErr) {
        dmErrorReason = dmErr.message || 'Direct Messages Closed / Blocked';
        console.warn(`[Underage Sweep] [DM FAILED] Could not send DM to ${user.tag} (${user.id}): ${dmErrorReason}`);
    }

    // 2. Kick the member from the server
    let kickSuccess = false;
    let kickErrorReason = null;

    try {
        console.log(`[Underage Sweep] [KICK ATTEMPT] Attempting to kick ${user.tag} (${user.id}) from "${guild.name}"...`);
        if (!member.kickable) {
            kickErrorReason = 'Bot lacks permission or user role is higher than bot hierarchy';
            console.error(`[Underage Sweep] [KICK FAILED] Cannot kick ${user.tag} (${user.id}): ${kickErrorReason}`);
        } else {
            await member.kick('Determined to be underage for Discord policy enforcement (Recommended to delete Discord until 13)');
            kickSuccess = true;
            console.log(`[Underage Sweep] [KICK SUCCESS] Successfully kicked ${user.tag} (${user.id}) from "${guild.name}".`);

            // Record in database
            try {
                const UnderageSuspension = require('../database/models/UnderageSuspension');
                const [record, created] = await UnderageSuspension.findOrCreate({
                    where: {
                        guildId: guild.id,
                        userId: user.id
                    },
                    defaults: {
                        guildId: guild.id,
                        userId: user.id,
                        userTag: user.tag,
                        kickedAt: new Date(),
                        status: 'suspended',
                        reason: 'Determined underage for Discord (Recommended minimum age: 13)'
                    }
                });

                if (!created && record.status !== 'lifted') {
                    await record.update({
                        userTag: user.tag,
                        kickedAt: new Date(),
                        status: 'suspended'
                    });
                }
            } catch (dbErr) {
                console.error(`[Underage Sweep] [DB ERROR] Failed to save suspension record for ${user.id}:`, dbErr.message);
            }
        }
    } catch (kickErr) {
        kickErrorReason = kickErr.message || 'Unknown kick error';
        console.error(`[Underage Sweep] [KICK FAILED] Error executing kick on ${user.tag} (${user.id}):`, kickErr);
    }

    // 3. Dispatch detailed audit log embed to channel 1510677727206969625
    try {
        console.log(`[Underage Sweep] [CHANNEL LOG ATTEMPT] Fetching audit log channel ID ${LOG_CHANNEL_ID}...`);
        let logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (!logChannel) {
            logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        }

        if (logChannel && logChannel.isTextBased()) {
            const auditEmbed = new EmbedBuilder()
                .setTitle('👢 Underage Member Auto-Kicked')
                .setColor(kickSuccess ? 0xff4757 : 0xffa502)
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
                .setDescription(`An underage user with role <@&${UNDERAGE_ROLE_ID}> was detected and processed by the hourly sweep system.`)
                .addFields(
                    { name: '👤 User', value: `${user.tag} (\`${user.id}\`)\n<@${user.id}>`, inline: true },
                    { name: '🏰 Server', value: `${guild.name}\n\`${guild.id}\``, inline: true },
                    { name: '🏷️ Role Triggered', value: `<@&${UNDERAGE_ROLE_ID}>\n\`${UNDERAGE_ROLE_ID}\``, inline: true },
                    { name: '📨 DM Delivery', value: dmDelivered ? '✅ **Delivered**' : `⚠️ **Failed** (\`${dmErrorReason}\`)`, inline: true },
                    { name: '👢 Kick Status', value: kickSuccess ? '✅ **Kicked Successfully**' : `❌ **Failed** (\`${kickErrorReason}\`)`, inline: true },
                    { name: '📋 Policy Action', value: 'Kicked (Underage for Discord - Advised to delete until 13)', inline: false },
                    { name: '📅 Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)`, inline: true },
                    { name: '📥 Joined Server', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)` : '*Unknown*', inline: true }
                )
                .setFooter({ text: `Nora Underage Sweep Engine • Role: ${UNDERAGE_ROLE_ID}` })
                .setTimestamp();

            await logChannel.send({ embeds: [auditEmbed] });
            console.log(`[Underage Sweep] [CHANNEL LOG SUCCESS] Audit log dispatched to channel #${logChannel.name} (${logChannel.id}) for user ${user.tag}.`);
        } else {
            console.warn(`[Underage Sweep] [CHANNEL LOG FAILED] Target audit channel ID ${LOG_CHANNEL_ID} was not found or is not a text channel.`);
        }
    } catch (logErr) {
        console.error(`[Underage Sweep] [CHANNEL LOG ERROR] Failed to send audit embed to channel ${LOG_CHANNEL_ID}:`, logErr);
    }
}

let isSweepRunning = false;

/**
 * Execute a sweep across all guilds looking for members with the underage role.
 * @param {import('discord.js').Client} client
 */
async function runUnderageSweep(client) {
    if (!client || !client.isReady()) {
        console.log('[Underage Sweep] [SWEEP SKIP] Bot client is not ready yet.');
        return;
    }

    if (isSweepRunning) {
        console.log('[Underage Sweep] [SWEEP SKIP] A sweep is already actively running. Skipping concurrent request.');
        return { totalFound: 0, totalKicked: 0, error: 'Sweep in progress' };
    }
    isSweepRunning = true;

    console.log(`[Underage Sweep] [SWEEP START] Initiating sweep for server ID ${TARGET_GUILD_ID}, role ID ${UNDERAGE_ROLE_ID}, log channel ${LOG_CHANNEL_ID}...`);
    let totalFound = 0;
    let totalKicked = 0;

    try {
        let guild = client.guilds.cache.get(TARGET_GUILD_ID);
        if (!guild) {
            guild = await client.guilds.fetch(TARGET_GUILD_ID).catch(() => null);
        }

        if (!guild) {
            console.error(`[Underage Sweep] [ERROR] Target guild ID ${TARGET_GUILD_ID} not found in bot cache or via fetch.`);
            return { totalFound: 0, totalKicked: 0, error: 'Guild not found' };
        }

        console.log(`[Underage Sweep] [GUILD TARGETED] Target server "${guild.name}" (${guild.id}) located. Fetching roles & members...`);

        // Fetch roles
        let roles = guild.roles.cache;
        try {
            roles = await guild.roles.fetch();
        } catch (e) {}

        const targetRole = roles.get(UNDERAGE_ROLE_ID);
        if (!targetRole) {
            console.warn(`[Underage Sweep] [ROLE NOT FOUND] Role ID ${UNDERAGE_ROLE_ID} was NOT found in guild "${guild.name}". Available roles:`, roles.map(r => `${r.name} (${r.id})`).slice(0, 15));
            return { totalFound: 0, totalKicked: 0, error: 'Role not found' };
        }

        console.log(`[Underage Sweep] [ROLE LOCATED] Found target role "${targetRole.name}" (${targetRole.id}) in guild "${guild.name}". Force-fetching members...`);

        // Force fetch all members
        let members;
        try {
            members = await guild.members.fetch({ force: true });
        } catch (err) {
            console.warn(`[Underage Sweep] Failed to force-fetch members: ${err.message}. Using cache.`);
            members = guild.members.cache;
        }

        const matchingMembers = members.filter(m => m.roles && m.roles.cache && m.roles.cache.has(UNDERAGE_ROLE_ID));
        console.log(`[Underage Sweep] Guild "${guild.name}" (${guild.id}): Scanned ${members.size} members -> Found ${matchingMembers.size} member(s) with role "${targetRole.name}".`);

        for (const [memberId, member] of matchingMembers) {
            totalFound++;
            await processUnderageMember(member, client);
            totalKicked++;
            // Small pause between kicks to prevent rate limits
            await new Promise(r => setTimeout(r, 800));
        }
    } catch (guildErr) {
        console.error(`[Underage Sweep] Error executing sweep:`, guildErr);
    } finally {
        isSweepRunning = false;
    }

    console.log(`[Underage Sweep] [SWEEP COMPLETE] Scan finished. Target members found: ${totalFound}, processed: ${totalKicked}.`);
    return { totalFound, totalKicked, timestamp: new Date().toISOString() };
}

/**
 * Helper to parse an audit log embed into a structured underage event.
 */
function extractEventFromEmbed(embed, msgDate) {
    if (!embed) return null;
    const title = embed.title || '';
    const desc = embed.description || '';
    const lowerTitle = title.toLowerCase();
    const lowerDesc = desc.toLowerCase();

    const isLift = (
        lowerTitle.includes('lifted') ||
        lowerTitle.includes('age-verified') ||
        lowerTitle.includes('age verified') ||
        lowerDesc.includes('lifted the underage suspension') ||
        lowerDesc.includes('suspension has been lifted') ||
        (lowerDesc.includes('suspension for') && lowerDesc.includes('lifted')) ||
        lowerDesc.includes('granted complete underage protection') ||
        lowerTitle.includes('granted age-verified')
    );

    const isKick = (
        lowerTitle.includes('auto-kicked') ||
        lowerTitle.includes('manually added') ||
        lowerTitle.includes('added & suspended') ||
        lowerDesc.includes('underage user with role') ||
        lowerDesc.includes('determined to be underage') ||
        (lowerTitle.includes('underage') && !isLift)
    );

    if (!isLift && !isKick) return null;

    // Extract User ID & Tag
    let userId = null;
    let userTag = null;

    if (embed.fields && embed.fields.length > 0) {
        for (const field of embed.fields) {
            const fName = (field.name || '').toLowerCase();
            const fVal = field.value || '';
            if (fName.includes('user') || fName.includes('member') || fName.includes('target')) {
                const idMatch = fVal.match(/`(\d{17,20})`/) || fVal.match(/<@!?(\d{17,20})>/) || fVal.match(/\b(\d{17,20})\b/);
                if (idMatch && !userId) userId = idMatch[1];

                const tagMatch = fVal.match(/^([^`\n(<]+)/);
                if (tagMatch && !userTag) {
                    const candidate = tagMatch[1].trim();
                    if (candidate && !candidate.startsWith('<@')) userTag = candidate;
                }
            }
        }
    }

    if (!userId && desc) {
        const idMatch = desc.match(/<@!?(\d{17,20})>/) || desc.match(/`(\d{17,20})`/);
        if (idMatch) userId = idMatch[1];
    }

    if (!userId && embed.thumbnail && embed.thumbnail.url) {
        const avatarMatch = embed.thumbnail.url.match(/avatars\/(\d{17,20})\//);
        if (avatarMatch) userId = avatarMatch[1];
    }

    if (!userId) return null;

    // Extract Moderator
    let moderatorId = null;
    if (embed.fields) {
        const modField = embed.fields.find(f => {
            const n = (f.name || '').toLowerCase();
            return n.includes('moderator') || n.includes('verified by') || n.includes('staff') || n.includes('lifted by');
        });
        if (modField) {
            const modMatch = modField.value.match(/<@!?(\d{17,20})>/) || modField.value.match(/`(\d{17,20})`/);
            if (modMatch) moderatorId = modMatch[1];
        }
    }

    // Extract Staff Note
    let staffNote = null;
    if (embed.fields) {
        const noteField = embed.fields.find(f => {
            const n = (f.name || '').toLowerCase();
            return n.includes('note') || n.includes('staff note');
        });
        if (noteField && noteField.value && !noteField.value.includes('*None*') && !noteField.value.includes('*No specific note*')) {
            staffNote = noteField.value.trim();
        }
    }

    // Extract Reason
    let reason = null;
    if (embed.fields) {
        const reasonField = embed.fields.find(f => (f.name || '').toLowerCase().includes('reason'));
        if (reasonField && reasonField.value) {
            reason = reasonField.value.trim();
        }
    }

    // Extract Invite URL & Delivery
    let inviteUrl = null;
    let inviteSent = false;
    if (embed.fields) {
        const inviteField = embed.fields.find(f => {
            const n = (f.name || '').toLowerCase();
            return n.includes('invite') || n.includes('direct message');
        });
        if (inviteField && inviteField.value) {
            const urlMatch = inviteField.value.match(/(https?:\/\/[^\s\)]+)/);
            if (urlMatch) {
                inviteUrl = urlMatch[1];
                inviteSent = true;
            } else if (inviteField.value.includes('Delivered') || inviteField.value.includes('Sent Successfully')) {
                inviteSent = true;
            }
        }
    }

    const timestamp = embed.timestamp ? new Date(embed.timestamp) : msgDate;

    return {
        type: isLift ? 'LIFT' : 'SUSPEND',
        userId,
        userTag: userTag || `User_${userId}`,
        timestamp,
        moderatorId,
        staffNote,
        reason: reason || 'Determined underage for Discord (Recommended minimum age: 13)',
        inviteUrl,
        inviteSent
    };
}

/**
 * Retroactively sync and backfill ALL past underage kick and lift logs from the audit channel into the database.
 * Accurately determines the latest state (suspended vs lifted) for each user.
 * @param {import('discord.js').Client} client
 */
async function syncPastUnderageKicks(client) {
    if (!client || !client.isReady()) return { suspensions: 0, lifts: 0, total: 0, newlyAdded: 0, updated: 0 };
    const UnderageSuspension = require('../database/models/UnderageSuspension');

    try {
        let logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (!logChannel) {
            logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        }

        if (!logChannel || !logChannel.isTextBased()) {
            return { suspensions: 0, lifts: 0, total: 0, newlyAdded: 0, updated: 0 };
        }

        let lastId = null;
        let keepFetching = true;
        const allEvents = [];

        while (keepFetching) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await logChannel.messages.fetch(options).catch(() => null);
            if (!messages || messages.size === 0) {
                keepFetching = false;
                break;
            }

            lastId = messages.last().id;

            for (const msg of messages.values()) {
                if (msg.embeds && msg.embeds.length > 0) {
                    for (const embed of msg.embeds) {
                        const event = extractEventFromEmbed(embed, msg.createdAt || new Date());
                        if (event) {
                            allEvents.push(event);
                        }
                    }
                }
            }

            if (messages.size < 100) keepFetching = false;
        }

        // Sort events chronologically: oldest to newest
        allEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        // Group by user ID and determine the latest state + history
        const userStateMap = new Map();
        for (const ev of allEvents) {
            if (!userStateMap.has(ev.userId)) {
                userStateMap.set(ev.userId, {
                    userId: ev.userId,
                    userTag: ev.userTag,
                    firstSuspendedAt: ev.type === 'SUSPEND' ? ev.timestamp : null,
                    kickedAt: ev.type === 'SUSPEND' ? ev.timestamp : null,
                    status: ev.type === 'LIFT' ? 'lifted' : 'suspended',
                    liftedAt: ev.type === 'LIFT' ? ev.timestamp : null,
                    liftedBy: ev.type === 'LIFT' ? ev.moderatorId : null,
                    staffNote: ev.staffNote,
                    reason: ev.reason,
                    inviteUrl: ev.inviteUrl,
                    inviteSent: ev.inviteSent
                });
            } else {
                const state = userStateMap.get(ev.userId);
                if (ev.userTag && (!state.userTag || state.userTag.startsWith('User_'))) {
                    state.userTag = ev.userTag;
                }
                if (ev.type === 'SUSPEND') {
                    state.status = 'suspended';
                    state.kickedAt = ev.timestamp;
                    if (ev.reason) state.reason = ev.reason;
                    if (ev.staffNote) state.staffNote = ev.staffNote;
                } else if (ev.type === 'LIFT') {
                    state.status = 'lifted';
                    state.liftedAt = ev.timestamp;
                    if (ev.moderatorId) state.liftedBy = ev.moderatorId;
                    if (ev.staffNote) state.staffNote = ev.staffNote;
                    if (ev.inviteUrl) state.inviteUrl = ev.inviteUrl;
                    if (ev.inviteSent) state.inviteSent = ev.inviteSent;
                }
            }
        }

        let newlyAdded = 0;
        let updated = 0;
        let suspensionsCount = 0;
        let liftsCount = 0;

        for (const [userId, state] of userStateMap.entries()) {
            if (state.status === 'lifted') liftsCount++;
            else suspensionsCount++;

            const [rec, created] = await UnderageSuspension.findOrCreate({
                where: {
                    guildId: TARGET_GUILD_ID,
                    userId: userId
                },
                defaults: {
                    guildId: TARGET_GUILD_ID,
                    userId: userId,
                    userTag: state.userTag || `User_${userId}`,
                    kickedAt: state.kickedAt || state.firstSuspendedAt || new Date(),
                    status: state.status,
                    liftedAt: state.liftedAt,
                    liftedBy: state.liftedBy,
                    staffNote: state.staffNote,
                    reason: state.reason || 'Determined underage for Discord (Recommended minimum age: 13)',
                    inviteUrl: state.inviteUrl,
                    inviteSent: state.inviteSent || false
                }
            });

            if (created) {
                newlyAdded++;
            } else {
                await rec.update({
                    userTag: state.userTag || rec.userTag,
                    status: state.status,
                    kickedAt: state.kickedAt || rec.kickedAt,
                    liftedAt: state.liftedAt || rec.liftedAt,
                    liftedBy: state.liftedBy || rec.liftedBy,
                    staffNote: state.staffNote || rec.staffNote,
                    reason: state.reason || rec.reason,
                    inviteUrl: state.inviteUrl || rec.inviteUrl,
                    inviteSent: state.inviteSent !== undefined ? state.inviteSent : rec.inviteSent
                });
                updated++;
            }
        }

        console.log(`[Underage Sweep] Synchronized ${userStateMap.size} user records: ${suspensionsCount} active suspensions, ${liftsCount} lifted suspensions (${newlyAdded} newly registered, ${updated} updated).`);

        return {
            total: userStateMap.size,
            suspensions: suspensionsCount,
            lifts: liftsCount,
            newlyAdded,
            updated
        };
    } catch (err) {
        console.error('[Underage Sweep] Error during sync:', err);
        return { suspensions: 0, lifts: 0, total: 0, newlyAdded: 0, updated: 0, error: err.message };
    }
}

/**
 * Initialize the hourly underage sweep scheduler.
 * @param {import('discord.js').Client} client
 */
function startUnderageSweepScheduler(client) {
    console.log(`[Underage Sweep] Initializing Underage Sweep Scheduler (Interval: 1 hour / ${SWEEP_INTERVAL_MS}ms, Target Role: ${UNDERAGE_ROLE_ID}, Log Channel: ${LOG_CHANNEL_ID})...`);

    // Initial audit log sync and sweep after 5 seconds
    setTimeout(() => {
        syncPastUnderageKicks(client).catch(() => {});
        runUnderageSweep(client).catch(err => {
            console.error('[Underage Sweep] Initial startup sweep error:', err);
        });
    }, 5000);

    // Schedule hourly recurring sweep
    const interval = setInterval(() => {
        runUnderageSweep(client).catch(err => {
            console.error('[Underage Sweep] Hourly recurring sweep error:', err);
        });
    }, SWEEP_INTERVAL_MS);

    return interval;
}

module.exports = {
    UNDERAGE_ROLE_ID,
    LOG_CHANNEL_ID,
    processUnderageMember,
    runUnderageSweep,
    syncPastUnderageKicks,
    startUnderageSweepScheduler
};
