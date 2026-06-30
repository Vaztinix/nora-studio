const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const OpenAI = require('openai');
const { handleError } = require('../../utils/embeds');
const { checkRateLimit } = require('../../utils/aiRateLimiter');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Ask the Nora AI a question privately.')
        .addStringOption(option => 
            option.setName('prompt')
            .setDescription('What would you like to know?')
            .setRequired(true)
        ),

    async execute(interaction) {
        const { checkAndAwardEgg } = require('../../utils/easterEggSystem');
        checkAndAwardEgg(interaction, 2);

        const { isPremium } = require('../../utils/premiumManager');
        let userIsPremium = isPremium(interaction);

        const UserPrefs = require('../../database/models/UserPrefs');
        const userPrefs = await UserPrefs.findOne({ where: { userId: interaction.user.id } }).catch(() => null);
        if (userPrefs) {
            userIsPremium = userIsPremium || !!userPrefs.isPremium || !!userPrefs.isManualPremium;
            const paidTime = userPrefs.paidExpiresAt ? new Date(userPrefs.paidExpiresAt).getTime() : 0;
            const expandedMs = userPrefs.expandedTimeMs ? Number(userPrefs.expandedTimeMs) : 0;
            if (paidTime + expandedMs > Date.now()) {
                userIsPremium = true;
            }
        }

        // Apply rate limit protection to shield global API quota
        if (!checkRateLimit(interaction.user.id, userIsPremium)) {
            const waitTime = userIsPremium ? '30 seconds' : '1 minute';
            return handleError(interaction, 'Rate Limited', `Slow down! To ensure everyone has fair access to the AI, you are restricted to 5 queries per ${waitTime}. Try again shortly.`);
        }


        // We want this command to be completely private, so we defer ephemerally
        await interaction.deferReply({ ephemeral: true });

        const query = interaction.options.getString('prompt');

        try {
            /*
            const openai = new OpenAI({ apiKey });

            const engineeredPrompt = `System Instructions:
You are Nora, a highly intelligent, empathetic, and strictly private assistant in a Discord server.
1. **Safety Rules:** Provide safe content. No NSFW, extreme violence, or hate. Keep it PG-13, but...
2. **Have Fun:** Allow for jokes and playfully helpful energy! Let the user have fun.
3. **Adaptive Tone:** Match the vibe of the prompt you receive and the user you are assisting.
4. **Format:** Answer concisely and clearly using excellent markdown formatting. DO NOT prefix with "Nora:".
        5. **No Emojis:** DO NOT USE EMOJIS in your responses.
        6. **Length:** Be EXTREMELY concise. Keep responses under 2-3 sentences max (under 60 words). Efficiency and brevity are now your core goals. Give punchy, short answers.

Current Guild/Server: ${interaction.guild?.name || 'DM'}
Interacting User: ${interaction.user.username}

User Prompt: "${query}"

Nora (Respond privately):`;

            const result = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are Nora, a highly intelligent, empathetic, and strictly private assistant. Answer concisely and clearly in under 3 sentences. No emojis." },
                    { role: "user", content: query }
                ],
            });
            const responseText = result.choices[0].message.content;

            // Slicing to adhere to Discord limits and keep it in an Embed
            const shortResponse = responseText.length > 3900 ? responseText.substring(0, 3900) + '...' : responseText;
            */

            await interaction.deleteReply().catch(() => {});
            return;
        } catch (error) {
            console.error('Ask Command OpenAI Error:', error);
        }
    },
};
