const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { exportData } = require('../../utils/persistence');

module.exports = {
    category: 'owner',
    data: new SlashCommandBuilder()
        .setName('nora-admin')
        .setDescription('Nora Systems Control Unit (Owner Only)')
        .setDefaultMemberPermissions(0)
        .setDMPermission(true)
        .addSubcommand(sub =>
            sub.setName('backup')
                .setDescription('Generate a physical JSON export of all system leveling and configuration data.')
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
        }
    },
};
