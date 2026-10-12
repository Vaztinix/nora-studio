const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const voteReminderManager = require('../../utils/voteReminderManager');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Support Nora on Top.gg and receive voter perks with automatic 12-hour DM reminders.')
        .addBooleanOption(option =>
            option.setName('test_reminder')
                .setDescription('Simulate an immediate vote reminder test DM')
                .setRequired(false)
        )
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        const botName = interaction.client.user.username || 'Nora';
        const targetBotId = interaction.client.user.id || '740998573237825536';
        const isTest = interaction.options.getBoolean('test_reminder');

        if (isTest) {
            await interaction.deferReply({ ephemeral: true });
            // Schedule an immediate test reminder for 2 seconds from now
            await voteReminderManager.recordVote(
                interaction.user.id,
                targetBotId,
                botName,
                interaction.guildId,
                0.0005 // ~2 seconds
            );
            setTimeout(() => {
                voteReminderManager.checkAndSendReminders(interaction.client).catch(() => {});
            }, 2500);

            return interaction.editReply({
                content: `🧪 **Vote reminder test scheduled!** Check your DMs in ~3 seconds for: *"You can vote for \\"${botName}\\" again!"*`
            });
        }

        const cooldown = await voteReminderManager.getVoteCooldown(interaction.user.id, targetBotId);

        const embed = new EmbedBuilder()
            .setAuthor({ 
                name: `${botName} Support & Voting`, 
                iconURL: interaction.client.user.displayAvatarURL() 
            })
            .setTitle(`Vote for ${botName} on Top.gg`)
            .setColor(0xFF3366) // Top.gg Signature Pink
            .setDescription(
                `Voting helps ${botName} reach more communities and grants voter perks across supported servers.\n\n` +
                `You can vote once every **12 hours** on Top.gg (with 2x XP multipliers on weekends).`
            )
            .setFooter({ text: 'Top.gg Official Integration • Automatic 12h DM Reminders Active' })
            .setTimestamp();

        if (!cooldown.canVote) {
            const unixTime = Math.floor(cooldown.remindAt.getTime() / 1000);
            embed.addFields(
                {
                    name: '⏳ Current Cooldown',
                    value: `You have already voted! You can vote for **${cooldown.botName || botName}** again <t:${unixTime}:R> (<t:${unixTime}:t>).\n\n` +
                           `🔔 **Automatic DM Alert**: I will automatically send you a direct message saying **"You can vote for \\"${cooldown.botName || botName}\\" again!"** as soon as your timer completes.`,
                    inline: false
                }
            );
        } else {
            embed.addFields(
                {
                    name: '✨ Ready to Vote!',
                    value: `**You can vote for "${botName}" right now!**\nClick the button below to cast your vote. Once received, I will automatically DM you when you can vote again in 12 hours.`,
                    inline: false
                }
            );
        }

        embed.addFields(
            {
                name: '🎁 Voter Perks',
                value: '• **Bonus Leveling XP**: Earn 150-300+ XP across enabled servers.\n• **Voter Streak Multipliers**: Keep your streak burning for extra bonuses.\n• **Automatic DM Alerts**: Never lose your streak with 12h reminder notifications.',
                inline: false
            }
        );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel(`Vote for ${botName} on Top.gg`)
                .setURL(`https://top.gg/bot/${targetBotId}/vote`)
                .setStyle(ButtonStyle.Link)
                .setEmoji('🗳️'),
            new ButtonBuilder()
                .setLabel('Website')
                .setURL('https://vaztinix.dev')
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel('Support Server')
                .setURL('https://discord.gg/Uxb2tNAxtp')
                .setStyle(ButtonStyle.Link)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};
