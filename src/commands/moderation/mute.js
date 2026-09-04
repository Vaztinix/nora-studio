const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const Case = require('../../database/models/Case');
const GuildSettings = require('../../database/models/GuildSettings');

module.exports = {
    category: 'moderation',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Time out / mute a member with direct message alerts and audit logging.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to mute')
                .setRequired(true)
        )
        .addIntegerOption(option => 
            option.setName('duration')
                .setDescription('Duration in minutes (e.g. 5, 60, 1440 for 1 day)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(40320)
        )
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for the timeout')
                .setRequired(false)
        ),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const target = interaction.options.getUser('target');
        const duration = interaction.options.getInteger('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        if (target.id === interaction.user.id) {
            return handleError(interaction, 'Action Denied', 'You cannot mute yourself.');
        }

        // 🛡️ Owner Immunity Guard
        if (target.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            return handleError(interaction, 'Owner Security Bypass', 'You cannot modify the Server Owner.');
        }

        if (duration <= 0 || duration > 40320) {
            return handleError(interaction, 'Invalid Duration', 'Duration must be between 1 and 40,320 minutes (max 28 days).');
        }

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (!member) {
            return handleError(interaction, 'User Not Found', 'That user is not currently in this server.');
        }
        
        if (member.isCommunicationDisabled()) {
            return handleError(interaction, 'Already Muted', `The user <@${target.id}> is already timed out.`);
        }

        if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return handleError(interaction, 'Hierarchy Error', `You cannot mute <@${target.id}> because their highest role is equal to or higher than yours.`);
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Timeout Members** permission. Please update my roles.');
        }

        if (interaction.guild.members.me.roles.highest.position <= member.roles.highest.position) {
            return handleError(interaction, 'Bot Hierarchy Error', `I cannot mute <@${target.id}> because their highest role is equal to or higher than my highest role.`);
        }

        const settings = await GuildSettings.findOne({ where: { guildId: interaction.guild.id } }).catch(() => null);

        // Format duration display
        let durationDisplay = `${duration} minute(s)`;
        if (duration >= 1440) {
            durationDisplay = `${(duration / 1440).toFixed(1)} day(s)`;
        } else if (duration >= 60) {
            durationDisplay = `${(duration / 60).toFixed(1)} hour(s)`;
        }

        // Direct Message Notice
        if (settings && settings.sendModDms !== false) {
            const dmEmbed = new EmbedBuilder()
                .setTitle(`🔇 You were timed out in ${interaction.guild.name}`)
                .setColor(0xfaa61a)
                .addFields(
                    { name: 'Server', value: interaction.guild.name, inline: true },
                    { name: 'Duration', value: durationDisplay, inline: true },
                    { name: 'Moderator', value: interaction.user.tag, inline: true },
                    { name: 'Reason', value: reason }
                )
                .setTimestamp();
            await target.send({ embeds: [dmEmbed] }).catch(() => {});
        }

        try {
            await member.timeout(duration * 60 * 1000, `${reason} (Moderator: ${interaction.user.tag})`);
            const caseRecord = await Case.create({
                guildId: interaction.guild.id,
                userId: target.id,
                moderatorId: interaction.user.id,
                type: 'MUTE',
                reason,
                status: 'active',
                duration: duration * 60 * 1000
            });

            // Mod Log Embed
            const modLogId = settings?.modLogChannelId || settings?.loggingChannelId;
            if (modLogId) {
                const logChannel = interaction.guild.channels.cache.get(modLogId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle(`🔇 Member Timed Out | Case #${caseRecord.id}`)
                        .setColor(0xfaa61a)
                        .addFields(
                            { name: 'Target', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                            { name: 'Moderator', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
                            { name: 'Duration', value: durationDisplay, inline: true },
                            { name: 'Reason', value: reason }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }
            }

            await handleSuccess(interaction, 'User Muted', `**${target.tag}** has been timed out for **${durationDisplay}**.\n**Reason:** ${reason}\n**Case:** #${caseRecord.id}`);
        } catch (error) {
            console.error('[Mute Command Error]:', error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while trying to mute the user. Check my permissions or hierarchy.');
        }
    },
};
