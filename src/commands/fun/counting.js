const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    PermissionFlagsBits,
    ComponentType
} = require('discord.js');
const settingsCache = require('../../utils/settingsCache');
const { getGuildCountingData, setGuildCountingData } = require('../../events/countingSystem');

function buildButtons(activeView, guildId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('counting_btn_stats')
            .setLabel('Game Stats')
            .setStyle(activeView === 'stats' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('counting_btn_lb')
            .setLabel('Top Counters')
            .setStyle(activeView === 'leaderboard' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('counting_btn_rules')
            .setLabel('Rules & Math')
            .setStyle(activeView === 'rules' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setLabel('Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://vaztinix.dev/dashboard?guild=${guildId}`)
    );
}

function buildStatsEmbed(guild, data, settings) {
    const channelId = settings?.countingChannelId;
    const currentCount = data.currentCount || 0;
    const highScore = data.highScore || 0;
    const nextNumber = currentCount + 1;
    const totalCounts = data.totalCorrectCounts || 0;
    const totalResets = data.totalResets || 0;
    const lastUserTag = data.lastUserTag ? `\`${data.lastUserTag}\`` : (data.lastUserId ? `<@${data.lastUserId}>` : '*None*');
    const xpReward = settings?.countingChannelXpReward !== undefined ? settings.countingChannelXpReward : 15;

    // Determine top counter
    let topCounterText = '*No counts recorded yet*';
    const userCounts = data.userCounts || {};
    const sorted = Object.entries(userCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
        topCounterText = `<@${sorted[0][0]}> (**${sorted[0][1]}** counts)`;
    }

    return new EmbedBuilder()
        .setTitle(`🔢 ${guild.name} — Counting Game Stats`)
        .setDescription(
            channelId 
                ? `Active Counting Channel: <#${channelId}>\nType numbers sequentially or enter mathematical equations (e.g. \`10*2+5\`).`
                : `⚠️ **No Counting Channel Configured!**\nAn admin can run \`/counting channel\` or \`/setup games\` to set one.`
        )
        .setColor(0x5865F2)
        .addFields(
            { name: 'Current Count', value: `**${currentCount}**`, inline: true },
            { name: 'Next Required', value: `**${nextNumber}**`, inline: true },
            { name: 'All-Time Record', value: `**${highScore}**`, inline: true },
            { name: 'Last Counter', value: lastUserTag, inline: true },
            { name: 'Total Counts Logged', value: `**${totalCounts}**`, inline: true },
            { name: 'Total Server Resets', value: `**${totalResets}**`, inline: true },
            { name: 'Server MVP Counter', value: topCounterText, inline: true },
            { name: 'XP Reward Per Count', value: `**+${xpReward} XP**`, inline: true },
            { name: 'Record Status', value: currentCount >= highScore && highScore > 0 ? '🏆 **Record Breaking!**' : `\`${Math.max(0, highScore - currentCount)}\` counts to beat record`, inline: true }
        )
        .setFooter({ text: 'Nora Counting Engine • Type n!counting or /counting for info' })
        .setTimestamp();
}

function buildLeaderboardEmbed(guild, data) {
    const userCounts = data.userCounts || {};
    const sorted = Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const embed = new EmbedBuilder()
        .setTitle(`🏆 ${guild.name} — Top Counters Leaderboard`)
        .setColor(0xFEE75C)
        .setFooter({ text: 'Nora Counting Leaderboard • Tracks correct counts across streaks' })
        .setTimestamp();

    if (sorted.length === 0) {
        embed.setDescription('No members have contributed to the counting game yet! Start counting in the designated channel to claim the #1 spot.');
        return embed;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = sorted.map(([userId, count], index) => {
        const medal = medals[index] || `\`#${index + 1}\``;
        return `${medal} <@${userId}> — **${count}** correct counts`;
    });

    embed.setDescription(lines.join('\n'));
    return embed;
}

function buildRulesEmbed() {
    return new EmbedBuilder()
        .setTitle('📖 Nora Counting Game Rules & Guide')
        .setDescription(
            `Nora's Counting Game is a real-time collaborative chat game designed to test your server's coordination.\n\n` +
            `**1. Sequential Progression:**\n` +
            `• Start counting at **1** and increment by **1** with each message.\n` +
            `• Messages with regular chat, greetings, or pure emojis are ignored without resetting the count.\n\n` +
            `**2. Alternating Counters:**\n` +
            `• **You cannot count twice in a row!** Another member must count next before you can count again.\n` +
            `• Counting twice in a row or entering the wrong number resets the count to **0**.\n\n` +
            `**3. Advanced Math Sandbox:**\n` +
            `• Nora features a sandboxed mathematical equation parser.\n` +
            `• You can submit expressions like \`5 + 5\`, \`10 * 3\`, \`50 / 2\`, \`(8 - 2) * 4\`, or \`2^4\`!\n\n` +
            `**4. Reactions & Milestones:**\n` +
            `• ✅ **Green Checkmark:** Correct count progressing towards the record.\n` +
            `• ☑️ **Blue Checkmark:** **New Server Record!** (Exceeds all-time high score).\n` +
            `• 💯 **Century Milestone:** Milestone reaction for reaching 100, 200, 300, etc.\n` +
            `• 🎉 **Milestone Announcement:** Nora celebrates counts like 50, 100, 500, and 1000 in chat.\n\n` +
            `**5. XP Rewards:**\n` +
            `• Every successful count awards leveling experience to boost your server rank.`
        )
        .setColor(0x57F287)
        .setFooter({ text: 'Nora Counting Engine • Safe, sandboxed math parsing' })
        .setTimestamp();
}

module.exports = {
    category: 'fun',
    ephemeral: false,
    data: new SlashCommandBuilder()
        .setName('counting')
        .setDescription('Advanced sequential counting game stats, leaderboards, rules, and channel setup.')
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('View current server count, high score record, and next number.'))
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('View the top counting contributors in this server.'))
        .addSubcommand(sub =>
            sub.setName('rules')
                .setDescription('View the rules, supported math expressions, and milestone guide.'))
        .addSubcommand(sub =>
            sub.setName('channel')
                .setDescription('Set or change the active counting channel (Manage Server only).')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('The text channel to designate for counting')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('reset')
                .setDescription('Reset or calibrate the current count (Manage Server only).')
                .addIntegerOption(opt =>
                    opt.setName('count')
                        .setDescription('The number to set the count to (default is 0)')
                        .setMinValue(0)
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason for the calibration')
                        .setRequired(false))),

    async execute(interaction) {
        const subcommand = interaction.options?.getSubcommand?.() || 'stats';
        const guild = interaction.guild;
        const member = interaction.member;

        // Admin Subcommand: Set Channel
        if (subcommand === 'channel') {
            if (!member.permissions.has(PermissionFlagsBits.ManageGuild) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '⛔ You need the **Manage Server** permission to configure the counting channel.',
                    ephemeral: true
                });
            }

            const targetChannel = interaction.options.getChannel('channel');
            const settings = await settingsCache.get(guild.id) || {};
            settings.countingChannelId = targetChannel.id;
            await settings.save();
            settingsCache.invalidate(guild.id);

            const data = await getGuildCountingData(guild.id);
            const nextCount = (data.currentCount || 0) + 1;

            return await interaction.reply({
                content: `✅ Counting channel updated to <#${targetChannel.id}>!\n• Current Count: **${data.currentCount || 0}**\n• Next Number: **${nextCount}**\n• Server Record: **${data.highScore || 0}**`,
                allowedMentions: { repliedUser: false }
            });
        }

        // Admin Subcommand: Reset / Calibrate Count
        if (subcommand === 'reset') {
            if (!member.permissions.has(PermissionFlagsBits.ManageGuild) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '⛔ You need the **Manage Server** permission to reset or calibrate the count.',
                    ephemeral: true
                });
            }

            const newCount = interaction.options.getInteger('count') ?? 0;
            const reason = interaction.options.getString('reason') || 'Manual staff reset';

            const currentData = await getGuildCountingData(guild.id);
            const updated = await setGuildCountingData(guild.id, {
                currentCount: newCount,
                lastUserId: null,
                lastUserTag: null,
                totalResets: (currentData.totalResets || 0) + 1
            });

            return await interaction.reply({
                content: `🔄 Counting progress calibrated by <@${interaction.user.id}>!\n• New Count: **${newCount}**\n• Next Required: **${newCount + 1}**\n• Server High Score: **${updated.highScore || 0}**\n• Reason: \`${reason}\``,
                allowedMentions: { repliedUser: false }
            });
        }

        // Public Views: stats, leaderboard, rules
        const settings = await settingsCache.get(guild.id);
        const data = await getGuildCountingData(guild.id);

        let initialEmbed;
        let activeTab = 'stats';

        if (subcommand === 'leaderboard' || subcommand === 'top') {
            initialEmbed = buildLeaderboardEmbed(guild, data);
            activeTab = 'leaderboard';
        } else if (subcommand === 'rules' || subcommand === 'help') {
            initialEmbed = buildRulesEmbed();
            activeTab = 'rules';
        } else {
            initialEmbed = buildStatsEmbed(guild, data, settings);
            activeTab = 'stats';
        }

        const buttons = buildButtons(activeTab, guild.id);
        const reply = await interaction.reply({
            embeds: [initialEmbed],
            components: [buttons],
            fetchReply: true
        });

        // Setup button pagination collector
        const collector = reply.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 180000
        });

        collector.on('collect', async i => {
            const freshData = await getGuildCountingData(guild.id);
            const freshSettings = await settingsCache.get(guild.id);

            if (i.customId === 'counting_btn_stats') {
                activeTab = 'stats';
                await i.update({
                    embeds: [buildStatsEmbed(guild, freshData, freshSettings)],
                    components: [buildButtons('stats', guild.id)]
                }).catch(() => {});
            } else if (i.customId === 'counting_btn_lb') {
                activeTab = 'leaderboard';
                await i.update({
                    embeds: [buildLeaderboardEmbed(guild, freshData)],
                    components: [buildButtons('leaderboard', guild.id)]
                }).catch(() => {});
            } else if (i.customId === 'counting_btn_rules') {
                activeTab = 'rules';
                await i.update({
                    embeds: [buildRulesEmbed()],
                    components: [buildButtons('rules', guild.id)]
                }).catch(() => {});
            }
        });

        collector.on('end', () => {
            reply.edit({ components: [] }).catch(() => {});
        });
    }
};
