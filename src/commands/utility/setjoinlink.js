const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const UserPrefs = require('../../database/models/UserPrefs');

module.exports = {
    category: 'utility',
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('setjoinlink')
        .setDescription('Save, update, or clear your Roblox experience invite link for others to join you.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true)
        .addStringOption(option => 
            option.setName('link')
                .setDescription('The Roblox share URL or code (or "clear" to remove)')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const link = interaction.options.getString('link').trim();
        const userId = interaction.user.id;

        try {
            let [prefs] = await UserPrefs.findOrCreate({ where: { userId } });

            if (!link || link.toLowerCase() === 'clear' || link.toLowerCase() === 'remove') {
                await prefs.update({ joinLink: null });

                const clearedEmbed = new EmbedBuilder()
                    .setTitle('Roblox Join Link Cleared')
                    .setColor(0x4F545C)
                    .setDescription('Your Roblox experience link has been removed from your profile card.')
                    .setTimestamp();

                return interaction.editReply({ embeds: [clearedEmbed] });
            }

            // Validation: accept roblox share URLs, roblox:// links, or full https game links
            const valid = /roblox\.com\/share\?code=|roblox:\/\/experiences\/start|roblox\.com\/games\//i.test(link);
            if (!valid) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Invalid Roblox URL')
                    .setColor(0xED4245)
                    .setDescription(
                        'The link provided is not a recognized Roblox experience URL.\n\n' +
                        '**Accepted Formats**:\n' +
                        '• `https://www.roblox.com/share?code=...` (Roblox Share URL)\n' +
                        '• `https://www.roblox.com/games/12345/...` (Experience Link)\n' +
                        '• `roblox://experiences/start?placeId=...` (Deeplink)\n' +
                        '• Type `clear` to remove an existing link.'
                    )
                    .setTimestamp();

                return interaction.editReply({ embeds: [errorEmbed] });
            }

            await prefs.update({ joinLink: link });

            const successEmbed = new EmbedBuilder()
                .setTitle('Roblox Join Link Saved')
                .setColor(0x57F287)
                .setDescription(
                    'Your active Roblox join link has been updated.\n\n' +
                    'When other members view your profile card via `/mycard`, a **Join Game** button will be displayed.'
                )
                .addFields(
                    { name: 'Saved Link', value: `\`${link.length > 80 ? link.substring(0, 77) + '...' : link}\``, inline: false }
                )
                .setFooter({ text: 'Nora Roblox Integration' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Test Link')
                    .setURL(link.startsWith('http') ? link : 'https://www.roblox.com')
                    .setStyle(ButtonStyle.Link)
            );

            return interaction.editReply({ embeds: [successEmbed], components: [row] });
        } catch (e) {
            console.error('setjoinlink error', e);
            return interaction.editReply({ content: 'Could not save your join link due to an internal error.' });
        }
    }
};
