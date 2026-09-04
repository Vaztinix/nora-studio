const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const Case = require('../../database/models/Case');
const GuildSettings = require('../../database/models/GuildSettings');

module.exports = {
    category: 'moderation',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from the server with message purge options and audit logging.')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setDMPermission(false)
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user or member to ban')
                .setRequired(true)
        )
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for the ban')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('delete_messages')
                .setDescription('Delete message history from this user')
                .setRequired(false)
                .addChoices(
                    { name: 'None (Keep all messages)', value: 0 },
                    { name: 'Previous 1 Hour', value: 3600 },
                    { name: 'Previous 6 Hours', value: 21600 },
                    { name: 'Previous 12 Hours', value: 43200 },
                    { name: 'Previous 24 Hours', value: 86400 },
                    { name: 'Previous 7 Days', value: 604800 }
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const deleteSeconds = interaction.options.getInteger('delete_messages') || 0;

        if (target.id === interaction.user.id) {
            return handleError(interaction, 'Action Denied', 'You cannot ban yourself.');
        }

        if (target.id === interaction.client.user.id) {
            return handleError(interaction, 'Action Denied', 'You cannot ban me using my own command!');
        }

        // 🛡️ Owner Immunity Guard
        if (target.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
            return handleError(interaction, 'Owner Security Bypass', 'You cannot modify the Server Owner.');
        }

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (member) {
            if (!member.bannable) {
                return handleError(interaction, 'Missing Permissions', `I cannot ban <@${target.id}>. Their role might be higher than mine, or they are the server owner.`);
            }

            if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
                return handleError(interaction, 'Hierarchy Error', `You cannot ban <@${target.id}> because their highest role is equal to or higher than yours.`);
            }

            if (interaction.guild.members.me.roles.highest.position <= member.roles.highest.position) {
                return handleError(interaction, 'Bot Hierarchy Error', `I cannot ban <@${target.id}> because their highest role is equal to or higher than my highest role.`);
            }
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Ban Members** permission. Please update my roles.');
        }

        const settings = await GuildSettings.findOne({ where: { guildId: interaction.guild.id } }).catch(() => null);

        // Send Direct Message to target if enabled before executing the ban
        if (settings && settings.sendModDms !== false) {
            const dmEmbed = new EmbedBuilder()
                .setTitle(`🔨 You were banned from ${interaction.guild.name}`)
                .setColor(0xed4245)
                .addFields(
                    { name: 'Server', value: interaction.guild.name, inline: true },
                    { name: 'Moderator', value: interaction.user.tag, inline: true },
                    { name: 'Reason', value: reason }
                )
                .setTimestamp();
            await target.send({ embeds: [dmEmbed] }).catch(() => {});
        }

        try {
            await interaction.guild.bans.create(target.id, {
                reason: `${reason} (Moderator: ${interaction.user.tag})`,
                deleteMessageSeconds: deleteSeconds
            });

            const caseRecord = await Case.create({
                guildId: interaction.guild.id,
                userId: target.id,
                moderatorId: interaction.user.id,
                type: 'BAN',
                reason,
                status: 'active'
            });

            // Mod Log Embed
            const modLogId = settings?.modLogChannelId || settings?.loggingChannelId;
            if (modLogId) {
                const logChannel = interaction.guild.channels.cache.get(modLogId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle(`🔨 Member Banned | Case #${caseRecord.id}`)
                        .setColor(0xed4245)
                        .addFields(
                            { name: 'Target', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                            { name: 'Moderator', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
                            { name: 'Purged Messages', value: deleteSeconds > 0 ? `${deleteSeconds / 3600} hours` : 'None', inline: true },
                            { name: 'Reason', value: reason }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }
            }

            await handleSuccess(interaction, 'User Banned', `**${target.tag}** has been banned from the server.\n**Reason:** ${reason}\n**Case:** #${caseRecord.id}`);
        } catch (error) {
            console.error('[Ban Command Error]:', error);
            await handleError(interaction, 'Execution Error', 'An unexpected error occurred while trying to ban the user. Please check permissions and try again.');
        }
    },
};