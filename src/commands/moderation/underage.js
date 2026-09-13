const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ChannelType 
} = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const UnderageSuspension = require('../../database/models/UnderageSuspension');

const TARGET_GUILD_ID = '1487342521133830174';
const LOG_CHANNEL_ID = '1510677727206969625';

/**
 * Resolve target user object or ID from options.
 */
async function resolveTargetUser(interaction) {
    let user = interaction.options.getUser('user');
    const userIdInput = interaction.options.getString('user_id');

    if (!user && userIdInput) {
        const cleanId = userIdInput.trim().replace(/[<@!>]/g, '');
        if (/^\d{17,20}$/.test(cleanId)) {
            user = await interaction.client.users.fetch(cleanId).catch(() => null);
            if (!user) {
                return { id: cleanId, tag: `User (${cleanId})`, isRawId: true };
            }
        }
    }
    return user;
}

/**
 * Find the best text channel to create a permanent or valid invite.
 */
async function getInviteChannel(guild) {
    if (guild.rulesChannel) return guild.rulesChannel;
    if (guild.systemChannel) return guild.systemChannel;
    
    // Find first accessible text channel
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    const textChannel = channels.find(c => 
        c && 
        c.type === ChannelType.GuildText && 
        c.permissionsFor(guild.members.me).has(PermissionFlagsBits.CreateInstantInvite)
    );
    return textChannel || null;
}

