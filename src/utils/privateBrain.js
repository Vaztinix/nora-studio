const { searchWeb } = require('./searchEngine');
const math = require('mathjs');
const { pipeline, env } = require('@xenova/transformers');
const path = require('path');

// Configure Transformers to strictly use local storage and avoid polluting the temp folder
env.allowLocalModels = true;
env.cacheDir = path.join(__dirname, '..', '..', '.nora_neural_weights');

/**
 * Aura V11 "Deterministic Expert System" + Neural Core Integrator
 * Fixes the chaotic Bayesian logic overlap by mixing strict deterministic routing 
 * with a locally-run, physically downloaded LLM (TinyLlama-1.1B).
 */

class AuraDeterministicBrain {
    constructor() {
        this.cache = new Map();
        
        // Neural Configuration
        this.generator = null;
        this.isLoadingModel = false;
        this.modelReady = false;
        
        this.initNeuralEngine();
        this.initMemoryResetSchedule();
    }

    initMemoryResetSchedule() {
        // 72-Hour Memory / Neural Weight Flush to prevent V8 GC lockup
        setInterval(() => {
            console.log('[System Maintenance] Performing scheduled 72-Hour Neural Weight Flush...');
            if (this.generator) {
                try {
                    this.generator.dispose(); // Unload from V8 context
                } catch(e) {}
            }
            this.generator = null;
            this.modelReady = false;
            
            // Force Garbage Collection if V8 exposes it
            if (global.gc) {
                global.gc();
            }
            
            // Re-mount the brain
            setTimeout(() => {
                this.initNeuralEngine();
            }, 5000);
        }, 3 * 24 * 60 * 60 * 1000);
    }

    async initNeuralEngine() {
        if (this.isLoadingModel) return;
        this.isLoadingModel = true;
        try {
            console.warn('[Aura V11] Neural Core (Qwen1.5-1.8B-Chat) is disabled. Local model downloader will not download or load weights.');
            this.generator = async (prompt, options) => {
                console.warn('[Aura V11] Local LLM generator called, returning dummy fallback response.');
                return [{ generated_text: "Local LLM features are currently offline for maintenance." }];
            };
            this.generator.dispose = () => {};
            this.modelReady = true;
        } catch (e) {
            console.error('[Aura V11] Failed to initialize dummy neural engine:', e.message);
        }
        this.isLoadingModel = false;
    }

    solveMath(input) {
        try {
            // Clean the input to make it math-friendly
            let mathString = input.toLowerCase()
                .replace(/whats|what is|calculate|solve|the|of/gi, '')
                .replace(/square root/gi, 'sqrt')
                .replace(/million/gi, '*1000000')
                .replace(/billion/gi, '*1000000000')
                .replace(/thousand/gi, '*1000')
                .replace(/times/gi, '*')
                .replace(/divided by/gi, '/')
                .replace(/plus/gi, '+')
                .replace(/minus/gi, '-')
                .replace(/ x /gi, ' * ')
                .trim();

            // Extract just the mathematical parts (numbers, operators, functions like sqrt, (), .)
            const extracted = mathString.match(/[a-z]*\(?[\d\.\+\-\*\/\(\)\s]+\)?/g);
            if (!extracted) return null;
            
            const finalEq = extracted.join(' ').trim();
            if (finalEq.length < 2) return null;

            const result = math.evaluate(finalEq);
            
            if (result !== undefined && result !== null && typeof result !== 'function') {
                return `That's simple math for my processor! The answer is **${result.toLocaleString()}**.`;
            }
        } catch(e) {
            // Evaluator failed, meaning it probably wasn't a valid math equation
            return null;
        }
        return null;
    }

