const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const ReactionRole = require('../../database/models/ReactionRole');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('Manage reaction roles for the server.')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a new reaction role to a message.')
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel containing the message').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
                .addStringOption(opt => opt.setName('message_id').setDescription('The ID of the target message').setRequired(true))
                .addStringOption(opt => opt.setName('emoji').setDescription('The emoji to react with (Unicode or custom)').setRequired(true))
                .addRoleOption(opt => opt.setName('role').setDescription('The role to assign').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a reaction role configuration.')
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel containing the message').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
                .addStringOption(opt => opt.setName('message_id').setDescription('The ID of the target message').setRequired(true))
                .addStringOption(opt => opt.setName('emoji').setDescription('The emoji configured (Unicode or custom)').setRequired(true))
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const channel = interaction.options.getChannel('channel');
        const messageId = interaction.options.getString('message_id');
        const emojiOption = interaction.options.getString('emoji').trim();

        // Resolve emoji key (ID for custom, character name for standard)
        let emojiKey = emojiOption;
        const customEmojiRegex = /^<?(a)?:([a-zA-Z0-9_]+):([0-9]+)>?$/;
        const customMatch = emojiOption.match(customEmojiRegex);
        if (customMatch) {
            emojiKey = customMatch[3];
        }

        if (subcommand === 'add') {
            const role = interaction.options.getRole('role');
            await interaction.deferReply({ ephemeral: true });

            // Verify role hierarchy
            const botHighest = interaction.guild.members.me.roles.highest.position;
            if (role.position >= botHighest) {
                return await handleError(interaction, 'Role Too High', `I cannot manage the role **${role.name}** because it is positioned higher than my highest role.`);
            }

            try {
                // Fetch the message to verify it exists and add reaction
                const targetMessage = await channel.messages.fetch(messageId).catch(() => null);
                if (!targetMessage) {
                    return await handleError(interaction, 'Message Not Found', 'Could not locate the message with the provided ID in that channel.');
                }

                // Add database configuration
                const [record, created] = await ReactionRole.findOrCreate({
                    where: { guildId: interaction.guild.id, messageId, emoji: emojiKey },
                    defaults: { roleId: role.id }
                });

                if (!created) {
                    await record.update({ roleId: role.id });
                }

                // Add the reaction to the message
                await targetMessage.react(emojiOption).catch(err => {
                    console.warn('[Reaction Role] Failed to react with user emoji:', err.message);
                });

                return await handleSuccess(interaction, 'Reaction Role Configured', `Reaction role successfully configured!\n- **Message**: \`${messageId}\` in <#${channel.id}>\n- **Emoji**: ${emojiOption}\n- **Role**: <@&${role.id}>`);
            } catch (error) {
                console.error('[Reaction Role Add Error]:', error);
                return await handleError(interaction, 'System Error', 'Failed to configure the reaction role.');
            }
        }

        if (subcommand === 'remove') {
            await interaction.deferReply({ ephemeral: true });

            try {
                const match = await ReactionRole.findOne({
                    where: { guildId: interaction.guild.id, messageId, emoji: emojiKey }
                });

                if (!match) {
                    return await handleError(interaction, 'Not Configured', 'No reaction role was found matching that message ID and emoji.');
                }

                await match.destroy();

                // Optionally remove bot's reaction from the message
                const targetMessage = await channel.messages.fetch(messageId).catch(() => null);
                if (targetMessage) {
                    const botReaction = targetMessage.reactions.cache.get(emojiOption) || targetMessage.reactions.cache.find(r => r.emoji.id === emojiKey || r.emoji.name === emojiKey);
                    if (botReaction) {
                        await botReaction.users.remove(interaction.client.user.id).catch(() => {});
                    }
                }

                return await handleSuccess(interaction, 'Reaction Role Removed', `Successfully removed reaction role configuration for message \`${messageId}\` and emoji ${emojiOption}.`);
            } catch (error) {
                console.error('[Reaction Role Remove Error]:', error);
                return await handleError(interaction, 'System Error', 'Failed to remove the reaction role configuration.');
            }
        }
    }
};
