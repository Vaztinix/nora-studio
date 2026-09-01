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

/**
 * Execute a sweep across all guilds looking for members with the underage role.
 * @param {import('discord.js').Client} client
 */
async function runUnderageSweep(client) {
    if (!client || !client.isReady()) {
        console.log('[Underage Sweep] [SWEEP SKIP] Bot client is not ready yet.');
        return;
    }

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
    }

    console.log(`[Underage Sweep] [SWEEP COMPLETE] Scan finished. Target members found: ${totalFound}, processed: ${totalKicked}.`);
    return { totalFound, totalKicked, timestamp: new Date().toISOString() };
}

/**
 * Initialize the hourly underage sweep scheduler.
 * @param {import('discord.js').Client} client
 */
function startUnderageSweepScheduler(client) {
    console.log(`[Underage Sweep] Initializing Underage Sweep Scheduler (Interval: 1 hour / ${SWEEP_INTERVAL_MS}ms, Target Role: ${UNDERAGE_ROLE_ID}, Log Channel: ${LOG_CHANNEL_ID})...`);

    // Initial check after 10 seconds to allow bot caches to warm up
    setTimeout(() => {
        runUnderageSweep(client).catch(err => {
            console.error('[Underage Sweep] Initial startup sweep error:', err);
        });
    }, 10000);

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
    startUnderageSweepScheduler
};
