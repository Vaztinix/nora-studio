const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { handleError } = require('../../utils/embeds');

const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Interactive server poll commands.')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a beautiful embedded poll with up to 10 choices.')
                .addStringOption(option =>
                    option.setName('question')
                        .setDescription('The question or topic of the poll')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('options')
                        .setDescription('Comma-separated list of options (e.g. Yes, No, Maybe)')
                        .setRequired(true)
                )
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Optional channel to send the poll to')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'create') {
            const question = interaction.options.getString('question');
            const optionsStr = interaction.options.getString('options');
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

            const choices = optionsStr
                .split(',')
                .map(c => c.trim())
                .filter(c => c.length > 0);

            if (choices.length < 2 || choices.length > 10) {
                return interaction.reply({
                    content: '❌ A poll must have between **2** and **10** options.',
                    ephemeral: true
                });
            }

            let description = '';
            for (let i = 0; i < choices.length; i++) {
                description += `${numberEmojis[i]} **${choices[i]}**\n\n`;
            }

            const embed = new EmbedBuilder()
                .setTitle(`📊 Poll: ${question}`)
                .setDescription(description.trim())
                .setColor('#57acf2')
                .setTimestamp()
                .setFooter({
                    text: `Created by ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL()
                });

            try {
                if (targetChannel.id !== interaction.channel.id) {
                    // Send to target channel, reply ephemerally to caller
                    const pollMsg = await targetChannel.send({ embeds: [embed] });
                    for (let i = 0; i < choices.length; i++) {
                        await pollMsg.react(numberEmojis[i]);
                    }
                    return interaction.reply({
                        content: `✅ Poll created successfully in <#${targetChannel.id}>.`,
                        ephemeral: true
                    });
                } else {
                    // Send to current channel (use standard reply)
                    const pollMsg = await interaction.reply({ embeds: [embed], fetchReply: true });
                    for (let i = 0; i < choices.length; i++) {
                        await pollMsg.react(numberEmojis[i]);
                    }
                }
            } catch (error) {
                console.error('[Poll Command Error]:', error);
                return interaction.reply({
                    content: '❌ Failed to create the poll. Please verify my permissions to send embeds and add reactions in the target channel.',
                    ephemeral: true
                });
            }
        }
    }
};
