const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'fun',
    data: new SlashCommandBuilder()
        .setName('guess')
        .setDescription('Play a number guessing challenge with hints and difficulty tiers.')
        .addIntegerOption(option => 
            option.setName('number')
                .setDescription('Your guess')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('difficulty')
                .setDescription('Difficulty range')
                .addChoices(
                    { name: 'Easy (Range 1 - 50)', value: 'easy' },
                    { name: 'Normal (Range 1 - 100)', value: 'normal' },
                    { name: 'Hard (Range 1 - 500)', value: 'hard' },
                    { name: 'Expert (Range 1 - 1000)', value: 'expert' }
                )
                .setRequired(false)
        )
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1),
    
    async execute(interaction, settings) {
        const { checkAndAwardEgg } = require('../../utils/easterEggSystem');
        checkAndAwardEgg(interaction, 4);

        const difficulty = interaction.options.getString('difficulty') || 'normal';
        let min = 1;
        let max = 100;

        if (difficulty === 'easy') {
            max = 50;
        } else if (difficulty === 'hard') {
            max = 500;
        } else if (difficulty === 'expert') {
            max = 1000;
        } else if (settings && settings.guessGameMin !== undefined && settings.guessGameMax !== undefined) {
            min = settings.guessGameMin;
            max = settings.guessGameMax;
        }

        const userGuess = interaction.options.getInteger('number');

        if (userGuess < min || userGuess > max) {
            return handleError(
                interaction, 
                'Out of Bounds', 
                `Your guess of **${userGuess}** is outside the allowed range for **${difficulty.toUpperCase()}** difficulty (${min} - ${max}).`
            );
        }

        const targetNumber = Math.floor(Math.random() * (max - min + 1)) + min;
        const diff = Math.abs(userGuess - targetNumber);
        const direction = userGuess < targetNumber ? 'Higher (The secret number is larger)' : 'Lower (The secret number is smaller)';

        let statusTitle = '';
        let statusDesc = '';
        let embedColor = 0x5865F2;

        if (userGuess === targetNumber) {
            statusTitle = 'Exact Match! You Won';
            embedColor = 0x57F287;
            statusDesc = `You guessed **${userGuess}** and the secret number was **${targetNumber}**.\n\nOdds: \`1 in ${max - min + 1}\` (${((1 / (max - min + 1)) * 100).toFixed(2)}%)`;
        } else if (diff <= Math.max(2, Math.floor(max * 0.05))) {
            statusTitle = 'Almost Had It';
            embedColor = 0xED4245;
            statusDesc = `You guessed **${userGuess}**, but the secret number was **${targetNumber}**.\n\nClue: **${direction}**\nDistance: Off by **${diff}**.`;
        } else if (diff <= Math.max(5, Math.floor(max * 0.15))) {
            statusTitle = 'Close Guess';
            embedColor = 0xFEE75C;
            statusDesc = `You guessed **${userGuess}**, while the secret number was **${targetNumber}**.\n\nClue: **${direction}**\nDistance: Off by **${diff}**.`;
        } else {
            statusTitle = 'Not Quite';
            embedColor = 0x4F545C;
            statusDesc = `You guessed **${userGuess}**, but the secret number was **${targetNumber}**.\n\nClue: **${direction}**\nDistance: Off by **${diff}**.`;
        }

        const embed = new EmbedBuilder()
            .setAuthor({ 
                name: `Number Challenge [${difficulty.toUpperCase()}: ${min}-${max}]`, 
                iconURL: interaction.client.user.displayAvatarURL() 
            })
            .setTitle(statusTitle)
            .setColor(embedColor)
            .setDescription(statusDesc)
            .addFields(
                { name: 'Your Guess', value: `\`${userGuess}\``, inline: true },
                { name: 'Secret Number', value: `\`${targetNumber}\``, inline: true },
                { name: 'Range', value: `${min} to ${max}`, inline: true }
            )
            .setFooter({ text: `Played by ${interaction.user.tag}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