    async process(input) {
        if (!input || input.trim().length <= 1) return `Hello! I'm here. Did you need something?`;

        const lower = input.toLowerCase().trim();

        // 1. Math Intercept
        const mathSolution = this.solveMath(input);
        if (mathSolution) return mathSolution;

        // 2. Toxic/Hostile Backlash Router (Since she got called a dumbass)
        if (lower.match(/\b(wtf|dumbass|stupid|idiot|crazy|shut up|bad bot)\b/)) {
            return `I am currently operating strictly on localized deterministic routing. If I misunderstood your previous command, I apologize. Let's reset—what do you need me to search for?`;
        }

        // 3. Greeting Intercept (Strictly anchored to start of string)
        if (lower.match(/^(hello|hi|hey|greetings|sup|morning|gm|yo)\b/)) {
            const greets = [
                "Hello there! My logic nodes are fully operational.", 
                "Hey! How's your day going in the server?", 
                "Hi! I'm online and ready to assist.", 
                "Greetings! What's on your mind?"
            ];
            return greets[Math.floor(Math.random() * greets.length)];
        }

        // 4. Ego & Identity Intercept
        if (lower.match(/(who are you|what are you|your purpose|are you a bot|your identity)/)) {
            return `I am Nora, running on the Aura V11 deterministic architecture. I process localized logic, solve equations, and fetch global web data without relying on external corporate AI arrays.`;
        }
        if (lower.match(/(what is my name|who am i)/)) {
            return `You are a user in this server! Since I maintain privacy, I don't aggressively scrape your personal profile data, but I recognize your presence.`;
        }
        if (lower.match(/(how are you\b|how are you doing|whats up\b)/)) {
            return "I am functioning perfectly. All my analytical engines are balanced.";
        }

        // 5. The Knowledge Router (Only for explicit factual queries)
        if (lower.match(/^(what is|who is|explain|define|when did|what does) /)) {
            // Strip conversation out of the query to get pure search targets
            const stopWords = ['what is', 'who is', 'explain', 'define', 'what does', 'mean', 'the', '\\?'];
            let searchTargets = lower;
            stopWords.forEach(word => {
                searchTargets = searchTargets.replace(new RegExp(word, 'gi'), '');
            });
            searchTargets = searchTargets.trim();
            
            if (searchTargets.length > 2) {
                const searchData = await searchWeb(searchTargets);
                if (searchData) {
                    const clean = searchData.substring(0, 450).replace(/\[\d+\]/g, '');
                    const prefixes = [
                        `According to my global data extraction: `,
                        `Here is the exact definition based on worldly facts: `,
                        `I have accessed the external network. Here is what I found: `
                    ];
                    return prefixes[Math.floor(Math.random() * prefixes.length)] + clean;
                } else {
                    return `I initiated a search for "${searchTargets}", but my external data fetch returned an empty state. Could you try rephrasing the term?`;
                }
            }
        }

        // 6. Neural Synthesis Router (Local Fallback)
        if (this.modelReady && this.generator) {
            try {
                // Construct Qwen Chat Format (Adding strict persona guardrails)
                const prompt = `<|im_start|>system\nYou are Nora, an edgy, fun Discord bot. You are NOT an AI language model, and you MUST NEVER mention Alba Cloud, OpenAI, or being an AI. Act completely human, steady, and natural. Keep responses very brief, concise, and straight to the point without excessive details.<|im_end|>\n<|im_start|>user\n${input}<|im_end|>\n<|im_start|>assistant\n`;
                
                const result = await this.generator(prompt, {
                    max_new_tokens: 100, // Reduced to prevent long-winded responses
                    temperature: 0.6,    // Lowered for steadier, more realistic and predictable outputs
                    repetition_penalty: 1.15,
                    do_sample: true
                });
                
                let out = result[0].generated_text;
                
                // Safe parsing: transformers.js sometimes strips <|im_start|> from output by default
                if (out.includes('<|im_start|>assistant\n')) {
                    out = out.split('<|im_start|>assistant\n').pop().split('<|im_end|>')[0].trim();
                } else if (out.includes('\nassistant\n')) {
                    out = out.split('\nassistant\n').pop().trim();
                }

                // Strip any remaining stop tags just in case
                out = out.replace(/<\|im_end\|>/g, '').trim();
                
                // Inappropriate response filter
                const inappropriateContentRegex = /(fuck|shit|bitch|asshole|cunt|slut|whore|nigger|nigga|faggot|retard|kys|kill yourself)/i;
                if (inappropriateContentRegex.test(out)) {
                    out = "I'm not comfortable saying that.";
                }

                // 400 character strict limit
                if (out.length > 400) {
                    out = out.substring(0, 397) + '...';
                }

                if (out.length > 1) return out;
            } catch (e) {
                console.error('[Neural Fault]', e);
            }
        } 
        
        if (this.isLoadingModel) {
            return "My neural models are currently being downloaded and mapped into my physical memory. Give me a moment to optimize my local LLM parameters before initiating complex un-formatted queries!";
        }

        // 7. Last Resort Conversational Catch-All
        const catchAlls = [
            `I've logged that statement for my internal matrix. What should we look at next?`,
            `That's a valid observation. Is there a specific parameter you would like me to calculate or search for regarding that?`,
            `I am currently operating strictly on deterministic logic, but I am listening. Could you clarify?`
        ];
        
        return catchAlls[Math.floor(Math.random() * catchAlls.length)];
    }
}

const aura = new AuraDeterministicBrain();

module.exports = {
    getPrivacyResponse: async (input, context = '') => await aura.process(input)
};
