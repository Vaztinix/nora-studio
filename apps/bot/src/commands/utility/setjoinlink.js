const { SlashCommandBuilder } = require('@discordjs/builders');
const UserPrefs = require('../../database/models/UserPrefs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setjoinlink')
        .setDescription('Save or clear your Roblox experience invite link for others to join')
        .addStringOption(option => option.setName('link').setDescription('The Roblox share URL or code (or "clear" to remove)').setRequired(true)),
    async execute(interaction, settings) {
        await interaction.deferReply({ ephemeral: true });
        const link = interaction.options.getString('link').trim();
        const userId = interaction.user.id;

        try {
            let prefs = await UserPrefs.findOne({ where: { userId } });
            if (!prefs) prefs = await UserPrefs.create({ userId });

            if (!link || link.toLowerCase() === 'clear') {
                await prefs.update({ joinLink: null });
                return interaction.editReply({ content: '✅ Your join link has been cleared.' });
            }

            // Basic validation: accept roblox share URLs, roblox:// links, or full https game links
            const valid = /roblox\.com\/share\?code=|roblox:\/\/experiences\/start|roblox\.com\/games\//i.test(link);
            if (!valid) {
                return interaction.editReply({ content: '❌ That doesn\'t look like a valid Roblox experience invite or share URL. Provide the full `https://www.roblox.com/share?code=...` URL or `roblox://` link, or use `clear` to remove.' });
            }

            await prefs.update({ joinLink: link });
            return interaction.editReply({ content: `✅ Saved your join link. Others will see it on your card when Join Me is enabled.` });
        } catch (e) {
            console.error('setjoinlink error', e);
            return interaction.editReply({ content: '⚠️ Could not save your join link due to an internal error.' });
        }
    }
};
