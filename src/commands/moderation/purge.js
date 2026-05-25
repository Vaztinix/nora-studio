const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Massively delete messages in this channel with advanced filtering.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addIntegerOption(opt => 
            opt.setName('amount')
            .setDescription('Total messages to scan (Max 100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
        .addStringOption(opt => 
            opt.setName('filter')
            .setDescription('Who to delete messages from')
            .setRequired(false)
            .addChoices(
                { name: 'Delete EVERYTHING', value: 'all' },
                { name: 'Only BOT Messages', value: 'bots' },
                { name: 'Only HUMAN Messages', value: 'users' }
            )
        )
        .addUserOption(opt => 
            opt.setName('target')
            .setDescription('Only delete messages from a specific user')
            .setRequired(false)
        )
        .setContexts(0)
        .setIntegrationTypes(0),

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount');
        const filter = interaction.options.getString('filter') || 'all';
        const target = interaction.options.getUser('target');

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Manage Messages** physical permission. Please update my roles.');
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch the pool of messages
            const messages = await interaction.channel.messages.fetch({ limit: amount });
            
            // Apply filtering logic
            let toDelete = messages;

            if (target) {
                // If a specific target is set, we ignore the 'filter' dropdown for precision
                toDelete = messages.filter(m => m.author.id === target.id);
            } else if (filter === 'bots') {
                toDelete = messages.filter(m => m.author.bot);
            } else if (filter === 'users') {
                toDelete = messages.filter(m => !m.author.bot);
            }

            if (toDelete.size === 0) {
                return interaction.editReply({ content: 'I scanned the specified range but found zero messages that matched your filter.' });
            }

            // Bulk Delete: Nora can only delete messages younger than 14 days
            const deleted = await interaction.channel.bulkDelete(toDelete, true);
            
            const count = deleted.size;
            const targetStr = target ? `<@${target.id}>` : (filter === 'all' ? 'everyone' : filter);

            const embed = new EmbedBuilder()
                .setTitle('Purge Successful')
                .setDescription(`Successfully cleared **${count}** messages from **${targetStr}** in the last **${amount}** messages scanned.`)
                .setColor(0x57acf2)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            // Optional Logging: If server logging is enabled, we track this action
            console.log(`[Moderation] ${interaction.user.tag} purged ${count} messages from ${targetStr} in #${interaction.channel.name}`);

        } catch (error) {
            console.error('[Purge Fault]:', error);
            if (error.code === 50034) {
                return interaction.editReply({ content: 'I cannot delete messages older than 14 days due to Discord limitations.' });
            }
            return interaction.editReply({ content: 'I ran into a technical error while attempting the purge. Please ensure I have the "Manage Messages" permission.' });
        }
    }
};
