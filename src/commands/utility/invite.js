const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits 
} = require('discord.js');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Generate a customized server invite link or invite Nora to your own Discord server.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true)
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of invite link to generate')
                .addChoices(
                    { name: 'Invite Nora to a Server (Bot OAuth2 Link)', value: 'bot' },
                    { name: 'Create Channel / Server Invite Link', value: 'channel' }
                )
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('max_uses')
                .setDescription('Max uses for channel invite (0 for unlimited)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('expiry')
                .setDescription('How long until the channel invite expires')
                .addChoices(
                    { name: '30 Minutes', value: '1800' },
                    { name: '1 Hour', value: '3600' },
                    { name: '6 Hours', value: '21600' },
                    { name: '12 Hours', value: '43200' },
                    { name: '24 Hours', value: '86400' },
                    { name: '7 Days', value: '604800' },
                    { name: 'Permanent (Never Expires)', value: '0' }
                )
                .setRequired(false)),

    async execute(interaction) {
        const { checkAndAwardEgg } = require('../../utils/easterEggSystem');
        checkAndAwardEgg(interaction, 5);

        const type = interaction.options.getString('type') || (interaction.guild ? 'channel' : 'bot');
        const botId = interaction.client.user.id;
        const botInviteUrl = `https://discord.com/oauth2/authorize?client_id=${botId}&permissions=1102464543799&integration_type=0&scope=bot+applications.commands`;

        // -------------------------------------------------------------
        // Option 1: Bot Invite Link
        // -------------------------------------------------------------
        if (type === 'bot' || !interaction.guild) {
            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: 'Nora Assistant', 
                    iconURL: interaction.client.user.displayAvatarURL() 
                })
                .setTitle('Add Nora to Your Server')
                .setColor(0x5865F2)
                .setDescription(
                    'Invite Nora to manage moderation, leveling rank cards, tickets, anti-raid defenses, and community utilities.'
                )
                .addFields(
                    {
                        name: 'Permissions',
                        value: '• **Administrator** (recommended for full automod and channel locking)\n• Or select individual moderation permissions on the Discord authorization page.'
                    },
                    {
                        name: 'Setup',
                        value: 'Once invited, configure modules at [vaztinix.dev/dashboard](https://vaztinix.dev/dashboard) or run `/setup` in any channel.'
                    }
                )
                .setFooter({ text: 'Nora Assistant • vaztinix.dev' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Add to Server')
                    .setURL(botInviteUrl)
                    .setStyle(ButtonStyle.Link),
                new ButtonBuilder()
                    .setLabel('Support Server')
                    .setURL('https://discord.gg/Uxb2tNAxtp')
                    .setStyle(ButtonStyle.Link),
                new ButtonBuilder()
                    .setLabel('Dashboard')
                    .setURL('https://vaztinix.dev/dashboard')
                    .setStyle(ButtonStyle.Link)
            );

            return await interaction.reply({ embeds: [embed], components: [row] });
        }

        // -------------------------------------------------------------
        // Option 2: Channel Invite Link
        // -------------------------------------------------------------
        const maxUses = interaction.options.getInteger('max_uses') || 0;
        const expirySeconds = parseInt(interaction.options.getString('expiry') || '86400');

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
            return handleError(interaction, 'Missing Permissions', 'I lack the **Create Instant Invite** permission in this channel.');
        }

        try {
            const invite = await interaction.channel.createInvite({
                maxAge: expirySeconds,
                maxUses: maxUses,
                unique: true,
                reason: `Requested by ${interaction.user.tag}`
            });

            const expiryChoices = {
                '1800': '30 Minutes',
                '3600': '1 Hour',
                '21600': '6 Hours',
                '43200': '12 Hours',
                '86400': '24 Hours',
                '604800': '7 Days',
                '0': 'Permanent'
            };
            const expiryDisplay = expiryChoices[expirySeconds.toString()] || '24 Hours';

            const embed = new EmbedBuilder()
                .setAuthor({ name: interaction.guild.name, iconURL: interaction.guild.iconURL() })
                .setTitle('Server Invite Link')
                .setColor(0x5865F2)
                .setDescription(`An invite link to <#${interaction.channel.id}> has been created.`)
                .addFields(
                    { name: 'Invite URL', value: `\`${invite.url}\``, inline: false },
                    { name: 'Expiration', value: expiryDisplay, inline: true },
                    { name: 'Max Uses', value: maxUses === 0 ? 'Unlimited' : `${maxUses} user(s)`, inline: true }
                )
                .setFooter({ text: `Created by ${interaction.user.tag}` })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Open Link')
                    .setURL(invite.url)
                    .setStyle(ButtonStyle.Link),
                new ButtonBuilder()
                    .setLabel('Invite Nora Bot')
                    .setURL(botInviteUrl)
                    .setStyle(ButtonStyle.Link)
            );

            await interaction.reply({ embeds: [embed], components: [row] });
        } catch (error) {
            console.error('Error creating invite:', error);
            await handleError(interaction, 'Creation Failed', 'Failed to generate the invite link. Please check channel permissions.');
        }
    },
};
