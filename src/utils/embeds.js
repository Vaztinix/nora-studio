const { EmbedBuilder } = require('discord.js');

module.exports = {
    // Dynamic Branding Engine: Matches Nora's Embeds to her Highest Role Color
    getRoleColor: (interaction) => {
        if (!interaction.guild) return 0x57acf2;
        const color = interaction.guild.members.me.roles.highest.color;
        // If color is 0 (Default/No color), return Nora Blue
        return color === 0 ? 0x57acf2 : color;
    },

    // 🚫 Casual Access/Error Embed
    handleError: async function(interaction, title, description) {
        // Validation: Prevent DiscordAPIError[50035] - description/title required
        const safeTitle = (typeof title === 'string' && title.trim().length > 0) ? title : 'Nora hit a snag';
        const safeDesc = (typeof description === 'string' && description.trim().length > 0) ? description : 'Something went slightly wrong in her brain. I\'ve sent a quick note to the team to take a look!';

        const embed = new EmbedBuilder()
            .setTitle(safeTitle)
            .setDescription(`${safeDesc}\n\n*If you believe this is a mistake, please reach out to a server administrator.*`)
            .setColor(module.exports.getRoleColor(interaction)) 
            .setAuthor({ name: 'Nora Assistant', iconURL: interaction.client?.user?.displayAvatarURL() || '' })
            .setFooter({ text: 'Access Control' })
            .setTimestamp();

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
            }
        } catch (e) {
            console.error('[Embed Trace] Failed to send error embed:', e);
        }
    },
    
    // Standard Success Embed
    handleSuccess: async function(interaction, title, description, ephemeral = true) {
        const safeTitle = (typeof title === 'string' && title.trim().length > 0) ? title : 'Success';
        const safeDesc = (typeof description === 'string' && description.trim().length > 0) ? description : 'Action completed successfully.';

        const embed = new EmbedBuilder()
            .setTitle(`Success: ${safeTitle}`)
            .setDescription(safeDesc)
            .setColor(module.exports.getRoleColor(interaction))
            .setFooter({ text: 'Nora' })
            .setTimestamp();

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else {
                await interaction.reply({ embeds: [embed], ephemeral }).catch(() => {});
            }
        } catch (e) {
            console.error('[Embed Trace] Failed to send success embed:', e);
        }
    }
};
