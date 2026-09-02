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
const GuildSettings = require('../../database/models/GuildSettings');
const settingsCache = require('../../utils/settingsCache');
const { 
    getStarboardStats, 
    getTopStarredMembers, 
    getHallOfFame, 
    getRandomStarredMessage,
    getStarTier
} = require('../../bot/engines/starboardEngine');

function buildNavigationButtons(activeTab, guildId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('starboard_btn_stats')
            .setLabel('Overview')
            .setStyle(activeTab === 'stats' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('starboard_btn_top')
            .setLabel('Top Members')
            .setStyle(activeTab === 'top' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('starboard_btn_hof')
            .setLabel('Hall of Fame')
            .setStyle(activeTab === 'hof' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('starboard_btn_random')
            .setLabel('Random Starred')
            .setStyle(activeTab === 'random' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setLabel('Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://vaztinix.dev/dashboard?guild=${guildId}`)
    );
}

async function buildStatsEmbed(guild, settings) {
    const stats = await getStarboardStats(guild.id);
    const channelId = settings?.starboardChannelId;
    const threshold = settings?.starboardThreshold || 3;
    const triggerEmoji = settings?.starboardEmoji || '⭐';
    const selfStar = settings?.starboardSelfStar ? 'Allowed' : 'Blocked (Anti-Farm)';
    const xpReward = settings?.starboardAuthorRewardXp !== undefined ? settings.starboardAuthorRewardXp : 25;

    let topAuthorText = '*None yet*';
    if (stats.topAuthorId) {
        topAuthorText = `<@${stats.topAuthorId}> (**${stats.topAuthorStars}** stars)`;
    }

    return new EmbedBuilder()
        .setTitle(`⭐ ${guild.name} — Starboard System Stats`)
        .setDescription(
            channelId
                ? `Active Starboard: <#${channelId}>\nReact with **${triggerEmoji}** to any message to vote for it to be featured!`
                : `⚠️ **Starboard Not Configured!**\nAn admin can set the channel with \`/starboard channel\` or \`/setup games\`.`
        )
        .setColor(0xFFD700)
        .addFields(
            { name: 'Starboard Status', value: settings?.starboardEnabled ? '✅ **Active & Listening**' : '❌ **Disabled**', inline: true },
            { name: 'Trigger Emoji', value: `**${triggerEmoji}**`, inline: true },
            { name: 'Star Threshold', value: `**${threshold}** stars required`, inline: true },
            { name: 'Total Highlighted Posts', value: `**${stats.totalEntries}** posts`, inline: true },
            { name: 'Total Stars Given', value: `**${stats.totalStars}** stars`, inline: true },
            { name: 'Self-Star Policy', value: `**${selfStar}**`, inline: true },
            { name: 'All-Time Star MVP', value: topAuthorText, inline: true },
            { name: 'Author XP Reward', value: `**+${xpReward} XP** on highlight`, inline: true },
            { name: 'Dynamic Star Tiers', value: '⭐ 3+ • 🌟 6+ • ✨ 10+ • 💫 20+ • 🌠 50+', inline: false }
        )
        .setFooter({ text: 'Nora Starboard Engine • React to messages to feature them' })
        .setTimestamp();
}

async function buildTopMembersEmbed(guild) {
    const topMembers = await getTopStarredMembers(guild.id, 10);

    const embed = new EmbedBuilder()
        .setTitle(`🏆 ${guild.name} — Top Starred Members`)
        .setColor(0xFFA500)
        .setFooter({ text: 'Nora Starboard Leaderboard • Ranked by total stars received' })
        .setTimestamp();

    if (topMembers.length === 0) {
        embed.setDescription('No members have received stars yet! React to entertaining messages to start the leaderboard.');
        return embed;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = topMembers.map((m, i) => {
        const medal = medals[i] || `\`#${i + 1}\``;
        return `${medal} <@${m.authorId}> — **${m.totalStars}** stars across **${m.postCount}** post${m.postCount === 1 ? '' : 's'}`;
    });

    embed.setDescription(lines.join('\n'));
    return embed;
}

async function buildHallOfFameEmbed(guild) {
    const hof = await getHallOfFame(guild.id, 5);

    const embed = new EmbedBuilder()
        .setTitle(`🌟 ${guild.name} — Starboard Hall of Fame`)
        .setColor(0xFF7700)
        .setFooter({ text: 'Nora Starboard Hall of Fame • Highest starred individual messages' })
        .setTimestamp();

    if (hof.length === 0) {
        embed.setDescription('No messages have made it to the Starboard yet! Reach the server threshold to enter the Hall of Fame.');
        return embed;
    }

    const lines = hof.map((entry, idx) => {
        const tier = getStarTier(entry.starCount, entry.tierEmoji);
        const snippet = entry.content ? (entry.content.length > 70 ? entry.content.substring(0, 70) + '...' : entry.content) : '*Media Attachment*';
        const link = entry.jumpUrl ? `[Jump to message](${entry.jumpUrl})` : '*Deleted*';
        return `**#${idx + 1}** ${tier.emoji} **${entry.starCount}** stars by <@${entry.authorId}>\n> "${snippet}"\n• ${link}`;
    });

    embed.setDescription(lines.join('\n\n'));
    return embed;
}

async function buildRandomStarredEmbed(guild) {
    const entry = await getRandomStarredMessage(guild.id);

    if (!entry) {
        return new EmbedBuilder()
            .setTitle('🎲 Random Starred Message')
            .setDescription('No messages have been starred in this server yet! Start reacting to messages to create your Starboard history.')
            .setColor(0x808080);
    }

    const tier = getStarTier(entry.starCount, entry.tierEmoji);
    const embed = new EmbedBuilder()
        .setTitle(`🎲 Featured Starred Message (${tier.emoji} ${entry.starCount} Stars)`)
        .setDescription(entry.content && entry.content.length > 0 ? entry.content : '*Media only*')
        .setColor(tier.color)
        .addFields(
            { name: 'Author', value: `<@${entry.authorId}>`, inline: true },
            { name: 'Channel', value: `<#${entry.channelId}>`, inline: true },
            { name: 'Original Link', value: entry.jumpUrl ? `[Jump to message](${entry.jumpUrl})` : '*Unknown*', inline: true }
        )
        .setFooter({ text: `Message ID: ${entry.messageId} • ${tier.name}` })
        .setTimestamp(entry.createdAt);

    if (entry.attachmentUrl) {
        embed.setImage(entry.attachmentUrl);
    }

    return embed;
}

module.exports = {
    category: 'fun',
    ephemeral: false,
    data: new SlashCommandBuilder()
        .setName('starboard')
        .setDescription('Advanced community highlight engine stats, Hall of Fame, and configuration.')
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('View server Starboard statistics, threshold, and top starred author.'))
        .addSubcommand(sub =>
            sub.setName('top')
                .setDescription('View the members who have received the most stars.'))
        .addSubcommand(sub =>
            sub.setName('halloffame')
                .setDescription('View the highest starred all-time messages in this server.'))
        .addSubcommand(sub =>
            sub.setName('random')
                .setDescription('Showcase a random message from the Starboard.'))
        .addSubcommand(sub =>
            sub.setName('channel')
                .setDescription('Set or update the active Starboard channel (Manage Server only).')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('The text channel to post starred messages in')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('threshold')
                .setDescription('Set the number of stars required to make the Starboard (Manage Server only).')
                .addIntegerOption(opt =>
                    opt.setName('count')
                        .setDescription('Number of reactions required (1–100)')
                        .setMinValue(1)
                        .setMaxValue(100)
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('selfstar')
                .setDescription('Toggle whether users can star their own messages (Manage Server only).')
                .addBooleanOption(opt =>
                    opt.setName('enabled')
                        .setDescription('True to allow self-starring, False to block self-starring')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options?.getSubcommand?.() || 'stats';
        const guild = interaction.guild;
        const member = interaction.member;

        // Admin Subcommand: Set Channel
        if (subcommand === 'channel') {
            if (!member.permissions.has(PermissionFlagsBits.ManageGuild) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '⛔ You need the **Manage Server** permission to configure the Starboard channel.',
                    ephemeral: true
                });
            }

            const targetChannel = interaction.options.getChannel('channel');
            let settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
            if (!settings) {
                settings = await GuildSettings.create({ guildId: guild.id });
            }

            settings.starboardChannelId = targetChannel.id;
            settings.starboardEnabled = true;
            await settings.save();
            settingsCache.invalidate(guild.id);

            return await interaction.reply({
                content: `✅ Starboard channel updated to <#${targetChannel.id}>!\n• Status: **Enabled**\n• Required Stars: **${settings.starboardThreshold || 3}**\n• Trigger Emoji: **${settings.starboardEmoji || '⭐'}**`,
                allowedMentions: { repliedUser: false }
            });
        }

        // Admin Subcommand: Set Threshold
        if (subcommand === 'threshold') {
            if (!member.permissions.has(PermissionFlagsBits.ManageGuild) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '⛔ You need the **Manage Server** permission to adjust the Starboard threshold.',
                    ephemeral: true
                });
            }

            const newThreshold = interaction.options.getInteger('count');
            let settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
            if (!settings) {
                settings = await GuildSettings.create({ guildId: guild.id });
            }

            settings.starboardThreshold = newThreshold;
            await settings.save();
            settingsCache.invalidate(guild.id);

            return await interaction.reply({
                content: `✅ Starboard threshold updated to **${newThreshold}** stars! Messages with ${newThreshold} or more reactions will now be highlighted.`,
                allowedMentions: { repliedUser: false }
            });
        }

        // Admin Subcommand: Toggle Self-Star
        if (subcommand === 'selfstar') {
            if (!member.permissions.has(PermissionFlagsBits.ManageGuild) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '⛔ You need the **Manage Server** permission to modify the self-star policy.',
                    ephemeral: true
                });
            }

            const allowSelfStar = interaction.options.getBoolean('enabled');
            let settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
            if (!settings) {
                settings = await GuildSettings.create({ guildId: guild.id });
            }

            settings.starboardSelfStar = allowSelfStar;
            await settings.save();
            settingsCache.invalidate(guild.id);

            return await interaction.reply({
                content: `✅ Self-starring is now **${allowSelfStar ? 'Allowed' : 'Blocked'}**! ${allowSelfStar ? 'Users can star their own messages.' : 'Users cannot star their own messages to boost threshold counts.'}`,
                allowedMentions: { repliedUser: false }
            });
        }

        // Public Views: stats, top, halloffame, random
        const settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
        let initialEmbed;
        let activeTab = 'stats';

        if (subcommand === 'top') {
            initialEmbed = await buildTopMembersEmbed(guild);
            activeTab = 'top';
        } else if (subcommand === 'halloffame' || subcommand === 'hof') {
            initialEmbed = await buildHallOfFameEmbed(guild);
            activeTab = 'hof';
        } else if (subcommand === 'random') {
            initialEmbed = await buildRandomStarredEmbed(guild);
            activeTab = 'random';
        } else {
            initialEmbed = await buildStatsEmbed(guild, settings);
            activeTab = 'stats';
        }

        const buttons = buildNavigationButtons(activeTab, guild.id);
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
            const freshSettings = await GuildSettings.findOne({ where: { guildId: guild.id } });

            if (i.customId === 'starboard_btn_stats') {
                activeTab = 'stats';
                const embed = await buildStatsEmbed(guild, freshSettings);
                await i.update({
                    embeds: [embed],
                    components: [buildNavigationButtons('stats', guild.id)]
                }).catch(() => {});
            } else if (i.customId === 'starboard_btn_top') {
                activeTab = 'top';
                const embed = await buildTopMembersEmbed(guild);
                await i.update({
                    embeds: [embed],
                    components: [buildNavigationButtons('top', guild.id)]
                }).catch(() => {});
            } else if (i.customId === 'starboard_btn_hof') {
                activeTab = 'hof';
                const embed = await buildHallOfFameEmbed(guild);
                await i.update({
                    embeds: [embed],
                    components: [buildNavigationButtons('hof', guild.id)]
                }).catch(() => {});
            } else if (i.customId === 'starboard_btn_random') {
                activeTab = 'random';
                const embed = await buildRandomStarredEmbed(guild);
                await i.update({
                    embeds: [embed],
                    components: [buildNavigationButtons('random', guild.id)]
                }).catch(() => {});
            }
        });

        collector.on('end', () => {
            reply.edit({ components: [] }).catch(() => {});
        });
    }
};
