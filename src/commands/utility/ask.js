const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Ask Nora AI a question.')
        .addStringOption(option => 
            option.setName('prompt')
                .setDescription('What would you like to ask?')
                .setRequired(true)
        ),

    async execute(interaction) {
        const query = interaction.options?.getString?.('prompt') || 'No question provided.';

        const embed = new EmbedBuilder()
            .setTitle('🤖 Nora AI Assistant Unavailable')
            .setColor(0x7C3AED)
            .setDescription(
                `The **AI Chat & Ask** feature is currently undergoing maintenance and system upgrades, and is temporarily unavailable.\n\n` +
                `Our team is fine-tuning Nora's next-generation AI model for higher speed and better accuracy. We appreciate your patience while this upgrade is in progress!`
            )
            .addFields(
                { name: '📝 Your Prompt', value: `*${query.length > 250 ? query.substring(0, 247) + '...' : query}*` }
            )
            .setFooter({ text: 'Nora AI Engine • Maintenance in Progress' })
            .setTimestamp();

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
};
