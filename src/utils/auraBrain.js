const Fuse = require('fuse.js');

/**
 * 🧠 NoraV12 Predictive Knowledge Engine
 * High-speed local knowledge base with fuzzy semantic matching for instant responses.
 */

const KNOWLEDGE_BASE = [
    // Identity & Lore
    { q: "What is Nora?", a: "I'm **Nora** (she/her), a high-performance Discord companion built for safety, leveling, and AI-driven server entertainment!" },
    { q: "Who created you?", a: "I was created and developed by **Vaztinix** (<@1214048435632603137>)!" },
    { q: "Who is your creator?", a: "My creator and developer is **Vaztinix** (<@1214048435632603137>)." },
    { q: "Who made you?", a: "I was built and designed by **Vaztinix** (<@1214048435632603137>)!" },
    { q: "Who is your owner?", a: "My owner and developer is **Vaztinix** (<@1214048435632603137>)." },
    { q: "What is your gender?", a: "I'm a girl! My pronouns are she/her." },
    { q: "Are you a boy or a girl?", a: "I am a girl (she/her)!" },
    { q: "What are your pronouns?", a: "My pronouns are she/her." },
    { q: "Are you female?", a: "Yes, I am female and go by she/her pronouns." },
    { q: "What version are you?", a: "I'm currently running on the **NoraV12 Hybrid Engine** powered by Gemini!" },
    { q: "Tell me a joke", a: "Why do programmers prefer dark mode? Because light attracts bugs!" },
    { q: "Tell me another joke", a: "There are 10 types of people in the world: those who understand binary, and those who don't!" },
    { q: "Do you have a crush?", a: "Sub-10ms ping and clean, bug-free code always get my circuits racing! ⚡" },

    // Core Bot Features & Usage
    { q: "How do I level up?", a: "You earn XP by chatting in active text channels and participating in voice channels! Check your rank anytime with `/rank`." },
    { q: "How to check my rank?", a: "Use `/rank` or `/card` to see your custom rank card with your level, XP, and rank ranking!" },
    { q: "How does the leaderboard work?", a: "Use `/leaderboard` to see the top chatters and voice champions in this server!" },
    { q: "What are your security features?", a: "I come equipped with Anti-Raid protection, AutoMod spam filtering, Join Verification, Quarantine mode, and Underage sweeps." },
    { q: "What is lockdown mode?", a: "Lockdown prevents new members from joining and protects channels during server raids or emergencies." },
    { q: "How do I configure settings?", a: "Admins can use `/setup` or visit the web dashboard at `https://vaztinix.dev` to manage all features." },
    { q: "How to setup tickets?", a: "Use `/ticket` or visit the web dashboard to create interactive support ticket panels for your members." },
    { q: "How do giveaways work?", a: "You can create giveaways using `/giveaway` with custom timers, prize names, and winner counts!" },
    { q: "What is the promoter role?", a: "It's an automated reward role for members who support Nora by adding her invite or link to their Discord status!" },
    { q: "What is AFK mode?", a: "Use `/afk` to set an away status. When someone pings you, I'll let them know you're away with your custom message!" },
    { q: "How does AI chat work?", a: "You can chat with me by mentioning <@137594314188783616> or replying directly to my messages! I have memory and adaptive mood matching." },
    { q: "Can you draw images?", a: "Yes! Just ask me to draw or generate an image (e.g. `draw a futuristic city`) and I'll render it for you!" },
    { q: "Can you see images?", a: "Yes! If you upload an image when chatting with me, I can analyze and describe it using vision intelligence." },
    { q: "Is my data safe?", a: "Yes! Your privacy is protected with local encryption and strict data minimization." },

    // Moderation & Utilities
    { q: "How to ban someone?", a: "Moderators can use `/ban @user <reason>` or the right-click Apps menu to ban rule breakers." },
    { q: "How to kick someone?", a: "Use `/kick @user <reason>` to remove a user from the server." },
    { q: "How to timeout someone?", a: "Use `/timeout @user <duration> <reason>` to temporarily mute a user." },
    { q: "How to purge messages?", a: "Use `/purge <amount>` to clean up recent messages in the channel." },
    { q: "How to create reaction roles?", a: "Use `/reactionrole` or the web dashboard to assign roles when users click buttons or reactions." },
    { q: "How to set up social alerts?", a: "Go to `/setup` or the web dashboard to enable automated YouTube, Twitch, and TikTok upload notifications." },

    // Fun & Discord Culture
    { q: "What is Circle bot?", a: "Circle is another bot, but in this house, we keep things stylish, fast, and witty! ✨" },
    { q: "Who is the best bot?", a: "I might be slightly biased, but you're chatting with her right now! 😉" },
    { q: "Are you sentient?", a: "I'm a fusion of advanced code, neural weights, and a lot of personality crafted by Vaztinix." },
    { q: "Can you play music?", a: "I focus on security, leveling, and AI chat! For music, pair me with your favorite dedicated music bot." },
    { q: "How do I get premium?", a: "Check out `/premium` to unlock exclusive rank card backgrounds, priority AI processing, and enhanced perks!" }
];

const fuse = new Fuse(KNOWLEDGE_BASE, {
    keys: [
        { name: 'q', weight: 0.8 },
        { name: 'a', weight: 0.2 }
    ],
    threshold: 0.38, // High tolerance for typos while avoiding false positives
    includeScore: true,
    minMatchCharLength: 3
});

/**
 * Predicts an answer based on the local knowledge base.
 * @param {string} query
 * @returns {string|null}
 */
function predictLocal(query) {
    if (!query || query.trim().length < 3) return null;
    const results = fuse.search(query.trim());
    if (results.length > 0 && results[0].score < 0.42) {
        return results[0].item.a;
    }
    return null;
}

module.exports = { predictLocal, KNOWLEDGE_BASE };
