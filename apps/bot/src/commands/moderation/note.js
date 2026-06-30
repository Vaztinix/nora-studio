const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Note = require('../../database/models/Note');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('note')
        .setDescription('Moderator notes management')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a moderator note to the user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to add a note to')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('content')
                        .setDescription('The content of the note')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a moderator note from a user')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('The note ID')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View a users moderator note')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to view notes for')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'add') {
                const user = interaction.options.getUser('user');
                const content = interaction.options.getString('content');

                const note = await Note.create({
                    guildId: interaction.guild.id,
                    userId: user.id,
                    moderatorId: interaction.user.id,
                    content: content
                });

                return await handleSuccess(interaction, 'Note Added', `Successfully added note ID ${note.id} to user ${user.tag}.`);
            } else if (subcommand === 'remove') {
                const id = interaction.options.getInteger('id');

                const deleted = await Note.destroy({
                    where: { id: id, guildId: interaction.guild.id }
                });

                if (!deleted) {
                    return await handleError(interaction, 'Note Not Found', `No note exists with ID ${id}.`);
                }

                return await handleSuccess(interaction, 'Note Removed', `Successfully removed note ID ${id}.`);
            } else if (subcommand === 'view') {
                const user = interaction.options.getUser('user');

                const notes = await Note.findAll({
                    where: { userId: user.id, guildId: interaction.guild.id },
                    order: [['timestamp', 'DESC']]
                });

                const embed = new EmbedBuilder()
                    .setTitle(`Notes for ${user.tag}`)
                    .setColor(0x57acf2)
                    .setThumbnail(user.displayAvatarURL());

                if (notes.length > 0) {
                    const notesList = notes.map(n => {
                        return `**ID: ${n.id}**\n**Moderator:** <@${n.moderatorId}>\n**Note:** ${n.content}\n**Date:** <t:${Math.floor(n.timestamp.getTime() / 1000)}:R>`;
                    }).join('\n\n');

                    embed.setDescription(notesList);
                } else {
                    embed.setDescription(`This user has no moderator notes.`);
                }

                return await interaction.reply({ embeds: [embed] });
            }
        } catch (err) {
            console.error(`Error executing note command:`, err);
            return await handleError(interaction, 'Error', 'An error occurred while managing the note.');
        }
    }
};
