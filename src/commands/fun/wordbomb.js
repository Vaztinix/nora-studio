const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

const SYLLABLES = [
    'TIC', 'PRO', 'VER', 'STR', 'EXP', 'CAT', 'MON', 'DRA', 'ENT', 'ING',
    'CON', 'DIS', 'PRE', 'TER', 'INT', 'SUB', 'TRA', 'COM', 'GRA', 'BLE',
    'PLA', 'STA', 'FOR', 'GEN', 'MAN', 'PAR', 'RES', 'SEN', 'SUR', 'TEN'
];

// Active game rooms by channel ID
const activeGames = new Map();

module.exports = {
    category: 'fun',
    data: new SlashCommandBuilder()
        .setName('wordbomb')
        .setDescription('Start a fast-paced Word Bomb syllable party game in chat or voice-text!')
        .addIntegerOption(opt =>
            opt.setName('timer')
                .setDescription('Time limit in seconds per round (default: 15s)')
                .setRequired(false)
                .setMinValue(8)
                .setMaxValue(30)),

    async execute(interaction) {
        const channelId = interaction.channelId;
        if (activeGames.has(channelId)) {
            return interaction.reply({
                content: '💣 A Word Bomb game is already running in this channel! Finish the round or wait for the bomb to explode.',
                ephemeral: true
            });
        }

        const timerSec = interaction.options.getInteger('timer') || 15;
        const syllable = SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
        const startTime = Date.now();
        const endTime = startTime + (timerSec * 1000);

        activeGames.set(channelId, { syllable, endTime });

        const embed = new EmbedBuilder()
            .setTitle('💣 WORD BOMB: Quick! Defuse the Bomb!')
            .setColor(0xED4245)
            .setDescription(`Type an English word containing the letters:\n# **\`${syllable}\`**\n\n⏰ You have **${timerSec} seconds** before the bomb detonates!\nAnyone in this channel or voice text can answer.`)
            .addFields(
                { name: 'Target Syllable', value: `\`${syllable}\``, inline: true },
                { name: 'Timer', value: `\`${timerSec}s\``, inline: true },
                { name: 'XP Bounty', value: '`+50 XP`', inline: true }
            )
            .setFooter({ text: 'Nora Party Games • Activities & Voice' })
            .setTimestamp();

        const msg = await interaction.reply({ embeds: [embed], fetchReply: true });

        // Message collector for answers
        const filter = m => !m.author.bot && m.content.toUpperCase().includes(syllable);
        const collector = interaction.channel.createMessageCollector({
            filter,
            time: timerSec * 1000,
            max: 1
        });

        collector.on('collect', async m => {
            const word = m.content.trim().toUpperCase();
            // Basic length and non-gibberish check
            if (word.length < 3 || !/^[A-Z]+$/.test(word)) return;

            activeGames.delete(channelId);

            // Award XP to solver
            try {
                const UserLevel = require('../../database/models/UserLevel');
                const [userLevel] = await UserLevel.findOrCreate({
                    where: { userId: m.author.id, guildId: interaction.guildId },
                    defaults: { xp: 0, level: 1 }
                });
                await userLevel.increment('xp', { by: 50 });
            } catch (_) {}

            const winEmbed = new EmbedBuilder()
                .setTitle('💥 Bomb Defused in the Nick of Time!')
                .setColor(0x57F287)
                .setDescription(`🏆 **${m.author.tag}** defused the bomb with the word **\`${word}\`**!\n\n✨ **+50 XP** awarded to <@${m.author.id}>!`)
                .addFields(
                    { name: 'Word Submitted', value: `\`${word}\``, inline: true },
                    { name: 'Syllable Defused', value: `\`${syllable}\``, inline: true },
                    { name: 'Time Elapsed', value: `${((Date.now() - startTime) / 1000).toFixed(1)}s`, inline: true }
                )
                .setFooter({ text: 'Nora Word Bomb Champion' })
                .setTimestamp();

            await interaction.followUp({ embeds: [winEmbed] }).catch(() => {});
        });

        collector.on('end', async (collected, reason) => {
            if (collected.size === 0) {
                activeGames.delete(channelId);
                const explodeEmbed = new EmbedBuilder()
                    .setTitle('💥 BOOOOOOM! The Bomb Detonated!')
                    .setColor(0xED4245)
                    .setDescription(`Nobody submitted a word containing **\`${syllable}\`** in time!\n\nBetter luck next round! Use \`/wordbomb\` to try again.`)
                    .setFooter({ text: 'Nora Party Games' })
                    .setTimestamp();

                await interaction.followUp({ embeds: [explodeEmbed] }).catch(() => {});
            }
        });
    }
};

