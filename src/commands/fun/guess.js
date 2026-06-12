const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'fun',
    data: new SlashCommandBuilder()
        .setName('guess')
        .setDescription('Play a number guessing game. Can you beat the odds?')
        .addIntegerOption(option => 
            option.setName('number')
            .setDescription('Your guess (between 1 and 100)')
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true)
        )
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1),
    
    async execute(interaction) {
        const { checkAndAwardEgg } = require('../../utils/easterEggSystem');
        checkAndAwardEgg(interaction, 4);

        const userGuess = interaction.options.getInteger('number');
        const targetNumber = Math.floor(Math.random() * 100) + 1;

        const embed = new EmbedBuilder()
            .setAuthor({ name: 'Nora Mini-Game', iconURL: interaction.client.user.displayAvatarURL() })
            .setFooter({ text: `Played by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp();

        if (userGuess === targetNumber) {
            embed.setTitle('🎉 JACKPOT! You won!')
                 .setColor(0x57acf2)
                 .setDescription(`Incredible luck! The number was exactly **${targetNumber}** and you guessed it perfectly. You are amazing!`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (Math.abs(userGuess - targetNumber) <= 5) {
            embed.setTitle('😅 So Close!')
                 .setColor(0x57acf2)
                 .setDescription(`You were absolutely burning up! You guessed **${userGuess}**, but the secret number was **${targetNumber}**.`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (Math.abs(userGuess - targetNumber) <= 15) {
            embed.setTitle('🔍 Getting Warm!')
                 .setColor(0x57acf2)
                 .setDescription(`You guessed **${userGuess}**, but the secret number was **${targetNumber}**. Not too shabby!`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
            embed.setTitle('🥶 Ice Cold!')
                 .setColor(0x57acf2)
                 .setDescription(`Oof, you were way off! You guessed **${userGuess}**, but the true number was **${targetNumber}**. Better luck next time.`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    },
};
