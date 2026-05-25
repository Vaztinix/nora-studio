const { Events } = require('discord.js');
const OpenAI = require('openai');
const GuildSettings = require('../database/models/GuildSettings');
const UserMemory = require('../database/models/UserMemory');
const { getPrivacyResponse } = require('../utils/privateBrain');
const { getBuiltInResponse } = require('../utils/builtInBrain');
const { fetchMonthlyHistory } = require('../utils/aiTools');

/**
 * Nora Core V18.6 - Aura Intelligence Engine
 * Modernized for 2026 AI expectations.
 */
module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || !message.author || message.author.bot) return;
        if (message.author.id === client.user.id) return;

        // Distillation Layer
        try {
            const [memory] = await UserMemory.findOrCreate({ where: { userId: message.author.id } });
            let interests = JSON.parse(memory.interests || '{}');
            const lower = message.content.toLowerCase();
            const topics = { gaming: ['play', 'game'], coding: ['code', 'error'], safety: ['secure', 'protect'] };
            for (const [t, k] of Object.entries(topics)) { if (k.some(kw => lower.includes(kw))) interests[t] = (interests[t] || 0) + 1; }
            memory.interests = JSON.stringify(interests);
            await memory.save();
        } catch (e) {}

        let isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;
        let isReply = message.reference && (await message.channel.messages.fetch(message.reference.messageId).catch(() => null))?.author.id === client.user.id;
        
        if (!isMentioned && !isReply) return;

        let settings;
        try { settings = await GuildSettings.findOne({ where: { guildId: message.guild.id } }); } catch (e) {}
        if (!settings) return;

        const aiPref = settings.aiPreference || 'BUILT_IN';
        const plainContent = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
        const imageAttachments = message.attachments.filter(a => a.contentType?.startsWith('image/'));

        // Smart History Recall Activation
        let deepKnowledgeStr = '';
        if (['recall', 'history', 'search', 'last'].some(w => plainContent.toLowerCase().includes(w))) {
            await message.channel.sendTyping().catch(() => {});
            deepKnowledgeStr = await fetchMonthlyHistory(message.channel, 30, message.author.id);
        }

        const runOpenAI = async () => {
            const keys = [process.env.OPENAI_API_KEY_1, process.env.OPENAI_API_KEY].filter(k => !!k);
            const openai = new OpenAI({ apiKey: keys[0] });
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: 'system', content: `You are Aura (Nora V18). You are a high-performance, witty assistant. 
                    NEVER use fragments or stupid generic phrases.
                    Context:\n${deepKnowledgeStr}` },
                    { role: 'user', content: plainContent }
                ],
                max_tokens: 450
            });
            return completion.choices[0].message.content;
        };

        const runGemini = async () => {
            const res = await getBuiltInResponse(plainContent, deepKnowledgeStr, imageAttachments);
            if (res.includes('credit exhausted') || res.includes('quota')) throw new Error('Quota');
            return res;
        };

        // PIPELINE
        let response = null;
        let statusNote = '';

        try {
            if (aiPref === 'OPENAI') response = await runOpenAI();
            else if (aiPref === 'BUILT_IN') response = await runGemini();
            else response = await getPrivacyResponse(plainContent, deepKnowledgeStr, message.author.id);
        } catch (err) {
            // Fallback Chain
            try {
                if (aiPref !== 'BUILT_IN') response = await runGemini();
                else response = await runOpenAI();
                statusNote = `⚠️ *Primary engine failed (${err.message}). Aura Neuro-Local active.*\n\n`;
            } catch (err2) {
                response = await getPrivacyResponse(plainContent, deepKnowledgeStr, message.author.id);
                statusNote = `⚠️ *Cloud Brain unreachable. Running on Local Aura Engine.*\n\n`;
            }
        }

        if (response) {
            return message.reply({ content: `${statusNote}${response}` });
        }
    }
};
