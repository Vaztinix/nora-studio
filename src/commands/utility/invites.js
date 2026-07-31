const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Check your total invite count and progress towards invite rewards.')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The member whose invite stats to check (default: yourself)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();
        const targetUser = interaction.options.getUser('target') || interaction.user;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });
            const [userStats] = await UserLevel.findOrCreate({
                where: { userId: targetUser.id, guildId: interaction.guild.id }
            });

            const count = userStats.invitesCount || 0;

            // Fetch configured invite rewards
            let rawRewards = settings ? settings.inviteRewards : [];
            if (typeof rawRewards === 'string') {
                try { rawRewards = JSON.parse(rawRewards); } catch (e) { rawRewards = []; }
            }
            if (!Array.isArray(rawRewards)) rawRewards = [];

            let rewardsDisplay = 'No invite reward milestones configured by admins.';
            if (rawRewards.length > 0) {
                rewardsDisplay = rawRewards.map(r => {
                    const reqInv = Number(r.reqInvites || r.invites || 0);
                    const roleId = r.roleId || r.role;
                    const unlocked = count >= reqInv;
                    const statusIcon = unlocked ? '✅ **Unlocked**' : `🔒 (${reqInv - count} more needed)`;
                    return `• **${reqInv} Invites**: <@&${roleId}> — ${statusIcon}`;
                }).join('\n');
            }

            const embed = new EmbedBuilder()
                .setTitle(`📊 Invite Statistics: ${targetUser.username}`)
                .setColor(0x57acf2)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: 'Total Successful Invites', value: `**${count}** member(s) invited`, inline: false },
                    { name: 'Server Invite Rewards', value: rewardsDisplay, inline: false }
                )
                .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[Invites Command Error]:', error);
            await handleError(interaction, 'Error', 'Failed to retrieve invite statistics.');
        }
    },
};
