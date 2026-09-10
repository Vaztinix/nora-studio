const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleError } = require('../../utils/embeds');

function generateProgressBar(current, goal, size = 12) {
    if (goal <= 0) goal = 1;
    const percentage = Math.min(100, Math.max(0, Math.floor((current / goal) * 100)));
    const filled = Math.round((percentage / 100) * size);
    const empty = size - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `\`${bar}\` **${percentage}%**`;
}

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Check your server invite count, server rank, and milestone progress.')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The member whose invite stats to check (default: yourself)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply().catch(() => {});
        const targetUser = interaction.options.getUser('target') || interaction.user;

        try {
            const settings = await GuildSettings.findOne({ where: { guildId: interaction.guild.id } });
            const [userStats] = await UserLevel.findOrCreate({
                where: { userId: targetUser.id, guildId: interaction.guild.id }
            });

            const count = userStats.invitesCount || 0;

            // Compute server invite leaderboard rank
            let inviteRank = 'N/A';
            try {
                const higherInvites = await UserLevel.count({
                    where: {
                        guildId: interaction.guild.id,
                        invitesCount: { [require('sequelize').Op.gt]: count }
                    }
                });
                inviteRank = `#${higherInvites + 1}`;
            } catch (e) {}

            // Fetch configured invite rewards
            let rawRewards = settings ? settings.inviteRewards : [];
            if (typeof rawRewards === 'string') {
                try { rawRewards = JSON.parse(rawRewards); } catch (e) { rawRewards = []; }
            }
            if (!Array.isArray(rawRewards)) rawRewards = [];

            // Sort rewards by requirement
            rawRewards.sort((a, b) => Number(a.reqInvites || a.invites || 0) - Number(b.reqInvites || b.invites || 0));

            let rewardsDisplay = 'No invite reward milestones configured on this server.';
            let nextRewardTarget = null;

            if (rawRewards.length > 0) {
                rewardsDisplay = rawRewards.map(r => {
                    const reqInv = Number(r.reqInvites || r.invites || 0);
                    const roleId = r.roleId || r.role;
                    const unlocked = count >= reqInv;
                    if (!unlocked && !nextRewardTarget) {
                        nextRewardTarget = reqInv;
                    }
                    const statusText = unlocked ? '[Unlocked]' : `[Locked - ${reqInv - count} more needed]`;
                    return `• **${reqInv} Invites**: <@&${roleId}> — ${statusText}`;
                }).join('\n');
            }

            let progressDisplay = 'All configured reward milestones unlocked.';
            if (nextRewardTarget) {
                progressDisplay = `${generateProgressBar(count, nextRewardTarget)}\n*${count} / ${nextRewardTarget} invites toward next milestone*`;
            } else if (rawRewards.length === 0) {
                progressDisplay = 'Invite rewards not configured by server administrators.';
            }

            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: `Invite Stats: ${targetUser.tag}`, 
                    iconURL: targetUser.displayAvatarURL({ dynamic: true }) 
                })
                .setTitle('Member Referral Overview')
                .setColor(0x5865F2)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: 'Total Invites', value: `**${count.toLocaleString()}** member(s)`, inline: true },
                    { name: 'Server Rank', value: `**${inviteRank}**`, inline: true },
                    { name: 'Milestone Progress', value: progressDisplay, inline: false },
                    { name: 'Reward Tiers', value: rewardsDisplay, inline: false }
                )
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[Invites Command Error]:', error);
            await handleError(interaction, 'Error', 'Failed to retrieve invite statistics.');
        }
    },
};
