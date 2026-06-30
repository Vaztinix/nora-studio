const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Generate a customizable invite for this channel.')
        .setDMPermission(false)
        .addIntegerOption(option =>
            option.setName('max_uses')
                .setDescription('Max number of users before link breaks (0 for unlimited)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('expiry')
                .setDescription('How long until the invite link expires')
                .addChoices(
                    { name: '30 Minutes', value: '1800' },
                    { name: '1 Hour', value: '3600' },
                    { name: '6 Hours', value: '21600' },
                    { name: '12 Hours', value: '43200' },
                    { name: '24 Hours', value: '86400' },
                    { name: '7 Days', value: '604800' },
                    { name: 'Never (Admin)', value: '0' }
                )
                .setRequired(false)),

    async execute(interaction) {
        const { checkAndAwardEgg } = require('../../utils/easterEggSystem');
        checkAndAwardEgg(interaction, 5);

        const maxUses = interaction.options.getInteger('max_uses') || 0;
        const expirySeconds = parseInt(interaction.options.getString('expiry') || '86400');

        // Check bot permissions
        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
            return handleError(interaction, 'Missing Permissions', 'I do not have the **Create Invite** permission in this server. Please update my roles.');
        }

        try {
            const invite = await interaction.channel.createInvite({
                maxAge: expirySeconds,
                maxUses: maxUses,
                unique: true,
                reason: `Requested by ${interaction.user.tag}`
            });

            // Calculate display string based on chosen value
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
                .setTitle('Channel Invite Generated')
                .setColor(0x57acf2)
                .setDescription(`An invite link to <#${interaction.channel.id}> has been successfully generated.`)
                .addFields(
                    { name: 'Link', value: invite.url, inline: false },
                    { name: 'Expiration', value: expiryDisplay, inline: true },
                    { name: 'Max Uses', value: maxUses === 0 ? 'Unlimited' : maxUses.toString(), inline: true }
                )
                .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error creating invite:', error);
            await handleError(interaction, 'Creation Failed', 'There was an unexpected issue generating the invite. Please try again later.');
        }
    },
};