module.exports = {
    category: 'moderation',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('underage')
        .setDescription('Manage underage suspensions, age verification, wait timers, and invite pardons.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        // Subcommand: LIST
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View all suspended users and their remaining wait times.')
                .addStringOption(opt =>
                    opt.setName('status')
                        .setDescription('Filter by suspension status')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Active Suspensions (Default)', value: 'suspended' },
                            { name: 'Lifted / Age Proved', value: 'lifted' },
                            { name: 'All Records', value: 'all' }
                        )
                )
        )
        // Subcommand: VIEW / LOOKUP
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View detailed suspension file and wait time for a specific user.')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Select user (if visible)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('user_id')
                        .setDescription('Enter Discord User ID (if user left/kicked)')
                        .setRequired(false)
                )
        )
        // Subcommand: LIFT / PROVE-AGE
        .addSubcommand(sub =>
            sub.setName('lift')
                .setDescription('Manually remove suspension, record age proof, and dispatch server invite.')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Select user whose suspension to lift')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('user_id')
                        .setDescription('Target User ID (if not mentioning)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('note')
                        .setDescription('Staff note (e.g. Proved age via ID on ticket #123)')
                        .setRequired(false)
                )
                .addBooleanOption(opt =>
                    opt.setName('send_invite')
                        .setDescription('Send a server invite and notice to their DM? (Default: True)')
                        .setRequired(false)
                )
        )
        // Subcommand: NOTE
        .addSubcommand(sub =>
            sub.setName('note')
                .setDescription('Add or update a staff note on an underage suspension record.')
                .addStringOption(opt =>
                    opt.setName('note')
                        .setDescription('Staff note content')
                        .setRequired(true)
                )
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Target user')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('user_id')
                        .setDescription('Target User ID')
                        .setRequired(false)
                )
        )
        // Subcommand: SETWAIT
        .addSubcommand(sub =>
            sub.setName('setwait')
                .setDescription('Set or update how long the user has to wait until eligible to rejoin (e.g. Turns 13).')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Target user')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('user_id')
                        .setDescription('Target User ID')
                        .setRequired(false)
                )
                .addIntegerOption(opt =>
                    opt.setName('days')
                        .setDescription('Wait duration in days')
                        .setRequired(false)
                        .setMinValue(1)
                )
                .addIntegerOption(opt =>
                    opt.setName('months')
                        .setDescription('Wait duration in months')
                        .setRequired(false)
                        .setMinValue(1)
                )
                .addIntegerOption(opt =>
                    opt.setName('years')
                        .setDescription('Wait duration in years')
                        .setRequired(false)
                        .setMinValue(1)
                )
                .addStringOption(opt =>
                    opt.setName('note')
                        .setDescription('Optional note on wait duration')
                        .setRequired(false)
                )
        )
        // Subcommand: SYNC
        .addSubcommand(sub =>
            sub.setName('sync')
                .setDescription('Scan audit channels and synchronize past underage kicks into the registry.')
        )
        // Subcommand: ADD
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Manually add an underage user to the suspension registry (with optional kick & timer).')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Select user to suspend')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('user_id')
                        .setDescription('Target User ID (if not mentioning)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason for suspension (default: Determined underage for Discord)')
                        .setRequired(false)
                )
                .addBooleanOption(opt =>
                    opt.setName('kick')
                        .setDescription('Kick member from the server if currently in server? (Default: True)')
                        .setRequired(false)
                )
                .addIntegerOption(opt =>
                    opt.setName('days')
                        .setDescription('Wait duration in days until age 13')
                        .setRequired(false)
                        .setMinValue(1)
                )
                .addIntegerOption(opt =>
                    opt.setName('months')
                        .setDescription('Wait duration in months until age 13')
                        .setRequired(false)
                        .setMinValue(1)
                )
                .addIntegerOption(opt =>
                    opt.setName('years')
                        .setDescription('Wait duration in years until age 13')
                        .setRequired(false)
                        .setMinValue(1)
                )
                .addStringOption(opt =>
                    opt.setName('note')
                        .setDescription('Staff note to attach')
                        .setRequired(false)
                )
        )
        // Subcommand: SETROLE
        .addSubcommand(sub =>
            sub.setName('setrole')
                .setDescription('Configure the Age-Verified role that grants immunity from underage enforcement.')
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('The Age-Verified protected role')
                        .setRequired(true)
                )
        )
        // Subcommand: VERIFY
        .addSubcommand(sub =>
            sub.setName('verify')
                .setDescription('Assign the Age-Verified role to a member and grant total immunity.')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Member to verify')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('note')
                        .setDescription('Staff verification note')
                        .setRequired(false)
                )
        )
        // Subcommand: UNVERIFY
        .addSubcommand(sub =>
            sub.setName('unverify')
                .setDescription('Revoke the Age-Verified role from a member.')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Member to unverify')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason for revoking verification')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        // 1. Strict Server Check
        if (interaction.guildId !== TARGET_GUILD_ID) {
            return handleError(interaction, 'Server Restricted', `This command is exclusively configured for server \`${TARGET_GUILD_ID}\`.`);
        }

        // 2. Staff Permission Check (Minimum: Mute / Moderate Members)
        const hasStaffPerms = interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers) || 
                              interaction.member.permissions.has(PermissionFlagsBits.MuteMembers);
        if (!hasStaffPerms) {
            return handleError(interaction, 'Permission Denied', 'You need minimum staff permissions (Mute / Moderate Members) to use this command.');
        }

        const subcommand = interaction.options.getSubcommand();

        // -------------------------------------------------------------
        // Subcommand: SYNC
        // -------------------------------------------------------------
        if (subcommand === 'sync') {
            const { syncPastUnderageKicks } = require('../../utils/underageSweep');
            const syncedCount = await syncPastUnderageKicks(interaction.client);
            const totalInDb = await UnderageSuspension.count({ where: { guildId: TARGET_GUILD_ID } });

            const syncEmbed = new EmbedBuilder()
                .setTitle('🔄 Underage Registry Synchronized')
                .setColor(0x2ECC71)
                .setDescription(`Successfully scanned modlogs and synchronized past kicks into the database registry.`)
                .addFields(
                    { name: '✨ Newly Added', value: `${syncedCount} records`, inline: true },
                    { name: '📊 Total Suspensions Tracked', value: `${totalInDb} records`, inline: true }
                )
                .setFooter({ text: `Nora Underage Registry • ${interaction.guild.name}` })
                .setTimestamp();

            return interaction.editReply({ embeds: [syncEmbed] });
        }

        // -------------------------------------------------------------
        // Subcommand: LIST
        // -------------------------------------------------------------
        if (subcommand === 'list') {
            const statusFilter = interaction.options.getString('status') || 'suspended';
            const whereClause = { guildId: TARGET_GUILD_ID };
            if (statusFilter !== 'all') {
                whereClause.status = statusFilter;
            }

            let records = await UnderageSuspension.findAll({
                where: whereClause,
                order: [['kickedAt', 'DESC']]
            });

            // If empty, auto-sync past logs once just in case
            if (!records || records.length === 0) {
                const { syncPastUnderageKicks } = require('../../utils/underageSweep');
                await syncPastUnderageKicks(interaction.client);
                records = await UnderageSuspension.findAll({
                    where: whereClause,
                    order: [['kickedAt', 'DESC']]
                });
            }

            if (!records || records.length === 0) {
                const emptyEmbed = new EmbedBuilder()
                    .setTitle('📋 Underage Suspensions Registry')
                    .setDescription(`No records found for filter: **${statusFilter === 'all' ? 'All' : (statusFilter === 'suspended' ? 'Active Suspensions' : 'Lifted / Age Proved')}**.`)
                    .setColor(0x5865F2)
                    .setFooter({ text: `Target Server: ${interaction.guild.name}` })
                    .setTimestamp();
                return interaction.editReply({ embeds: [emptyEmbed] });
            }

            const pageSize = 5;
            const totalPages = Math.ceil(records.length / pageSize);
            let currentPage = 0;

            const generateEmbed = (page) => {
                const start = page * pageSize;
                const pageRecords = records.slice(start, start + pageSize);

                const embed = new EmbedBuilder()
                    .setTitle(`📋 Underage Suspensions (${records.length} Total)`)
                    .setDescription(`Displaying records for filter: **${statusFilter === 'all' ? 'All Records' : (statusFilter === 'suspended' ? 'Active Suspensions' : 'Lifted / Age Proved')}**.\nPage **${page + 1}** of **${totalPages}**`)
                    .setColor(0x3498DB)
                    .setFooter({ text: `Nora Underage Suspension Registry • Page ${page + 1}/${totalPages}` })
                    .setTimestamp();

                for (const rec of pageRecords) {
                    const kickedSec = rec.kickedAt ? Math.floor(new Date(rec.kickedAt).getTime() / 1000) : null;
                    const eligibleSec = rec.rejoinEligibleAt ? Math.floor(new Date(rec.rejoinEligibleAt).getTime() / 1000) : null;
                    
                    let waitStatus = '⏳ **Indefinite (Until Age 13 or Proof)**';
                    if (rec.rejoinEligibleAt) {
                        const nowSec = Math.floor(Date.now() / 1000);
                        if (eligibleSec > nowSec) {
                            waitStatus = `⏳ **Eligible to rejoin <t:${eligibleSec}:R>** (<t:${eligibleSec}:D>)`;
                        } else {
                            waitStatus = `✅ **Wait Completed on <t:${eligibleSec}:D>** (Eligible upon age proof)`;
                        }
                    }

                    const statusBadge = rec.status === 'lifted' 
                        ? '🟢 **Lifted / Age Verified**' 
                        : '🔴 **Suspended (Underage)**';

                    const noteText = rec.staffNote 
                        ? (rec.staffNote.length > 80 ? rec.staffNote.substring(0, 77) + '...' : rec.staffNote)
                        : '*None*';

                    embed.addFields({
                        name: `👤 ${rec.userTag || 'Unknown User'} (\`${rec.userId}\`)`,
                        value: 
                            `• **Status**: ${statusBadge}\n` +
                            `• **Kicked**: ${kickedSec ? `<t:${kickedSec}:F> (<t:${kickedSec}:R>)` : '*Unknown*'}\n` +
                            `• **Rejoin Wait**: ${waitStatus}\n` +
                            `• **Staff Note**: ${noteText}`,
                        inline: false
                    });
                }
                return embed;
            };

            const generateButtons = (page) => {
                return new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('prev_page')
                        .setLabel('◀ Previous')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(page === 0),
                    new ButtonBuilder()
                        .setCustomId('next_page')
                        .setLabel('Next ▶')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(page >= totalPages - 1)
                );
            };

            const replyMsg = await interaction.editReply({
                embeds: [generateEmbed(currentPage)],
                components: totalPages > 1 ? [generateButtons(currentPage)] : []
            });

            if (totalPages > 1) {
                const collector = replyMsg.createMessageComponentCollector({
                    filter: i => i.user.id === interaction.user.id,
                    time: 120000
                });

                collector.on('collect', async i => {
                    if (i.customId === 'prev_page' && currentPage > 0) {
                        currentPage--;
                    } else if (i.customId === 'next_page' && currentPage < totalPages - 1) {
                        currentPage++;
                    }
                    await i.update({
                        embeds: [generateEmbed(currentPage)],
                        components: [generateButtons(currentPage)]
                    }).catch(() => {});
                });

                collector.on('end', async () => {
                    await interaction.editReply({
                        components: []
                    }).catch(() => {});
                });
            }
            return;
        }

        // -------------------------------------------------------------
        // Subcommand: VIEW / LOOKUP
        // -------------------------------------------------------------
        if (subcommand === 'view') {
            const target = await resolveTargetUser(interaction);
            if (!target) {
                return handleError(interaction, 'User Required', 'Please select a user or provide a valid Discord User ID.');
            }

            const record = await UnderageSuspension.findOne({
                where: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id
                }
            });

            if (!record) {
                return handleError(interaction, 'Record Not Found', `No underage suspension record found for user <@${target.id}> (\`${target.id}\`).`);
            }

            const kickedSec = record.kickedAt ? Math.floor(new Date(record.kickedAt).getTime() / 1000) : null;
            const eligibleSec = record.rejoinEligibleAt ? Math.floor(new Date(record.rejoinEligibleAt).getTime() / 1000) : null;
            const liftedSec = record.liftedAt ? Math.floor(new Date(record.liftedAt).getTime() / 1000) : null;

            let waitDetail = '⏳ **Indefinite (Must prove age 13+ to staff)**';
            if (record.rejoinEligibleAt) {
                const nowSec = Math.floor(Date.now() / 1000);
                if (eligibleSec > nowSec) {
                    waitDetail = `⏳ **Must wait until <t:${eligibleSec}:F>** (<t:${eligibleSec}:R>)`;
                } else {
                    waitDetail = `✅ **Wait Time Completed on <t:${eligibleSec}:D>** (Age eligible, requires staff unban/invite)`;
                }
            }

            const viewEmbed = new EmbedBuilder()
                .setTitle(`📁 Underage Suspension Dossier: ${record.userTag || target.tag || target.id}`)
                .setColor(record.status === 'lifted' ? 0x2ECC71 : 0xE74C3C)
                .setThumbnail(target.displayAvatarURL ? target.displayAvatarURL({ dynamic: true, size: 256 }) : null)
                .addFields(
                    { name: '👤 Target User', value: `<@${target.id}>\n\`${target.id}\` (${record.userTag || target.tag || 'Unknown'})`, inline: true },
                    { name: '📋 Status', value: record.status === 'lifted' ? '🟢 **Lifted / Age Verified**' : '🔴 **Active Suspension**', inline: true },
                    { name: '👢 Kicked Timestamp', value: kickedSec ? `<t:${kickedSec}:F>\n(<t:${kickedSec}:R>)` : '*Not recorded*', inline: true },
                    { name: '⏳ Rejoin Eligibility / Wait Duration', value: waitDetail, inline: false },
                    { name: '📝 Staff Note', value: record.staffNote || '*No staff note recorded.*', inline: false }
                );

            if (record.status === 'lifted') {
                viewEmbed.addFields(
                    { name: '🛡️ Lifted By', value: record.liftedBy ? `<@${record.liftedBy}> (\`${record.liftedBy}\`)` : '*System/Staff*', inline: true },
                    { name: '📅 Lifted Date', value: liftedSec ? `<t:${liftedSec}:F> (<t:${liftedSec}:R>)` : '*Unknown*', inline: true },
                    { name: '📨 Invite Dispatched', value: record.inviteSent ? `✅ **Yes** ([Invite URL](${record.inviteUrl || '#'}))` : '❌ **No / Direct Messages Closed**', inline: true }
                );
            }

            viewEmbed.setFooter({ text: `Underage Policy Dossier • Guild ID ${TARGET_GUILD_ID}` }).setTimestamp();
            return interaction.editReply({ embeds: [viewEmbed] });
        }

        // -------------------------------------------------------------
        // Subcommand: LIFT / PROVE-AGE
        // -------------------------------------------------------------
        if (subcommand === 'lift') {
            const target = await resolveTargetUser(interaction);
            if (!target) {
                return handleError(interaction, 'User Required', 'Please select a user or specify a valid Discord User ID.');
            }

            const staffNoteInput = interaction.options.getString('note');
            const shouldSendInvite = interaction.options.getBoolean('send_invite') !== false;

            // Fetch or create record
            let [record, created] = await UnderageSuspension.findOrCreate({
                where: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id
                },
                defaults: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id,
                    userTag: target.tag || `User_${target.id}`,
                    kickedAt: new Date(),
                    status: 'suspended'
                }
            });

            // Prepare note
            let combinedNote = record.staffNote || '';
            if (staffNoteInput) {
                combinedNote = combinedNote 
                    ? `${combinedNote}\n[Lift Note by ${interaction.user.tag} on ${new Date().toISOString().split('T')[0]}]: ${staffNoteInput}`
                    : staffNoteInput;
            }

            // Check and remove any active server ban if present so invite link works immediately
            try {
                const existingBan = await interaction.guild.bans.fetch(target.id).catch(() => null);
                if (existingBan) {
                    await interaction.guild.bans.remove(target.id, `Underage suspension lifted by ${interaction.user.tag} (Age Verified)`);
                }
            } catch (banErr) {
                console.warn('[Underage Lift] Ban lookup/removal check:', banErr.message);
            }

            // Generate Invite & Send DM if enabled
            let inviteObj = null;
            let dmDelivered = false;
            let dmFailReason = null;

            if (shouldSendInvite) {
                const inviteChannel = await getInviteChannel(interaction.guild);
                if (inviteChannel) {
                    try {
                        inviteObj = await inviteChannel.createInvite({
                            maxAge: 604800, // 7 days
                            maxUses: 1,
                            unique: true,
                            reason: `Underage suspension lifted by staff member ${interaction.user.tag} (Age Verified)`
                        });
                    } catch (invErr) {
                        console.error('[Underage Lift] Failed to generate server invite:', invErr.message);
                    }
                }

                // Attempt to dispatch DM
                if (inviteObj) {
                    try {
                        const targetUserObj = target.send ? target : await interaction.client.users.fetch(target.id).catch(() => null);
                        if (targetUserObj) {
                            const dmEmbed = new EmbedBuilder()
                                .setTitle('🎉 Underage Suspension Lifted — Age Verified')
                                .setColor(0x2ECC71)
                                .setDescription(
                                    `Hello <@${target.id}>,\n\n` +
                                    `Your underage suspension from **${interaction.guild.name}** has been lifted!\n\n` +
                                    `You have successfully proved your age to our staff team and are cleared to rejoin the server.`
                                )
                                .addFields(
                                    { name: '🏰 Server', value: interaction.guild.name, inline: true },
                                    { name: '🛡️ Verified By', value: `${interaction.user.tag}`, inline: true },
                                    { name: '📋 Verification Status', value: '✅ **Age Verified & Cleared**', inline: true },
                                    { name: '📝 Staff Note', value: staffNoteInput || 'Age confirmed 13+ by moderation team.', inline: false },
                                    { name: '🔗 Server Rejoin Link', value: `[Click Here to Rejoin **${interaction.guild.name}**](${inviteObj.url})\n*(Invite valid for 7 days / single use)*`, inline: false }
                                )
                                .setThumbnail(interaction.guild.iconURL({ dynamic: true }) || interaction.client.user.displayAvatarURL())
                                .setFooter({ text: `${interaction.guild.name} Staff Moderation` })
                                .setTimestamp();

                            const dmRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setLabel('Rejoin Server')
                                    .setStyle(ButtonStyle.Link)
                                    .setURL(inviteObj.url)
                            );

                            await targetUserObj.send({ embeds: [dmEmbed], components: [dmRow] });
                            dmDelivered = true;
                        } else {
                            dmFailReason = 'Could not fetch user object for DM.';
                        }
                    } catch (dmErr) {
                        dmFailReason = dmErr.message || 'Direct Messages Disabled / Blocked by User';
                    }
                } else {
                    dmFailReason = 'Could not generate invite (missing permissions or suitable channel).';
                }
            }

            // Update Database record
            await record.update({
                status: 'lifted',
                liftedBy: interaction.user.id,
                liftedAt: new Date(),
                staffNote: combinedNote || 'Suspension lifted: Age successfully proved.',
                inviteSent: dmDelivered,
                inviteUrl: inviteObj ? inviteObj.url : record.inviteUrl
            });

            // Dispatch Audit Log to 1510677727206969625
            try {
                let logChannel = interaction.client.channels.cache.get(LOG_CHANNEL_ID);
                if (!logChannel) {
                    logChannel = await interaction.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                }

                if (logChannel && logChannel.isTextBased()) {
                    const auditEmbed = new EmbedBuilder()
                        .setTitle('🟢 Underage Suspension Lifted (Age Proved)')
                        .setColor(0x2ECC71)
                        .setThumbnail(target.displayAvatarURL ? target.displayAvatarURL({ dynamic: true }) : null)
                        .setDescription(`Staff member <@${interaction.user.id}> has lifted the underage suspension for <@${target.id}>.`)
                        .addFields(
                            { name: '👤 Target User', value: `<@${target.id}> (\`${target.id}\`)\nTag: ${record.userTag || target.tag || 'Unknown'}`, inline: true },
                            { name: '🛡️ Moderator', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                            { name: '📋 Action', value: 'Suspension Lifted (Age Verified)', inline: true },
                            { name: '📝 Staff Note', value: staffNoteInput || '*None provided*', inline: false },
                            { name: '📨 Direct Message Invite', value: shouldSendInvite ? (dmDelivered ? `✅ **Sent Successfully**` : `⚠️ **Failed** (\`${dmFailReason}\`)\nInvite: ${inviteObj ? inviteObj.url : '*None*'}`) : '⏭️ *Skipped by staff*', inline: false }
                        )
                        .setFooter({ text: `Underage Management Engine • Staff: ${interaction.user.tag}` })
                        .setTimestamp();

                    await logChannel.send({ embeds: [auditEmbed] });
                }
            } catch (auditErr) {
                console.error('[Underage Lift] Audit log dispatch error:', auditErr);
            }

            // Respond to staff interaction
            const resultEmbed = new EmbedBuilder()
                .setTitle('✅ Underage Suspension Successfully Lifted')
                .setColor(0x2ECC71)
                .setDescription(
                    `The underage suspension for <@${target.id}> (\`${target.id}\`) has been **lifted**.\n` +
                    `Their status is now recorded as **Age Verified / Approved**.`
                )
                .addFields(
                    { name: '👤 Target User', value: `<@${target.id}> (\`${target.id}\`)`, inline: true },
                    { name: '🛡️ Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '📝 Staff Note', value: staffNoteInput || '*No specific note added*', inline: false }
                );

            if (shouldSendInvite) {
                if (dmDelivered) {
                    resultEmbed.addFields({
                        name: '📨 DM Notice & Server Invite',
                        value: `✅ **Successfully delivered** to <@${target.id}>'s direct messages.\nInvite: ${inviteObj.url}`,
                        inline: false
                    });
                } else {
                    resultEmbed.addFields({
                        name: '⚠️ DM Delivery Notice',
                        value: `Could not DM the user (\`${dmFailReason}\`).\nHere is the generated invite link to provide them manually:\n🔗 **${inviteObj ? inviteObj.url : 'Failed to generate invite'}**`,
                        inline: false
                    });
                }
            }

            resultEmbed.setFooter({ text: 'Logged to audit channel 1510677727206969625' }).setTimestamp();
            return interaction.editReply({ embeds: [resultEmbed] });
        }

        // -------------------------------------------------------------
        // Subcommand: NOTE
        // -------------------------------------------------------------
        if (subcommand === 'note') {
            const target = await resolveTargetUser(interaction);
            if (!target) {
                return handleError(interaction, 'User Required', 'Please select a user or provide a valid Discord User ID.');
            }

            const newNote = interaction.options.getString('note');

            let [record, created] = await UnderageSuspension.findOrCreate({
                where: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id
                },
                defaults: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id,
                    userTag: target.tag || `User_${target.id}`,
                    kickedAt: new Date(),
                    status: 'suspended',
                    staffNote: `[${interaction.user.tag}]: ${newNote}`
                }
            });

            if (!created) {
                const updatedNote = record.staffNote 
                    ? `${record.staffNote}\n[${interaction.user.tag} on ${new Date().toISOString().split('T')[0]}]: ${newNote}`
                    : `[${interaction.user.tag}]: ${newNote}`;
                await record.update({ staffNote: updatedNote });
            }

            return handleSuccess(interaction, 'Staff Note Updated', `Added staff note to <@${target.id}>'s underage file:\n> "${newNote}"`);
        }

        // -------------------------------------------------------------
        // Subcommand: SETWAIT
        // -------------------------------------------------------------
        if (subcommand === 'setwait') {
            const target = await resolveTargetUser(interaction);
            if (!target) {
                return handleError(interaction, 'User Required', 'Please select a user or provide a valid Discord User ID.');
            }

            const days = interaction.options.getInteger('days') || 0;
            const months = interaction.options.getInteger('months') || 0;
            const years = interaction.options.getInteger('years') || 0;
            const noteInput = interaction.options.getString('note');

            if (days === 0 && months === 0 && years === 0) {
                return handleError(interaction, 'Duration Required', 'Please specify at least one wait duration value in days, months, or years.');
            }

            // Calculate target date
            const targetDate = new Date();
            if (days > 0) targetDate.setDate(targetDate.getDate() + days);
            if (months > 0) targetDate.setMonth(targetDate.getMonth() + months);
            if (years > 0) targetDate.setFullYear(targetDate.getFullYear() + years);

            let [record, created] = await UnderageSuspension.findOrCreate({
                where: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id
                },
                defaults: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id,
                    userTag: target.tag || `User_${target.id}`,
                    kickedAt: new Date(),
                    rejoinEligibleAt: targetDate,
                    status: 'suspended'
                }
            });

            const updateData = { rejoinEligibleAt: targetDate };
            if (noteInput) {
                updateData.staffNote = record.staffNote 
                    ? `${record.staffNote}\n[Wait Timer set by ${interaction.user.tag}]: ${noteInput}`
                    : `[Wait Timer set by ${interaction.user.tag}]: ${noteInput}`;
            }

            await record.update(updateData);

            const eligibleTimestamp = Math.floor(targetDate.getTime() / 1000);
            const waitEmbed = new EmbedBuilder()
                .setTitle('⏳ Rejoin Eligibility Date Updated')
                .setColor(0x3498DB)
                .setDescription(`Successfully set the rejoin eligibility countdown for <@${target.id}> (\`${target.id}\`).`)
                .addFields(
                    { name: '👤 Target User', value: `<@${target.id}> (\`${target.id}\`)`, inline: true },
                    { name: '📅 Rejoin Date', value: `<t:${eligibleTimestamp}:F>`, inline: true },
                    { name: '⏳ Remaining Wait', value: `<t:${eligibleTimestamp}:R>`, inline: true },
                    { name: '📝 Staff Note', value: noteInput || '*No note provided*', inline: false }
                )
                .setFooter({ text: `Set by ${interaction.user.tag}` })
                .setTimestamp();

            return interaction.editReply({ embeds: [waitEmbed] });
        }

        // -------------------------------------------------------------
        // Subcommand: ADD
        // -------------------------------------------------------------
        // -------------------------------------------------------------
        // Subcommand: SETROLE
        // -------------------------------------------------------------
        if (subcommand === 'setrole') {
            const role = interaction.options.getRole('role');
            const GuildSettings = require('../../database/models/GuildSettings');
            let [settings] = await GuildSettings.findOrCreate({ where: { guildId: TARGET_GUILD_ID } });

            await settings.update({ ageVerifiedRoleId: role.id });

            const setRoleEmbed = new EmbedBuilder()
                .setTitle('🛡️ Age-Verified Protection Role Configured')
                .setColor(0x2ECC71)
                .setDescription(
                    `Successfully designated <@&${role.id}> (\`${role.name}\`) as the **Age-Verified Protection Role**.\n\n` +
                    `**Protection Guarantees:**\n` +
                    `• **Complete Sweep Immunity**: Automated hourly sweeps and role-assign triggers will **never** kick members with this role.\n` +
                    `• **Manual Action Shield**: Staff cannot accidentally suspend or kick members with this role.\n` +
                    `• **Self-Healing Guard**: If the underage role is accidentally applied to a member with this role, Nora automatically strips it instantly.`
                )
                .addFields(
                    { name: '🏷️ Configured Role', value: `<@&${role.id}> (\`${role.id}\`)`, inline: true },
                    { name: '🛡️ Configured By', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setFooter({ text: `Age Verification Shield Active • ${interaction.guild.name}` })
                .setTimestamp();

            return interaction.editReply({ embeds: [setRoleEmbed] });
        }

        // -------------------------------------------------------------
        // Subcommand: VERIFY
        // -------------------------------------------------------------
        if (subcommand === 'verify') {
            const target = interaction.options.getUser('user');
            const noteInput = interaction.options.getString('note');

            const GuildSettings = require('../../database/models/GuildSettings');
            const settings = await GuildSettings.findOne({ where: { guildId: TARGET_GUILD_ID } });
            const verifiedRoleId = settings ? settings.ageVerifiedRoleId : null;

            if (!verifiedRoleId) {
                return handleError(
                    interaction, 
                    'Configuration Required', 
                    'The Age-Verified role has not been configured yet. Please run `/underage setrole <role>` first.'
                );
            }

            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) {
                return handleError(interaction, 'Member Not in Server', `User <@${target.id}> is not currently in this server.`);
            }

            // Add verified role
            const role = interaction.guild.roles.cache.get(verifiedRoleId) || await interaction.guild.roles.fetch(verifiedRoleId).catch(() => null);
            if (!role) {
                return handleError(interaction, 'Role Not Found', `The configured Age-Verified role (\`${verifiedRoleId}\`) was not found in this server.`);
            }

            try {
                await member.roles.add(role, `Age-Verified by staff member ${interaction.user.tag}`);
                // Remove underage role if present
                const UNDERAGE_ROLE_ID = '1539395288811446302';
                if (member.roles.cache.has(UNDERAGE_ROLE_ID)) {
                    await member.roles.remove(UNDERAGE_ROLE_ID, 'Age Verified - Underage role removed').catch(() => {});
                }
            } catch (roleErr) {
                return handleError(interaction, 'Role Assignment Failed', `Could not assign role <@&${verifiedRoleId}>: ${roleErr.message}. Ensure bot role is higher in hierarchy.`);
            }

            // Update database record
            let [record, created] = await UnderageSuspension.findOrCreate({
                where: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id
                },
                defaults: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id,
                    userTag: target.tag,
                    kickedAt: new Date(),
                    status: 'lifted',
                    liftedBy: interaction.user.id,
                    liftedAt: new Date(),
                    staffNote: noteInput ? `[Age Verified by ${interaction.user.tag}]: ${noteInput}` : 'Age Verified & Protected'
                }
            });

            if (!created) {
                const combinedNote = noteInput 
                    ? (record.staffNote ? `${record.staffNote}\n[Age Verified by ${interaction.user.tag}]: ${noteInput}` : `[Age Verified by ${interaction.user.tag}]: ${noteInput}`)
                    : (record.staffNote || 'Age Verified & Protected');
                await record.update({
                    status: 'lifted',
                    liftedBy: interaction.user.id,
                    liftedAt: new Date(),
                    staffNote: combinedNote
                });
            }

            // Audit log
            try {
                let logChannel = interaction.client.channels.cache.get(LOG_CHANNEL_ID);
                if (!logChannel) logChannel = await interaction.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                if (logChannel && logChannel.isTextBased()) {
                    const auditEmbed = new EmbedBuilder()
                        .setTitle('🛡️ Member Granted Age-Verified Protected Status')
                        .setColor(0x2ECC71)
                        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
                        .setDescription(`Staff member <@${interaction.user.id}> verified <@${target.id}> and granted complete underage protection.`)
                        .addFields(
                            { name: '👤 Verified User', value: `<@${target.id}> (\`${target.id}\`)\nTag: ${target.tag}`, inline: true },
                            { name: '🛡️ Moderator', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                            { name: '🏷️ Role Assigned', value: `<@&${verifiedRoleId}>`, inline: true },
                            { name: '📝 Staff Note', value: noteInput || '*No specific note provided*', inline: false }
                        )
                        .setFooter({ text: `Age Verification Shield Active` })
                        .setTimestamp();
                    await logChannel.send({ embeds: [auditEmbed] });
                }
            } catch (auditErr) {}

            const verifyEmbed = new EmbedBuilder()
                .setTitle('✅ Member Successfully Age-Verified')
                .setColor(0x2ECC71)
                .setDescription(
                    `User <@${target.id}> (\`${target.id}\`) has been given the **Age-Verified** role (<@&${verifiedRoleId}>) and is now **permanently protected** against underage sweeps and manual actions.`
                )
                .addFields(
                    { name: '👤 Verified Member', value: `<@${target.id}>`, inline: true },
                    { name: '🏷️ Protected Role', value: `<@&${verifiedRoleId}>`, inline: true },
                    { name: '📝 Staff Note', value: noteInput || '*None attached*', inline: false }
                )
                .setFooter({ text: `Logged to audit channel 1510677727206969625` })
                .setTimestamp();

            return interaction.editReply({ embeds: [verifyEmbed] });
        }

        // -------------------------------------------------------------
        // Subcommand: UNVERIFY
        // -------------------------------------------------------------
        if (subcommand === 'unverify') {
            const target = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'Verification revoked by staff';

            const GuildSettings = require('../../database/models/GuildSettings');
            const settings = await GuildSettings.findOne({ where: { guildId: TARGET_GUILD_ID } });
            const verifiedRoleId = settings ? settings.ageVerifiedRoleId : null;

            if (!verifiedRoleId) {
                return handleError(interaction, 'No Role Configured', 'The Age-Verified role is not configured.');
            }

            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (member && member.roles.cache.has(verifiedRoleId)) {
                try {
                    await member.roles.remove(verifiedRoleId, `Age-Verification revoked by ${interaction.user.tag}: ${reason}`);
                } catch (roleErr) {
                    return handleError(interaction, 'Role Removal Failed', `Could not remove role: ${roleErr.message}`);
                }
            }

            return handleSuccess(interaction, 'Verification Revoked', `Removed Age-Verified protected role from <@${target.id}>.\nReason: *${reason}*`);
        }

        // -------------------------------------------------------------
        // Subcommand: ADD
        // -------------------------------------------------------------
        if (subcommand === 'add') {
            const target = await resolveTargetUser(interaction);
            if (!target) {
                return handleError(interaction, 'User Required', 'Please select a user or provide a valid Discord User ID.');
            }

            if (target.id === interaction.user.id) {
                return handleError(interaction, 'Action Denied', 'You cannot suspend yourself.');
            }

            if (target.id === interaction.guild.ownerId) {
                return handleError(interaction, 'Action Denied', 'You cannot suspend the Server Owner.');
            }

            // 🛡️ Age-Verified Immunity Guard: Check if target has the protected role
            const GuildSettings = require('../../database/models/GuildSettings');
            const settings = await GuildSettings.findOne({ where: { guildId: TARGET_GUILD_ID } });
            const verifiedRoleId = settings ? settings.ageVerifiedRoleId : null;

            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (verifiedRoleId && member && member.roles && member.roles.cache && member.roles.cache.has(verifiedRoleId)) {
                return handleError(
                    interaction,
                    '🛡️ Action Blocked: Age-Verified Immunity Shield',
                    `User <@${target.id}> holds the **Age-Verified Protected Role** (<@&${verifiedRoleId}>).\n\n` +
                    `They have **permanent immunity** against all underage enforcement actions and cannot be suspended or kicked.`
                );
            }

            const reason = interaction.options.getString('reason') || 'Determined underage for Discord (Recommended minimum age: 13)';
            const shouldKick = interaction.options.getBoolean('kick') !== false;
            const days = interaction.options.getInteger('days') || 0;
            const months = interaction.options.getInteger('months') || 0;
            const years = interaction.options.getInteger('years') || 0;
            const noteInput = interaction.options.getString('note');

            // Calculate optional wait target date
            let targetRejoinDate = null;
            if (days > 0 || months > 0 || years > 0) {
                targetRejoinDate = new Date();
                if (days > 0) targetRejoinDate.setDate(targetRejoinDate.getDate() + days);
                if (months > 0) targetRejoinDate.setMonth(targetRejoinDate.getMonth() + months);
                if (years > 0) targetRejoinDate.setFullYear(targetRejoinDate.getFullYear() + years);
            }

            // Attempt kick if user is currently in server
            let kickStatusText = '⏭️ *User not in server (Registry Only)*';
            let dmDelivered = false;

            if (member && shouldKick) {
                if (!member.kickable) {
                    kickStatusText = '⚠️ **Kick Failed** (Hierarchy / Permission Issue)';
                } else {
                    // Send Advisory DM first
                    try {
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('⚠️ Notice: Underage Account Policy Enforcement')
                            .setDescription(
                                `Hello <@${target.id}>,\n\n` +
                                `You have been removed from **${interaction.guild.name}** because you have been determined to be underage for Discord.\n\n` +
                                `You are strongly recommended to delete Discord and refrain from using the platform until you are at least **13 years of age** in accordance with Discord Terms of Service.`
                            )
                            .setColor(0xff4757)
                            .addFields(
                                { name: 'Server', value: interaction.guild.name, inline: true },
                                { name: 'Enforcement Action', value: 'Server Kick (Staff Action)', inline: true },
                                { name: 'Reason', value: reason, inline: false }
                            )
                            .setThumbnail(interaction.guild.iconURL({ dynamic: true }) || interaction.client.user.displayAvatarURL())
                            .setFooter({ text: 'Discord Safety & Underage Policy Enforcement' })
                            .setTimestamp();

                        const dmChannel = await target.createDM ? await target.createDM() : null;
                        if (dmChannel) {
                            await dmChannel.send({ embeds: [dmEmbed] });
                            dmDelivered = true;
                        }
                    } catch (dmErr) {
                        console.warn(`[Underage Add] DM failed for ${target.id}:`, dmErr.message);
                    }

                    try {
                        await member.kick(`Underage Policy: ${reason} (by ${interaction.user.tag})`);
                        kickStatusText = dmDelivered ? '✅ **Kicked & DM Delivered**' : '✅ **Kicked** (DMs closed)';
                    } catch (kErr) {
                        kickStatusText = `❌ **Kick Failed**: ${kErr.message}`;
                    }
                }
            } else if (member && !shouldKick) {
                kickStatusText = '⏭️ *Kick Skipped (Staff Option)*';
            }

            // Database recording
            let [record, created] = await UnderageSuspension.findOrCreate({
                where: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id
                },
                defaults: {
                    guildId: TARGET_GUILD_ID,
                    userId: target.id,
                    userTag: target.tag || (member ? member.user.tag : `User_${target.id}`),
                    kickedAt: new Date(),
                    rejoinEligibleAt: targetRejoinDate,
                    status: 'suspended',
                    reason: reason,
                    staffNote: noteInput ? `[Manually Added by ${interaction.user.tag}]: ${noteInput}` : null
                }
            });

            if (!created) {
                const combinedNote = noteInput 
                    ? (record.staffNote ? `${record.staffNote}\n[Manually Updated by ${interaction.user.tag}]: ${noteInput}` : `[Manually Updated by ${interaction.user.tag}]: ${noteInput}`)
                    : record.staffNote;

                await record.update({
                    userTag: target.tag || (member ? member.user.tag : record.userTag),
                    status: 'suspended',
                    kickedAt: new Date(),
                    rejoinEligibleAt: targetRejoinDate || record.rejoinEligibleAt,
                    reason: reason,
                    staffNote: combinedNote
                });
            }

            // Dispatch detailed audit log embed to channel 1510677727206969625
            try {
                let logChannel = interaction.client.channels.cache.get(LOG_CHANNEL_ID);
                if (!logChannel) {
                    logChannel = await interaction.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                }

                if (logChannel && logChannel.isTextBased()) {
                    const auditEmbed = new EmbedBuilder()
                        .setTitle('👢 Underage Member Manually Added & Suspended')
                        .setColor(0xff4757)
                        .setThumbnail(target.displayAvatarURL ? target.displayAvatarURL({ dynamic: true }) : (member ? member.user.displayAvatarURL({ dynamic: true }) : null))
                        .setDescription(`Staff member <@${interaction.user.id}> manually registered <@${target.id}> in the underage suspension registry.`)
                        .addFields(
                            { name: '👤 Target User', value: `<@${target.id}> (\`${target.id}\`)\nTag: ${target.tag || (member ? member.user.tag : 'Unknown')}`, inline: true },
                            { name: '🛡️ Moderator', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                            { name: '📋 Reason', value: reason, inline: false },
                            { name: '👢 Server Kick Action', value: kickStatusText, inline: true },
                            { name: '⏳ Rejoin Eligibility', value: targetRejoinDate ? `<t:${Math.floor(targetRejoinDate.getTime() / 1000)}:F> (<t:${Math.floor(targetRejoinDate.getTime() / 1000)}:R>)` : '⏳ **Indefinite (Until Age 13 or Proof)**', inline: true },
                            { name: '📝 Staff Note', value: noteInput || '*No specific note provided*', inline: false }
                        )
                        .setFooter({ text: `Underage Management Engine • Staff: ${interaction.user.tag}` })
                        .setTimestamp();

                    await logChannel.send({ embeds: [auditEmbed] });
                }
            } catch (auditErr) {
                console.error('[Underage Add] Audit log dispatch error:', auditErr);
            }

            // Respond to staff
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Underage User Added to Suspension Registry')
                .setColor(0xE74C3C)
                .setDescription(`Successfully registered <@${target.id}> (\`${target.id}\`) as **Underage Suspended**.`)
                .addFields(
                    { name: '👤 Target User', value: `<@${target.id}> (\`${target.id}\`)`, inline: true },
                    { name: '🛡️ Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '👢 Enforcement Status', value: kickStatusText, inline: true },
                    { name: '📋 Reason', value: reason, inline: false }
                );

            if (targetRejoinDate) {
                const eligibleSec = Math.floor(targetRejoinDate.getTime() / 1000);
                successEmbed.addFields({
                    name: '⏳ Rejoin Eligibility Timer',
                    value: `Eligible on <t:${eligibleSec}:F> (<t:${eligibleSec}:R>)`,
                    inline: false
                });
            }

            if (noteInput) {
                successEmbed.addFields({ name: '📝 Staff Note', value: noteInput, inline: false });
            }

            successEmbed.setFooter({ text: 'Logged to audit channel 1510677727206969625' }).setTimestamp();
            return interaction.editReply({ embeds: [successEmbed] });
        }
    }
};
