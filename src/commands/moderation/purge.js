const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, Collection } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Massively delete messages in this channel with advanced filtering.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addIntegerOption(opt => 
            opt.setName('amount')
            .setDescription('Total messages to scan (Max 250)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(250)
        )
        .addStringOption(opt => 
            opt.setName('contains')
            .setDescription('Only delete messages containing a specific word or phrase')
            .setRequired(false)
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
        const contains = interaction.options.getString('contains');
        const filter = interaction.options.getString('filter') || 'all';
        const target = interaction.options.getUser('target');

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return handleError(interaction, 'Bot Permission Error', 'I lack the **Manage Messages** physical permission. Please update my roles.');
        }

        if (amount < 1 || amount > 250) {
            return handleError(interaction, 'Input Error', 'The amount to scan must be strictly between 1 and 250.');
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch the pool of messages in batches (Discord fetch limit is 100 per request)
            let messages = new Collection();
            let remaining = amount;
            let lastId = null;

            while (remaining > 0) {
                const fetchLimit = Math.min(remaining, 100);
                const options = { limit: fetchLimit };
                if (lastId) options.before = lastId;

                const batch = await interaction.channel.messages.fetch(options);
                if (batch.size === 0) break;

                for (const [id, msg] of batch) {
                    messages.set(id, msg);
                }

                lastId = batch.lastKey();
                remaining -= batch.size;

                if (batch.size < fetchLimit) break;
            }

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

            // Word / Keyword filter
            if (contains) {
                const keyword = contains.toLowerCase();
                toDelete = toDelete.filter(m => m.content && m.content.toLowerCase().includes(keyword));
            }

            // Exclude messages older than 14 days (Discord bulk delete limit)
            const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
            toDelete = toDelete.filter(m => m.createdTimestamp > fourteenDaysAgo);

            if (toDelete.size === 0) {
                return interaction.editReply({ content: 'I scanned the specified range but found zero messages that matched your filter.' });
            }

            // Bulk Delete in chunks of 100 (Discord limit per bulkDelete operation)
            // Note: interaction reply messages (webhook messages with buttons) cannot be bulk-deleted.
            // We individually delete any messages that bulkDelete misses.
            const toDeleteArray = Array.from(toDelete.values());
            let totalDeleted = 0;

            for (let i = 0; i < toDeleteArray.length; i += 100) {
                const chunk = toDeleteArray.slice(i, i + 100);
                try {
                    const deletedBatch = await interaction.channel.bulkDelete(chunk, true);
                    totalDeleted += deletedBatch.size;

                    // Find messages skipped by bulkDelete (interaction responses, messages with components, or older msgs)
                    const deletedIds = new Set(deletedBatch.keys());
                    const skipped = chunk.filter(m => !deletedIds.has(m.id));
                    for (const msg of skipped) {
                        try {
                            await msg.delete();
                            totalDeleted++;
                        } catch (e) {
                            // Message may already be gone or undeletable — skip silently
                        }
                    }
                } catch (bulkErr) {
                    // If entire bulkDelete fails, fall back to individual deletes
                    for (const msg of chunk) {
                        try {
                            await msg.delete();
                            totalDeleted++;
                        } catch (e) {}
                    }
                }
            }

            const targetStr = target ? `<@${target.id}>` : (filter === 'all' ? 'everyone' : filter);
            const wordFilterStr = contains ? ` containing **"${contains}"**` : '';

            const embed = new EmbedBuilder()
                .setTitle('Purge Successful')
                .setDescription(`Successfully cleared **${totalDeleted}** messages${wordFilterStr} from **${targetStr}** in the last **${messages.size}** messages scanned.`)
                .setColor(0x57acf2)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            // Optional Logging: If server logging is enabled, we track this action
            console.log(`[Moderation] ${interaction.user.tag} purged ${totalDeleted} messages from ${targetStr} in #${interaction.channel.name}`);

        } catch (error) {
            console.error('[Purge Fault]:', error);
            if (error.code === 50034) {
                return interaction.editReply({ content: 'I cannot delete messages older than 14 days due to Discord limitations.' });
            }
            return interaction.editReply({ content: 'I ran into a technical error while attempting the purge. Please ensure I have the "Manage Messages" permission.' });
        }
    }
};
