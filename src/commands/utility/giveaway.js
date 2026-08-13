const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const Giveaway = require('../../database/models/Giveaway');
const { parseDuration, buildGiveawayEmbed, buildGiveawayComponents, endGiveaway, rerollGiveaway } = require('../../utils/giveawayManager');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    ephemeral: false,
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Manage server giveaways with prize names, custom banners, timers, and rerolls.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents | PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('Start a new giveaway in a channel.')
                .addStringOption(opt =>
                    opt.setName('prize')
                        .setDescription('The prize or item name being given away (e.g. Discord Nitro 1 Month)')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('duration')
                        .setDescription('Giveaway duration (e.g., 30s, 10m, 2h, 1d, 1w)')
                        .setRequired(true))
                .addIntegerOption(opt =>
                    opt.setName('winners')
                        .setDescription('Number of winners (default: 1)')
                        .setMinValue(1)
                        .setMaxValue(25)
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('Additional details, rules, or instructions for the giveaway')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('image')
                        .setDescription('Banner image URL to display on the giveaway card')
                        .setRequired(false))
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to post the giveaway (defaults to current channel)')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false))
                .addRoleOption(opt =>
                    opt.setName('required_role')
                        .setDescription('Role required for members to enter the giveaway')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('Immediately end an active giveaway and pick winner(s).')
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('Message ID of the active giveaway')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('reroll')
                .setDescription('Reroll winner(s) for a completed giveaway.')
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('Message ID of the completed giveaway')
                        .setRequired(true))
                .addIntegerOption(opt =>
                    opt.setName('winners')
                        .setDescription('Number of new winners to select (default: 1)')
                        .setMinValue(1)
                        .setMaxValue(25)
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List active and recently completed giveaways on this server.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'start') {
            const prize = interaction.options.getString('prize');
            const durationStr = interaction.options.getString('duration');
            const winnerCount = interaction.options.getInteger('winners') || 1;
            const description = interaction.options.getString('description') || null;
            const imageUrl = interaction.options.getString('image') || null;
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
            const requiredRole = interaction.options.getRole('required_role');

            const durationMs = parseDuration(durationStr);
            if (!durationMs) {
                return await handleError(
                    interaction,
                    'Invalid Duration Format',
                    'Please specify a valid duration format (minimum 5 seconds):\n• `30s` (30 seconds)\n• `15m` (15 minutes)\n• `2h` (2 hours)\n• `1d` (1 day)\n• `1w` (1 week)'
                );
            }

            if (imageUrl && !/^https?:\/\/.+/i.test(imageUrl)) {
                return await handleError(
                    interaction,
                    'Invalid Image URL',
                    'Please provide a valid image URL starting with `http://` or `https://`.'
                );
            }

            const endTime = new Date(Date.now() + durationMs);

            // Construct dummy model instance for embed builder
            const tempGiveaway = {
                title: prize,
                description,
                hostId: interaction.user.id,
                winnerCount,
                endTime,
                requiredRoleId: requiredRole ? requiredRole.id : null,
                imageUrl
            };

            const embed = buildGiveawayEmbed(tempGiveaway, false, []);
            const components = buildGiveawayComponents(false, 0);

            let giveawayMsg;
            try {
                giveawayMsg = await targetChannel.send({ embeds: [embed], components });
            } catch (err) {
                return await handleError(
                    interaction,
                    'Channel Permission Error',
                    `Failed to send giveaway message to <#${targetChannel.id}>. Make sure Nora has Send Messages & Embed Links permissions in that channel.`
                );
            }

            await Giveaway.create({
                messageId: giveawayMsg.id,
                guildId: interaction.guild.id,
                channelId: targetChannel.id,
                hostId: interaction.user.id,
                title: prize,
                description,
                winnerCount,
                endTime,
                requiredRoleId: requiredRole ? requiredRole.id : null,
                imageUrl,
                participants: '[]',
                winners: '[]',
                ended: false
            });

            return await handleSuccess(
                interaction,
                '🎉 Giveaway Created!',
                `Your giveaway for **${prize}** has been posted in <#${targetChannel.id}>!\n\n` +
                `⏳ **Ends:** <t:${Math.floor(endTime.getTime() / 1000)}:R>\n` +
                `🆔 **Message ID:** \`${giveawayMsg.id}\``
            );
        }

        if (subcommand === 'end') {
            const messageId = interaction.options.getString('message_id').trim();
            const result = await endGiveaway(interaction.client, messageId);

            if (!result.success) {
                return await handleError(interaction, 'End Giveaway Failed', result.error);
            }

            return await handleSuccess(
                interaction,
                '🎉 Giveaway Ended',
                `Giveaway **${result.giveaway.title}** has been manually ended!\n` +
                `🏆 **Winner(s):** ${result.winners.length > 0 ? result.winners.map(w => `<@${w}>`).join(', ') : 'None'}`
            );
        }

        if (subcommand === 'reroll') {
            const messageId = interaction.options.getString('message_id').trim();
            const winnersToPick = interaction.options.getInteger('winners') || 1;

            const result = await rerollGiveaway(interaction.client, messageId, winnersToPick);
            if (!result.success) {
                return await handleError(interaction, 'Reroll Failed', result.error);
            }

            return await handleSuccess(
                interaction,
                '🎲 Giveaway Rerolled!',
                `Selected new winner(s) for giveaway!\n` +
                `🏆 **New Winner(s):** ${result.winners.map(w => `<@${w}>`).join(', ')}`
            );
        }

        if (subcommand === 'list') {
            const activeGiveaways = await Giveaway.findAll({
                where: { guildId: interaction.guild.id },
                order: [['createdAt', 'DESC']],
                limit: 10
            });

            if (!activeGiveaways || activeGiveaways.length === 0) {
                return await handleError(interaction, 'No Giveaways Found', 'There are no active or recent giveaways on this server.');
            }

            const listEmbed = new EmbedBuilder()
                .setTitle(`🎉 Giveaway List — ${interaction.guild.name}`)
                .setColor('#ff4757')
                .setTimestamp();

            let desc = '';
            for (const g of activeGiveaways) {
                let participantsCount = 0;
                try {
                    participantsCount = JSON.parse(g.participants || '[]').length;
                } catch (e) {}

                const endTimestamp = Math.floor(new Date(g.endTime).getTime() / 1000);
                const statusStr = g.ended ? '🏁 Ended' : `⏳ Active (<t:${endTimestamp}:R>)`;
                desc += `• **${g.title}** | ${statusStr}\n` +
                        `  ↳ **Message ID:** \`${g.messageId}\` | **Entries:** ${participantsCount} | **Host:** <@${g.hostId}>\n\n`;
            }

            listEmbed.setDescription(desc || 'No giveaways recorded.');
            return await interaction.reply({ embeds: [listEmbed] });
        }
    }
};
