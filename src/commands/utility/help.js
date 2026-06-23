const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, PermissionFlagsBits } = require('discord.js');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('See all the ways Nora can help your server.'),

    async execute(interaction) {
        const isMod = interaction.member && (
            interaction.member.permissions.has(PermissionFlagsBits.BanMembers) ||
            interaction.member.permissions.has(PermissionFlagsBits.KickMembers) ||
            interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
            interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
            interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) ||
            interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
            interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        );

        const getEmbed = (category) => {
            const embed = new EmbedBuilder()
                .setColor(0x57acf2)
                .setTimestamp()
                .setFooter({ text: 'Nora Assistant • Help Center' });

            if (category === 'main') {
                embed.setTitle('Nora Help Center 💖')
                     .setDescription('Welcome! Nora is a multi-purpose assistant bot designed to automate server configuration, secure verification, leveling, and moderation.\n\nUse the dropdown menu below to explore our features by category.');
                
                if (isMod) {
                    embed.addFields(
                        { name: '🛡️ Safety & Moderation', value: 'AutoMod configurations, warning tracking, timeouts, bans, kicks, and message cleanups.' }
                    );
                }
                embed.addFields(
                    { name: '👤 Profiles & Leveling', value: 'Interactive global rank cards, level up updates, server XP leaderboards, and custom rewards.' },
                    { name: '⚙️ Setup & Config', value: 'Verification setups, Roblox linkages, Top.gg server integrations, and general bot configs.' },
                    { name: '🎮 Fun & Games', value: 'Chat with Nora, counting logs, rock paper scissors, guess game rewards, and announcement broadcasts.' }
                );
            } else if (category === 'safety') {
                embed.setTitle('🛡️ Safety & Moderation Commands')
                     .setDescription('Automated filters and moderation tools to secure your chat and enforce rules.')
                     .addFields(
                          { name: '`/warn`', value: 'Centralized warning management (add, list, clear, edit, delete).' },
                          { name: '`/ban` & `/kick`', value: 'Ban or kick members who break the rules.' },
                          { name: '`/mute` & `/unmute`', value: 'Mute/unmute active members in channels.' },
                          { name: '`/purge`', value: 'Clean up large quantities of chat spam quickly.' },
                          { name: '`/role`', value: 'Assign or remove roles from a user.' }
                     );
            } else if (category === 'profile') {
                embed.setTitle('👤 Profiles & Leveling Commands')
                     .setDescription('Chat activities reward users with levels, badges, and roles.')
                     .addFields(
                          { name: '`/rank`', value: 'Check your current level progress and XP.' },
                          { name: '`/leaderboard`', value: 'Compare server XP ranking charts with other users.' },
                          { name: '`/mycard`', value: 'Display your cross-server interactive profile badge, custom bio, linked integrations, and earned awards.' }
                     );
                if (interaction.member && interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    embed.addFields({ name: '`/setlevel`', value: 'Manage user levels manually (Administrators).' });
                }
            } else if (category === 'setup') {
                embed.setTitle('⚙️ Setup & Configuration Commands')
                     .setDescription('Bot system adjustments and connection linkages.');
                if (interaction.member && interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    embed.addFields({ name: '`/setup`', value: 'Centralized server configuration dashboard and module setup (Manage Server only).' });
                }
                embed.addFields(
                    { name: '`/info` & `/invite`', value: 'Review bot uptime, status telemetry, and invite links.' },
                    { name: '`/language`', value: 'Change local command languages.' },
                    { name: '`/verify`', value: 'Verify and link Roblox account to gain server roles.' },
                    { name: '`/roblox`', value: 'Search profile and group structures on Roblox.' }
                );
            } else if (category === 'fun') {
                embed.setTitle('🎮 Fun & Games Commands')
                     .setDescription('Interactive tools and engagement systems.')
                     .addFields(
                          { name: '`/ask`', value: 'Chat with Nora\'s cognitive framework.' },
                          { name: '`/guess`', value: 'Play the numbers guess game for bonus XP.' },
                          { name: '`/rps`', value: 'Play rock paper scissors against Nora.' },
                          { name: '`/announce`', value: 'Broadcast styled announcement cards.' },
                          { name: '`/setjoinlink`', value: 'Configure your active join link for playing Roblox experiences.' }
                     );
            }
            return embed;
        };

        const dropdownOptions = [
            { label: 'Main Menu', value: 'main', emoji: '💖' }
        ];
        if (isMod) {
            dropdownOptions.push({ label: 'Safety & Moderation', value: 'safety', emoji: '🛡️' });
        }
        dropdownOptions.push(
            { label: 'Profiles & Leveling', value: 'profile', emoji: '👤' },
            { label: 'Setup & Config', value: 'setup', emoji: '⚙️' },
            { label: 'Fun & Games', value: 'fun', emoji: '🎮' }
        );

        const dropdown = new StringSelectMenuBuilder()
            .setCustomId('help_select')
            .setPlaceholder('Choose a help category...')
            .addOptions(dropdownOptions);

        const row = new ActionRowBuilder().addComponents(dropdown);

        const response = await interaction.reply({
            embeds: [getEmbed('main')],
            components: [row],
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 600000
        });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return;
            const category = i.values[0];
            await i.update({
                embeds: [getEmbed(category)],
                components: [row]
            });
        });
    }
};
