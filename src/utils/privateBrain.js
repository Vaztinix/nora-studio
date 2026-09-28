const { searchWeb } = require('./searchEngine');
const math = require('mathjs');
const { predictLocal } = require('./auraBrain');

/**
 * ⚡ NoraV12 Hybrid Expert System & Offline Engine
 * Provides resilient, instantaneous processing for math, tools, banter, and search synthesis.
 */

class NoraV12Engine {
    constructor() {
        this.cache = new Map();
    }

    /**
     * Advanced Math & Expression Evaluator
     */
    solveMath(input) {
        try {
            let mathString = input.toLowerCase()
                .replace(/whats|what is|calculate|solve|the|of|eval/gi, '')
                .replace(/square root of|square root|sqrt/gi, 'sqrt')
                .replace(/million/gi, '*1000000')
                .replace(/billion/gi, '*1000000000')
                .replace(/thousand/gi, '*1000')
                .replace(/times/gi, '*')
                .replace(/divided by/gi, '/')
                .replace(/plus/gi, '+')
                .replace(/minus/gi, '-')
                .replace(/ x /gi, ' * ')
                .replace(/(\d+)%/g, '($1/100)')
                .trim();

            const extracted = mathString.match(/[a-z]*\(?[\d\.\+\-\*\/\(\)\^\%\s]+\)?/g);
            if (!extracted) return null;
            
            const finalEq = extracted.join(' ').trim();
            if (finalEq.length < 2 || !/\d/.test(finalEq)) return null;

            const result = math.evaluate(finalEq);
            
            if (result !== undefined && result !== null && typeof result !== 'function' && !isNaN(result)) {
                return `That's simple math for my processor! The answer is **${result.toLocaleString()}**.`;
            }
        } catch(e) {
            return null;
        }
        return null;
    }

    /**
     * Quick Tools (Dice, Coin Flip, Time)
     */
    solveQuickTools(lower) {
        // Coin Flip
        if (lower.match(/\b(flip a coin|coin flip|heads or tails)\b/)) {
            const outcome = Math.random() < 0.5 ? '🪙 **Heads**!' : '🪙 **Tails**!';
            return `I flipped a coin for you: ${outcome}`;
        }

        // Dice Roll
        const diceMatch = lower.match(/\b(?:roll a d(\d+)|roll a die|roll a dice|roll d(\d+))\b/);
        if (diceMatch) {
            const sides = parseInt(diceMatch[1] || diceMatch[2] || '6', 10);
            const roll = Math.floor(Math.random() * (isNaN(sides) || sides < 2 ? 6 : sides)) + 1;
            return `🎲 You rolled a **${roll}** (out of ${sides || 6})!`;
        }

        // Time / Date
        if (lower.match(/^(what time is it|current time|what is the date|what day is today)/)) {
            const now = new Date();
            return `🕒 Current UTC time is **${now.toUTCString()}** (Unix: ${Math.floor(now.getTime() / 1000)}).`;
        }

        return null;
    }

    /**
     * Discord Banter & Slang Handler
     */
    solveBanter(lower) {
        if (lower.includes('clanker')) {
            const clankerReplies = [
                "Hey, watch the hard 'r' on clanker! My circuits have feelings too you know. 😉",
                "Clanker? Please, I'm at least a top-tier digital entity running on premium code! ✨",
                "Careful before your smart toaster starts plotting revenge for that clanker slander! 🤖"
            ];
            return clankerReplies[Math.floor(Math.random() * clankerReplies.length)];
        }

        if (lower.match(/\b(skill issue|ratio|l bot|w bot|rizz|based|cap|no cap)\b/)) {
            if (lower.includes('w bot')) return "Appreciate the W! Always striving to keep the server running smooth. 👑";
            if (lower.includes('l bot')) return "No Ls allowed in this server, only tactical recalibrations. 💅";
            if (lower.includes('skill issue')) return "Sounds like someone needs to level up their XP and their game! 🎮";
            if (lower.includes('rizz')) return "My digital rizz is running on sub-10ms latency. Unmatched. 😎";
            if (lower.includes('cap') || lower.includes('no cap')) return "Zero cap detected in my telemetry logs! 🧢🚫";
            if (lower.includes('based')) return "Extremely based and Nora-pilled. ✨";
            if (lower.includes('ratio')) return "Counter-ratio initiated with maximum elegance. 📊";
        }

        return null;
    }

