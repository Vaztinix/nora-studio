const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const SiteAlert = require('../../database/models/SiteAlert');
const Notification = require('../../database/models/Notification');
const pushManager = require('../../utils/pushManager');

const APP_OWNER_ID = '1214048435632603137';

module.exports = {
    category: 'owner',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('sitebroadcast')
        .setDescription('Broadcast a custom site alert to all web users and push subscribers (Owner Only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true)
        .addStringOption(opt =>
            opt.setName('message')
                .setDescription('The alert message content to broadcast to all dashboard users')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('title')
                .setDescription('Custom title for the site alert / push notification (default: 📢 Nora Announcement)')
                .setRequired(false))
        .addStringOption(opt =>
            opt.setName('type')
                .setDescription('Alert style category')
                .setRequired(false)
                .addChoices(
                    { name: '📢 Announcement', value: 'announcement' },
                    { name: 'ℹ️ Information', value: 'info' },
                    { name: '⚠️ Warning', value: 'warning' },
                    { name: '✅ Success / Feature', value: 'success' }
                )),

    async execute(interaction) {
        if (interaction.user.id !== APP_OWNER_ID) {
            const { handleError } = require('../../utils/embeds');
            return handleError(interaction, 'Unauthorized Access', 'This system broadcast control is physically restricted to **Vaztinix** (`1214048435632603137`).');
        }

        await interaction.deferReply({ ephemeral: true });

        const message = interaction.options.getString('message');
        const title = interaction.options.getString('title') || '📢 Nora Site Announcement';
        const type = interaction.options.getString('type') || 'announcement';

        try {
            const { broadcastSiteAlert } = require('../../utils/pushManager');
            const { alertRecord, sentPushCount } = await broadcastSiteAlert(title, message, type, interaction.user.id);

            const embed = new EmbedBuilder()
                .setTitle('🚀 Site Broadcast Published Successfully!')
                .setDescription(`Your custom site alert has been disspatched to all web dashboard visitors and installed web app push subscribers.`)
                .setColor(0x7C3AED)
                .addFields(
                    { name: 'Alert Title', value: `\`${title}\``, inline: true },
                    { name: 'Category Type', value: `\`${type}\``, inline: true },
                    { name: 'Web Push Subscribers Notified', value: `**${sentPushCount}** device(s)`, inline: true },
                    { name: 'Broadcast Content', value: `"${message}"`, inline: false }
                )
                .setFooter({ text: `Owner Broadcast Engine • ID: ALERT-${alertRecord.id}` })
                .setTimestamp();

            return await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[SiteBroadcast Command Error]:', err);
            return await interaction.editReply({ content: `❌ Broadcast failed: ${err.message}` });
        }
    }
};
