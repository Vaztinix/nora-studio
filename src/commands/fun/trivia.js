const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

const TRIVIA_QUESTIONS = [
    {
        category: '🎮 Gaming',
        question: 'What is the name of the main protagonist in The Legend of Zelda series?',
        options: ['Zelda', 'Link', 'Ganon', 'Epona'],
        answer: 1,
        explanation: 'Link is the legendary hero, while Zelda is the princess of Hyrule.'
    },
    {
        category: '🎮 Gaming',
        question: 'In Minecraft, which mob explodes when it gets too close to the player?',
        options: ['Enderman', 'Skeleton', 'Creeper', 'Zombie Pigman'],
        answer: 2,
        explanation: 'Creepers silently approach the player and detonate after hissing.'
    },
    {
        category: '🤖 Discord & Tech',
        question: 'What encryption standard protects Nora Bot\'s stored credentials and database tokens?',
        options: ['MD5 Hash', 'DES', 'AES-256-GCM', 'Rot13'],
        answer: 2,
        explanation: 'Nora utilizes military-grade AES-256-GCM authenticated encryption for all stored sensitive credentials.'
    },
    {
        category: '🌌 Science & Space',
        question: 'Which planet in our solar system has the most prominent ring system?',
        options: ['Jupiter', 'Neptune', 'Saturn', 'Uranus'],
        answer: 2,
        explanation: 'Saturn has the most extensive and visually prominent ring system composed primarily of ice particles.'
    },
    {
        category: '🎬 Pop Culture & Anime',
        question: 'In "One Piece", what fruit gives Monkey D. Luffy his rubber body?',
        options: ['Mera Mera no Mi', 'Gomu Gomu no Mi', 'Ope Ope no Mi', 'Hito Hito no Mi'],
        answer: 1,
        explanation: 'Luffy consumed the Gomu Gomu no Mi (Rubber-Rubber Fruit).'
    },
    {
        category: '🎮 Gaming',
        question: 'Which esports game features the map "Dust II"?',
        options: ['Valorant', 'Counter-Strike', 'Call of Duty', 'Overwatch'],
        answer: 1,
        explanation: 'Dust II is one of the most iconic maps in Counter-Strike history.'
    },
    {
        category: '🤖 Discord & Tech',
        question: 'What is the maximum number of emojis a Discord guild on Level 3 Boost can upload?',
        options: ['100', '150', '250', '500'],
        answer: 2,
        explanation: 'Level 3 Nitro boosted servers can upload up to 250 custom emojis.'
    }
];

module.exports = {
    category: 'fun',
    data: new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('Start a live interactive Trivia Quiz party in chat or voice hangouts!')
        .addStringOption(opt =>
            opt.setName('category')
                .setDescription('Select a specific quiz category')
                .setRequired(false)
                .addChoices(
                    { name: '🎮 Gaming', value: 'Gaming' },
                    { name: '🤖 Discord & Tech', value: 'Tech' },
                    { name: '🌌 Science & Nature', value: 'Science' },
                    { name: '🎬 Pop Culture & Anime', value: 'Pop' }
                )),

    async execute(interaction) {
        const catFilter = interaction.options.getString('category');
        let pool = TRIVIA_QUESTIONS;
        if (catFilter) {
            pool = TRIVIA_QUESTIONS.filter(q => q.category.includes(catFilter));
            if (pool.length === 0) pool = TRIVIA_QUESTIONS;
        }

        const item = pool[Math.floor(Math.random() * pool.length)];

        const embed = new EmbedBuilder()
            .setTitle(`🧠 Nora Trivia Quiz • ${item.category}`)
            .setColor(0x5865F2)
            .setDescription(`### ${item.question}\n\nClick your answer below! You have **20 seconds**.`)
            .addFields(
                { name: 'A', value: item.options[0], inline: true },
                { name: 'B', value: item.options[1], inline: true },
                { name: 'C', value: item.options[2], inline: true },
                { name: 'D', value: item.options[3], inline: true }
            )
            .setFooter({ text: 'Nora Party Games • Activities & Voice Hangouts' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('trivia_0').setLabel('A').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('trivia_1').setLabel('B').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('trivia_2').setLabel('C').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('trivia_3').setLabel('D').setStyle(ButtonStyle.Primary)
        );

        const response = await interaction.reply({
            embeds: [embed],
            components: [row],
            fetchReply: true
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 20000
        });

        const participants = new Set();

        collector.on('collect', async btn => {
            if (participants.has(btn.user.id)) {
                return btn.reply({ content: 'You have already submitted your answer for this question!', ephemeral: true });
            }
            participants.add(btn.user.id);

            const chosenIdx = parseInt(btn.customId.replace('trivia_', ''), 10);
            const isCorrect = chosenIdx === item.answer;

            if (isCorrect) {
                try {
                    const UserLevel = require('../../database/models/UserLevel');
                    const [userLevel] = await UserLevel.findOrCreate({
                        where: { userId: btn.user.id, guildId: interaction.guildId },
                        defaults: { xp: 0, level: 1 }
                    });
                    await userLevel.increment('xp', { by: 40 });
                } catch (_) {}

                await btn.reply({
                    content: `🎉 **Correct!** The answer is **${item.options[item.answer]}**!\n✨ You earned **+40 XP**!`,
                    ephemeral: true
                });
            } else {
                await btn.reply({
                    content: `❌ **Incorrect.** You selected **${item.options[chosenIdx]}**.\nThe correct answer is **${item.options[item.answer]}**.`,
                    ephemeral: true
                });
            }
        });

        collector.on('end', async () => {
            const disabledRow = new ActionRowBuilder().addComponents(
                row.components.map(btn => ButtonBuilder.from(btn).setDisabled(true))
            );

            const endEmbed = EmbedBuilder.from(embed)
                .setTitle(`🧠 Trivia Ended • Answer: ${item.options[item.answer]}`)
                .setDescription(`### ${item.question}\n\n✅ **Correct Answer:** **${item.options[item.answer]}**\n💡 *${item.explanation}*\n\nParticipants: **${participants.size} players**`)
                .setColor(0x57F287);

            await interaction.editReply({ embeds: [endEmbed], components: [disabledRow] }).catch(() => {});
        });
    }
};