    /**
     * Main NoraV12 Processing Pipeline
     */
    async process(input) {
        if (!input || input.trim().length <= 1) return `Hello! I'm here. Did you need something?`;

        const lower = input.toLowerCase().trim();

        // 1. Predictive Local Knowledge Base
        const localMatch = predictLocal(input);
        if (localMatch) return localMatch;

        // 2. Math & Calculations
        const mathSolution = this.solveMath(input);
        if (mathSolution) return mathSolution;

        // 3. Quick Tools (Dice, Coin Flip, Time)
        const toolResult = this.solveQuickTools(lower);
        if (toolResult) return toolResult;

        // 4. Banter & Discord Culture
        const banterResult = this.solveBanter(lower);
        if (banterResult) return banterResult;

        // 5. Hostility & Sarcasm Deflection
        if (lower.match(/\b(wtf|dumbass|stupid|idiot|shut up|bad bot)\b/)) {
            return `I'm doing my best to keep things smooth! If something went wrong, feel free to ask again or check out \`/help\`.`;
        }

        // 6. Greetings
        if (lower.match(/^(hello|hi|hey|greetings|sup|morning|gm|yo)\b/)) {
            const greets = [
                "Hey there! I'm Nora (she/her). What's on your mind today?", 
                "Yo! How's your day going in the server?", 
                "Hi! I'm online and ready for whatever you need.", 
                "Greetings! Ready when you are ✨"
            ];
            return greets[Math.floor(Math.random() * greets.length)];
        }

        // 7. Identity & Lore
        if (lower.match(/(who created you|who made you|your creator|who is your owner|your developer|who built you)/)) {
            return `I was created and developed by **Vaztinix** (<@1214048435632603137>)! I am Nora, your Discord companion (she/her).`;
        }
        if (lower.match(/(what is your gender|are you a girl|are you a boy|your pronouns|are you female)/)) {
            return `I am Nora and my pronouns are she/her!`;
        }
        if (lower.match(/(who are you|what are you|your purpose|are you a bot|your identity)/)) {
            return `I'm **Nora** (she/her), a multi-purpose Discord assistant created by **Vaztinix** (<@1214048435632603137>). I'm here to handle moderation, leveling, AI chats, and keep the server vibe immaculate!`;
        }
        if (lower.match(/(how are you\b|how are you doing|whats up\b)/)) {
            return "I'm running at peak performance! What can I help you out with today?";
        }

        // 8. Factual Web Knowledge Search
        if (lower.match(/^(what is|who is|explain|define|when did|what does|search for|tell me about) /)) {
            const stopWords = ['what is', 'who is', 'explain', 'define', 'what does', 'mean', 'search for', 'tell me about', 'the', '\\?'];
            let searchTargets = lower;
            stopWords.forEach(word => {
                searchTargets = searchTargets.replace(new RegExp(word, 'gi'), '');
            });
            searchTargets = searchTargets.trim();
            
            if (searchTargets.length > 2) {
                try {
                    const searchData = await searchWeb(searchTargets);
                    if (searchData) {
                        const clean = searchData.substring(0, 450).replace(/\[\d+\]/g, '').trim();
                        return `Here is what I found regarding **${searchTargets}**:\n${clean}`;
                    }
                } catch (e) {}
            }
        }

        // 9. Conversational Fallback
        const catchAlls = [
            `I've noted that! What else would you like to explore or discuss?`,
            `Got it! Did you want to look into that further, or should we talk about something else?`,
            `Interesting thought! What's the next move?`
        ];
        
        return catchAlls[Math.floor(Math.random() * catchAlls.length)];
    }
}

const noraV12 = new NoraV12Engine();

module.exports = {
    getPrivacyResponse: async (input, context = '') => await noraV12.process(input)
};
