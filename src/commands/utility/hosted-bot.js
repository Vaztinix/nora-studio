const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const HostedBot = require('../../database/models/HostedBot');
const CustomCommand = require('../../database/models/CustomCommand');
const { validateBotToken, generateBotInviteUrl } = require('../../utils/botHosting');

const safeBotName = (value) => (value || 'Nora Hosted Bot').trim().slice(0, 64);
const safeCommandName = (value) => (value || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 32);
const safeText = (value, fallback = 'Unavailable') => (typeof value === 'string' && value.trim()) ? value.trim().slice(0, 1000) : fallback;

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('hosted-bot')
        .setDescription('Connect, inspect, and manage hosted bot profiles and custom commands.')
        .addSubcommand(sub => sub
            .setName('connect')
            .setDescription('Register a bot token and create a hosted bot profile.')
            .addStringOption(option => option.setName('token').setDescription('Your bot token from the Discord Developer Portal').setRequired(true))
            .addStringOption(option => option.setName('prefix').setDescription('Prefix for the hosted bot commands').setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all bots currently connected to your hosted bot dashboard.')
        )
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Remove a hosted bot profile by Discord bot ID.')
            .addStringOption(option => option.setName('bot_id').setDescription('The Discord bot ID to remove').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('stats')
            .setDescription('Show analytics for a hosted bot profile.')
            .addStringOption(option => option.setName('bot_id').setDescription('The Discord bot ID to inspect').setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName('command-add')
            .setDescription('Create a reusable custom command for a hosted bot.')
            .addStringOption(option => option.setName('bot_id').setDescription('The Discord bot ID this command belongs to').setRequired(true))
            .addStringOption(option => option.setName('name').setDescription('Command name (letters, numbers, hyphens only)').setRequired(true))
            .addStringOption(option => option.setName('type').setDescription('Command response type').setRequired(true)
                .addChoices(
                    { name: 'Text', value: 'text' },
                    { name: 'Embed JSON', value: 'embed' },
                    { name: 'Action', value: 'action' }
                ))
            .addStringOption(option => option.setName('trigger').setDescription('What event triggers the command').setRequired(true)
                .addChoices(
                    { name: 'Message', value: 'message' },
                    { name: 'Reaction', value: 'reaction' },
                    { name: 'Timer', value: 'timer' }
                ))
            .addStringOption(option => option.setName('response').setDescription('Response text or JSON payload for the command').setRequired(true))
            .addStringOption(option => option.setName('description').setDescription('Short description shown in help').setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName('command-list')
            .setDescription('List custom commands for a hosted bot.')
            .addStringOption(option => option.setName('bot_id').setDescription('The Discord bot ID to inspect').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('command-remove')
            .setDescription('Remove a custom command from a hosted bot profile.')
            .addStringOption(option => option.setName('bot_id').setDescription('The Discord bot ID that owns the command').setRequired(true))
            .addStringOption(option => option.setName('name').setDescription('The custom command name to delete').setRequired(true))
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply({ ephemeral: true });

        const ownerId = interaction.user.id;

        try {
            if (subcommand === 'connect') {
                const token = interaction.options.getString('token');
                const prefix = interaction.options.getString('prefix') || '!';
                const botInfo = await validateBotToken(token);

                const [bot] = await HostedBot.findOrCreate({
                    where: { id: botInfo.id, ownerId },
                    defaults: {
                        id: botInfo.id,
                        ownerId,
                        name: safeBotName(botInfo.username),
                        token,
                        inviteUrl: generateBotInviteUrl(botInfo.id, 'bot applications.commands'),
                        avatar: botInfo.avatar || null,
                        prefix,
                        isEnabled: true,
                    }
                });

                await bot.update({
                    name: safeBotName(botInfo.username || bot.name),
                    token,
                    inviteUrl: generateBotInviteUrl(botInfo.id, 'bot applications.commands'),
                    avatar: botInfo.avatar || bot.avatar,
                    prefix,
                    isEnabled: true,
                    ownerId
                });

                const embed = new EmbedBuilder()
                    .setTitle('Hosted Bot Connected')
                    .setDescription(`\`${bot.name}\` is now linked to your account.`)
                    .addFields(
                        { name: 'Bot ID', value: bot.id, inline: true },
                        { name: 'Prefix', value: `\`${bot.prefix}\``, inline: true },
                        { name: 'Invite URL', value: bot.inviteUrl || 'Unavailable', inline: false }
                    )
                    .setColor(0x57acf2)
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            if (subcommand === 'list') {
                const bots = await HostedBot.findAll({ where: { ownerId }, order: [['createdAt', 'DESC']] });

                if (!bots.length) {
                    return interaction.editReply({ content: 'You do not have any hosted bots connected yet. Use `/hosted-bot connect` to add one.' });
                }

                const embed = new EmbedBuilder()
                    .setTitle('Hosted Bots')
                    .setDescription(`You have ${bots.length} connected hosted bot profile(s).`)
                    .setColor(0x57acf2);

                for (const bot of bots.slice(0, 8)) {
                    embed.addFields({
                        name: bot.name,
                        value: `ID: \`${bot.id}\`\nPrefix: \`${bot.prefix}\`\nCommands: ${bot.commandCount || 0}\nEnabled: ${bot.isEnabled ? 'Yes' : 'No'}`,
                        inline: false
                    });
                }

                return interaction.editReply({ embeds: [embed] });
            }

            if (subcommand === 'remove') {
                const botId = interaction.options.getString('bot_id').trim();
                const bot = await HostedBot.findOne({ where: { id: botId, ownerId } });
                if (!bot) {
                    return interaction.editReply({ content: `No hosted bot found for bot ID \`${botId}\`.` });
                }

                await CustomCommand.destroy({ where: { botId: bot.id } });
                await bot.destroy();
                return interaction.editReply({ content: `Removed hosted bot \`${bot.name}\` and any associated custom commands.` });
            }

            if (subcommand === 'stats') {
                const botId = interaction.options.getString('bot_id');
                const bot = botId
                    ? await HostedBot.findOne({ where: { id: botId, ownerId } })
                    : await HostedBot.findOne({ where: { ownerId }, order: [['createdAt', 'DESC']] });

                if (!bot) {
                    return interaction.editReply({ content: botId ? `No hosted bot found for bot ID \`${botId}\`.` : 'You do not have any hosted bots connected yet.' });
                }

                const commandCount = await CustomCommand.count({ where: { botId: bot.id } });
                const avgUsage = bot.totalEventsTriggered ? Math.round(bot.totalEventsTriggered / Math.max(1, commandCount || 1)) : 0;
                const remainingTokens = Math.max(0, bot.tokenLimit - bot.totalTokensUsed);

                const embed = new EmbedBuilder()
                    .setTitle(`Hosted Bot Analytics • ${bot.name}`)
                    .setDescription('Real-time summary from your hosted bot profile.')
                    .addFields(
                        { name: 'Bot ID', value: bot.id, inline: true },
                        { name: 'Status', value: bot.isEnabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Prefix', value: `\`${bot.prefix}\``, inline: true },
                        { name: 'Custom Commands', value: `${commandCount}`, inline: true },
                        { name: 'Total Events', value: `${bot.totalEventsTriggered || 0}`, inline: true },
                        { name: 'Estimated Avg. Usage / Command', value: `${avgUsage}`, inline: true },
                        { name: 'Tokens Used', value: `${bot.totalTokensUsed || 0}`, inline: true },
                        { name: 'Remaining Tokens', value: `${remainingTokens}`, inline: true }
                    )
                    .setColor(0x57acf2)
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            if (subcommand === 'command-add') {
                const botId = interaction.options.getString('bot_id').trim();
                const name = safeCommandName(interaction.options.getString('name'));
                const type = interaction.options.getString('type');
                const trigger = interaction.options.getString('trigger');
                const response = safeText(interaction.options.getString('response'));
                const description = safeText(interaction.options.getString('description') || `Custom command ${name}`, `Custom command ${name}`);

                const bot = await HostedBot.findOne({ where: { id: botId, ownerId } });
                if (!bot) {
                    return interaction.editReply({ content: `No hosted bot found for bot ID \`${botId}\`.` });
                }

                if (!name) {
                    return interaction.editReply({ content: 'Please provide a valid command name using letters, numbers, and hyphens only.' });
                }

                const [command, created] = await CustomCommand.findOrCreate({
                    where: { botId: bot.id, name },
                    defaults: {
                        id: `${bot.id}-${name}`,
                        botId: bot.id,
                        name,
                        description,
                        type,
                        responseContent: response,
                        trigger,
                        arguments: [],
                        permissions: [],
                        tokenCost: 1,
                        totalExecutions: 0,
                        enabled: true
                    }
                });

                if (!created) {
                    await command.update({
                        description,
                        type,
                        responseContent: response,
                        trigger,
                        enabled: true
                    });
                }

                await bot.update({ commandCount: await CustomCommand.count({ where: { botId: bot.id } }) });

                return interaction.editReply({ content: `Custom command \`${name}\` ${created ? 'created' : 'updated'} for bot \`${bot.name}\`.` });
            }

            if (subcommand === 'command-list') {
                const botId = interaction.options.getString('bot_id').trim();
                const bot = await HostedBot.findOne({ where: { id: botId, ownerId } });
                if (!bot) {
                    return interaction.editReply({ content: `No hosted bot found for bot ID \`${botId}\`.` });
                }

                const commands = await CustomCommand.findAll({ where: { botId: bot.id }, order: [['createdAt', 'DESC']] });
                if (!commands.length) {
                    return interaction.editReply({ content: `Bot \`${bot.name}\` has no custom commands yet.` });
                }

                const embed = new EmbedBuilder()
                    .setTitle(`Custom Commands • ${bot.name}`)
                    .setDescription(`Showing ${commands.length} custom command(s).`)
                    .setColor(0x57acf2);

                for (const command of commands.slice(0, 8)) {
                    embed.addFields({
                        name: `/${command.name}`,
                        value: `Type: ${command.type}\nTrigger: ${command.trigger}\nEnabled: ${command.enabled ? 'Yes' : 'No'}\n${command.description || 'No description provided.'}`,
                        inline: false
                    });
                }

                return interaction.editReply({ embeds: [embed] });
            }

            if (subcommand === 'command-remove') {
                const botId = interaction.options.getString('bot_id').trim();
                const name = safeCommandName(interaction.options.getString('name'));
                const bot = await HostedBot.findOne({ where: { id: botId, ownerId } });
                if (!bot) {
                    return interaction.editReply({ content: `No hosted bot found for bot ID \`${botId}\`.` });
                }

                const command = await CustomCommand.findOne({ where: { botId: bot.id, name } });
                if (!command) {
                    return interaction.editReply({ content: `No custom command named \`${name}\` was found for bot \`${bot.name}\`.` });
                }

                await command.destroy();
                await bot.update({ commandCount: await CustomCommand.count({ where: { botId: bot.id } }) });
                return interaction.editReply({ content: `Removed custom command \`${name}\` from bot \`${bot.name}\`.` });
            }

            return interaction.editReply({ content: 'Unknown hosted bot action.' });
        } catch (error) {
            console.error('[Hosted Bot Command Error]', error);
            return interaction.editReply({ content: `I hit a snag: ${error.message || 'Unknown error.'}` });
        }
    }
};
