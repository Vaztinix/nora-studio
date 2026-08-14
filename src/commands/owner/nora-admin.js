const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { exportData } = require('../../utils/persistence');

module.exports = {
    category: 'owner',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('nora-admin')
        .setDescription('Nora Systems Control Unit (Owner Only)')
        .setDefaultMemberPermissions(0)
        .setDMPermission(true)
        .addSubcommand(sub =>
            sub.setName('backup')
                .setDescription('Generate a physical JSON export of all system leveling and configuration data.')
        )
        .addSubcommand(sub =>
            sub.setName('broadcast')
                .setDescription('Broadcast a custom site alert message to all dashboard users (Owner only)')
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('The alert message content to broadcast to all site users')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('title')
                        .setDescription('Custom title for the site alert / push notification')
                        .setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('setname')
                .setDescription('Update Nora\'s Discord Username to a custom or cool font name (Owner only)')
                .addStringOption(opt =>
                    opt.setName('name')
                        .setDescription('The new name / cool font for Nora (e.g. 𝗡𝗼𝗿𝗮 ✦)')
                        .setRequired(true))
        ),

    async execute(interaction) {
        if (interaction.guild) {
            return await interaction.reply({ content: '⛔ This control command can only be executed in private Direct Messages with Nora.', ephemeral: true });
        }
        const APP_OWNER_ID = '1214048435632603137';
        if (interaction.user.id !== APP_OWNER_ID) {
            const { handleError } = require('../../utils/embeds');
            return handleError(interaction, 'Unauthorized Access', 'This system is physically locked to **Vaztinix**. The event has been logged.');
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'backup') {
            await interaction.deferReply({ ephemeral: true });

            const startTime = Date.now();
            console.log(`[Backup System] Initiating physical data export requested by ${interaction.user.tag} (${interaction.user.id})...`);

            const data = await exportData();
            if (!data) {
                console.error('[Backup System] Export Fault: Data manifest could not be generated.');
                return interaction.editReply({ content: 'System Export Fault: I could not generate the backup manifest.' });
            }

            const buffer = Buffer.from(JSON.stringify(data, null, 2));
            const attachment = new AttachmentBuilder(buffer, { name: `nora_backup_${new Date().toISOString().split('T')[0]}.json` });
            
            const execTime = Date.now() - startTime;
            const fileSizeKB = (buffer.length / 1024).toFixed(2);
            
            const userLevelsCount = data.data.userLevels?.length || 0;
            const guildSettingsCount = data.data.guildSettings?.length || 0;

            console.log(`[Backup System] Export Success ✅`);
            console.log(`┣ Size: ${fileSizeKB} KB`);
            console.log(`┣ Profiles: ${userLevelsCount}`);
            console.log(`┣ Environments: ${guildSettingsCount}`);
            console.log(`┗ Time: ${execTime}ms`);

            const embed = new EmbedBuilder()
                .setTitle('System Data Export Successful')
                .setDescription('The physical manifest of all leveling status and server configurations has been generated successfully. Please save this file in a secure location.')
                .setColor(0x57acf2)
                .addFields(
                    { name: 'Records Exported', value: `**User Profiles:** ${userLevelsCount}\n**Server Configurations:** ${guildSettingsCount}`, inline: true },
                    { name: 'Meta Metrics', value: `**File Size:** ${fileSizeKB} KB\n**Process Time:** ${execTime}ms`, inline: true },
                    { name: 'Version Control', value: `\`${data.version}\``, inline: false }
                )
                .setFooter({ text: `System Persistence HQ • Executed by ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } else if (subcommand === 'broadcast') {
            await interaction.deferReply({ ephemeral: true });

            const message = interaction.options.getString('message');
            const title = interaction.options.getString('title') || '📢 Nora Site Announcement';

            const { broadcastSiteAlert } = require('../../utils/pushManager');
            const { sentPushCount } = await broadcastSiteAlert(title, message, 'announcement', interaction.user.id);

            const embed = new EmbedBuilder()
                .setTitle('🚀 Site Broadcast Published')
                .setDescription(`Your alert message has been published to the web dashboard and pushed to active Web App subscribers.`)
                .setColor(0x7C3AED)
                .addFields(
                    { name: 'Title', value: `\`${title}\``, inline: true },
                    { name: 'Web Push Deliveries', value: `**${sentPushCount}** device(s)`, inline: true },
                    { name: 'Message', value: `"${message}"`, inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } else if (subcommand === 'setname') {
            await interaction.deferReply({ ephemeral: true });

            const newName = interaction.options.getString('name');
            const { Routes } = require('discord.js');

            try {
                await interaction.client.rest.patch(Routes.user(), {
                    body: { global_name: newName }
                });

                const { updateAllGuildNicknames } = require('../../utils/nameAnimator');
                await updateAllGuildNicknames(interaction.client, newName);

                const embed = new EmbedBuilder()
                    .setTitle('✨ Bot Name & Font Updated')
                    .setDescription(`Nora's Global Display Name and Server Nickname have been updated.`)
                    .setColor(0x10B981)
                    .addFields({ name: 'New Name', value: `\`${newName}\``, inline: true })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            } catch (err) {
                await interaction.editReply({ content: `❌ Failed to update name: ${err.message}` });
            }
        }
    },
};
