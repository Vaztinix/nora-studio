const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ComponentType, 
    PermissionsBitField,
    PermissionFlagsBits 
} = require('discord.js');

const COMMAND_ALIASES = {
    'h': 'help',
    'p': 'ping',
    'lb': 'leaderboard',
    'top': 'leaderboard',
    'lvl': 'rank',
    'level': 'rank',
    'card': 'mycard',
    'profile': 'mycard',
    'info': 'botinfo',
    'bot': 'botinfo',
    'botinfo': 'info',
    'av': 'avatar',
    'pfp': 'avatar',
    'w': 'warn',
    'k': 'kick',
    'b': 'ban',
    't': 'timeout',
    'mute': 'timeout',
    'unmute': 'untimeout',
    'clear': 'purge',
    'clean': 'purge',
    'inv': 'invites',
    'invs': 'invites',
    'story': 'onewordstory',
    'count': 'counting',
    'cfg': 'setup',
    'config': 'setup',
    'settings': 'setup',
    'ticket': 'ticket',
    'tickets': 'ticket',
    'star': 'starboard',
    'tr': 'translate'
};

// Formats option type numbers into readable names
function getOptionTypeName(type) {
    const map = {
        1: 'Subcommand',
        2: 'SubcommandGroup',
        3: 'Text / String',
        4: 'Whole Number (Integer)',
        5: 'True / False (Boolean)',
        6: '@User / Member',
        7: '#Channel',
        8: '@Role',
        9: 'Mentionable',
        10: 'Decimal Number',
        11: 'File Attachment'
    };
    return map[type] || 'Value';
}

// Builds individual command help card
function buildSingleCommandHelp(client, query, guild) {
    const cleanQuery = query.toLowerCase().trim().replace(/^(n!|n\?|\/)/, '');
    const resolvedName = COMMAND_ALIASES[cleanQuery] || cleanQuery;
    const command = client.commands.get(resolvedName);

    if (!command) {
        return new EmbedBuilder()
            .setTitle('🔍 Command Not Found')
            .setDescription(`No command found matching \`${query}\`.\n\nType \`n!help\` or \`/help\` to browse all available commands by category.`)
            .setColor(0xED4245);
    }

    const name = command.data?.name || resolvedName;
    const desc = command.data?.description || 'No description provided.';
    const category = command.category || 'General';

    // Find all aliases pointing to this command
    const aliases = Object.entries(COMMAND_ALIASES)
        .filter(([alias, target]) => target === resolvedName || target === name)
        .map(([alias]) => `\`n!${alias}\``);

    // Permission Requirements
    let permString = '🟢 Everyone (No special permissions)';
    if (command.data?.default_member_permissions) {
        try {
            const perms = new PermissionsBitField(BigInt(command.data.default_member_permissions));
            permString = `🛡️ **${perms.toArray().join(', ')}**`;
        } catch (e) {
            permString = '🛡️ Server Staff Only';
        }
    }

    const rawOptions = (command.data?.options || []).map(opt => (typeof opt.toJSON === 'function' ? opt.toJSON() : opt));
    const subcommands = rawOptions.filter(o => o.type === 1);
    const standardOptions = rawOptions.filter(o => o.type !== 1 && o.type !== 2);

    const embed = new EmbedBuilder()
        .setTitle(`📖 Command Help: \`n!${name}\` / \`/${name}\``)
        .setDescription(`${desc}\n\n**Category:** \`${category.toUpperCase()}\` • **Required Permissions:** ${permString}`)
        .setColor(0x7C3AED)
        .setFooter({ text: 'Nora Command Manual • Both n! and / supported' })
        .setTimestamp();

    if (aliases.length > 0) {
        embed.addFields({ name: '⚡ Shorthand Aliases', value: aliases.join(', '), inline: false });
    }

    if (subcommands.length > 0) {
        const subList = subcommands.map(sub => {
            const subOpts = (sub.options || []).map(o => o.required ? `<${o.name}>` : `[${o.name}]`).join(' ');
            return `• **\`n!${name} ${sub.name}${subOpts ? ' ' + subOpts : ''}\`**\n  *${sub.description || 'No description'}*`;
        }).join('\n\n');

        embed.addFields({ name: '📂 Subcommands & Actions', value: subList, inline: false });
    } else if (standardOptions.length > 0) {
        const optList = standardOptions.map(opt => {
            const req = opt.required ? '🔴 Required' : '⚪ Optional';
            return `• **\`${opt.name}\`** (\`${getOptionTypeName(opt.type)}\` • ${req})\n  *${opt.description || 'No description'}*`;
        }).join('\n\n');

        const syntaxStr = standardOptions.map(o => o.required ? `<${o.name}>` : `[${o.name}]`).join(' ');
        embed.addFields(
            { name: '📝 Syntax Formats', value: `• **Prefix:** \`n!${name} ${syntaxStr}\`\n• **Slash:** \`/${name} ${syntaxStr}\``, inline: false },
            { name: '⚙️ Parameters & Arguments', value: optList, inline: false }
        );
    } else {
        embed.addFields({
            name: '📝 Syntax Formats',
            value: `• **Prefix:** \`n!${name}\`\n• **Slash:** \`/${name}\``,
            inline: false
        });
    }

    // Practical usage examples generator
    const examples = [];
    if (name === 'warn') {
        examples.push('`n!warn @User breaking rule 3`', '`n!warn list @User`', '`n!warn clear @User`');
    } else if (name === 'afk') {
        examples.push('`n!afk studying for exams`', '`n!afk eating lunch`', '`n!afk`');
    } else if (name === 'timeout') {
        examples.push('`n!timeout @User 10m spamming chat`', '`n!untimeout @User`');
    } else if (name === 'ban') {
        examples.push('`n!ban @User raided general chat`');
    } else if (name === 'kick') {
        examples.push('`n!kick @User advertising without permission`');
    } else if (name === 'rank') {
        examples.push('`n!rank`', '`n!rank @User`');
    } else if (name === 'mycard') {
        examples.push('`n!mycard`', '`n!mycard @User`');
    } else if (name === 'setup') {
        examples.push('`n!setup`', '`n!setup verify`', '`n!setup automod`', '`n!setup leveling`');
    } else if (name === 'verify') {
        examples.push('`n!verify link Lunar_Dev`', '`n!verify check`');
    } else if (name === 'counting') {
        examples.push('`n!counting`', '`n!counting stats`', '`n!counting top`', '`n!counting rules`', '`n!counting channel #counting`', '`n!counting reset 0`');
    } else if (name === 'onewordstory') {
        examples.push('`n!story start`', '`n!story history`', '`n!story stats`');
    } else if (name === 'ticket') {
        examples.push('`n!ticket`');
    } else if (name === 'ask') {
        examples.push('`n!ask What is the weather in Tokyo?`');
    } else if (name === 'avatar') {
        examples.push('`n!avatar`', '`n!avatar @User`');
    } else if (name === 'purge') {
        examples.push('`n!purge 25`');
    } else if (name === 'translate') {
        examples.push('`n!translate Spanish Hello world`');
    }

    if (examples.length > 0) {
        embed.addFields({ name: '💡 Example Usages', value: examples.join('\n'), inline: false });
    }

    return embed;
}

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Explore all Nora commands, prefixes (n!), arguments, and features.')
        .addStringOption(opt =>
            opt.setName('command')
                .setDescription('Look up detailed help, syntax, and examples for a specific command (e.g. warn, afk, rank)')
                .setRequired(false)),

    async execute(interaction) {
        const query = interaction.options?.getString?.('command');

        // Direct Command Lookup: n!help <command> or /help command:<command>
        if (query) {
            const singleEmbed = buildSingleCommandHelp(interaction.client, query, interaction.guild);
            return await interaction.reply({ embeds: [singleEmbed] });
        }

        const isMod = interaction.member && (
            interaction.member.permissions.has(PermissionFlagsBits.BanMembers) ||
            interaction.member.permissions.has(PermissionFlagsBits.KickMembers) ||
            interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
            interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
            interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) ||
            interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
            interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        );

        const getRoleColor = () => {
            if (!interaction.guild) return 0x7c3aed;
            const color = interaction.guild.members.me?.roles?.highest?.color;
            return (!color || color === 0) ? 0x7c3aed : color;
        };

        const getEmbed = (category) => {
            const embed = new EmbedBuilder()
                .setColor(getRoleColor())
                .setTimestamp()
                .setFooter({ text: `Nora Assistant • Prefix: n! or / • Type n!help <command> for syntax` });

            if (category === 'main') {
                embed.setTitle('💖 Nora Help & Commands Center')
                    .setDescription(
                        `**Welcome to Nora!** Nora is an all-in-one community engagement, safety, and automation assistant.\n\n` +
                        `✨ **Command Prefixes:** Use **\`/\`** (Slash) or **\`n!\`** / **\`n?\`** for any command!\n` +
                        `💡 **Command Manual:** Type **\`n!help <command>\`** (e.g. \`n!help warn\` or \`n!help afk\`) to see full argument requirements and examples!\n` +
                        `🌐 **Web Dashboard:** [https://vaztinix.dev/dashboard](https://vaztinix.dev/dashboard)\n\n` +
                        `Select a category below to explore available commands.`
                    )
                    .addFields(
                        { 
                            name: '🛡️ Safety & Moderation', 
                            value: '`n!warn`, `n!ban`, `n!kick`, `n!timeout`, `n!purge`, `n!afkclear`, AutoMod Threat Shield' 
                        },
                        { 
                            name: '👤 Profiles, Leveling & AFK', 
                            value: '`n!rank`, `n!leaderboard`, `n!mycard`, `n!afk [status]`, Chat/Voice XP rewards' 
                        },
                        { 
                            name: '🔢 Advanced Counting Game', 
                            value: '`n!counting [stats|top|rules|channel|reset]`, sandboxed math equations, records & milestones' 
                        },
                        { 
                            name: '🎮 Community Games & Fun', 
                            value: '`n!story`, `n!guess`, `n!rps`, `n!ask [prompt]`, `n!poll`, `n!giveaway`' 
                        },
                        { 
                            name: '⚙️ Server Setup & Verification', 
                            value: '`n!setup`, 4 Verification Types (1-Click, CAPTCHA, React, Roblox), Welcomer, Logging' 
                        },
                        { 
                            name: '🎫 Support Tickets & Utility', 
                            value: '`n!ticket`, `n!apply`, `n!avatar`, `n!botinfo`, `n!ping`, `n!translate`, `n!invite`' 
                        },
                        { 
                            name: '💎 Nora Premium', 
                            value: 'Real-time Roblox rank sync, 200 autoresponder slots, custom GIF rank cards, and 10x XP multipliers' 
                        }
                    );
            } else if (category === 'counting') {
                embed.setTitle('🔢 Nora Counting Game Manual')
                    .setDescription(
                        'Nora features an **advanced sequential counting engine** with sandboxed math parsing, server streak records, contributor leaderboards, and XP rewards!\n\n' +
                        '**How it works:** Members take turns counting up sequentially in the designated channel. Chat or emojis are ignored, but wrong numbers or counting twice in a row resets the count.'
                    )
                    .addFields(
                        { 
                            name: '🎮 Core Rules & Mechanics', 
                            value: '• Start counting at **1** and increment by **1** with each message.\n' +
                                   '• **Alternating Turns:** You cannot count twice in a row! Another member must count next.\n' +
                                   '• Entering the wrong number or double counting resets the count to **0** while keeping the all-time server record.'
                        },
                        { 
                            name: '🧮 Advanced Math Expression Sandbox', 
                            value: '• Nora evaluates mathematical expressions safely in a secure sandbox.\n' +
                                   '• Supported operators: `+`, `-`, `*`, `/`, `^` (power), `%` (modulo), and parentheses `( )`.\n' +
                                   '• Examples: `5 + 5` (=10), `10 * 2 + 5` (=25), `(8 - 2) * 4` (=24), `2^4` (=16).'
                        },
                        { 
                            name: '🏆 Reactions & Milestone Celebrations', 
                            value: '• ✅ **Verified Count:** Valid number progressing towards the record.\n' +
                                   '• ☑️ **New Server Record:** When your count exceeds the server\'s all-time high score!\n' +
                                   '• 💯 **Century Milestone:** Milestone reaction when hitting numbers ending in 00.\n' +
                                   '• 🎉 **Milestone Alerts:** Nora sends celebratory chat announcements at 50, 100, 500, and 1000.'
                        },
                        { 
                            name: '📜 Counting Commands (`n!` or `/`)', 
                            value: '• `n!counting` or `/counting stats` — View live count, next required number, and server records.\n' +
                                   '• `n!counting top` or `/counting leaderboard` — View top counting contributors on this server.\n' +
                                   '• `n!counting rules` — In-chat quick guide and math syntax.\n' +
                                   '• `n!counting channel <#channel>` — Assign or change the counting channel (Staff).\n' +
                                   '• `n!counting reset [count]` — Calibrate or reset current count (Staff).'
                        },
                        { 
                            name: '⭐ Leveling & XP Rewards', 
                            value: 'Every correct count automatically awards XP towards your server rank card and global levels (customizable in `/setup games`).'
                        }
                    );
            } else if (category === 'safety') {
                embed.setTitle('🛡️ Safety & Moderation Commands')
                    .setDescription('Tools to keep your chat secure, enforce rules, and audit member activity.\n*Type `n!help <command>` for detailed parameters.*')
                    .addFields(
                        { name: '`n!warn <user> [reason]`', value: 'Issue a formal server strike/warning to a user.' },
                        { name: '`n!ban <user> [reason]`', value: 'Permanently ban a user from the server.' },
                        { name: '`n!kick <user> [reason]`', value: 'Kick a user from the server.' },
                        { name: '`n!timeout <user> <duration> [reason]`', value: 'Mute/timeout a member (e.g. `n!timeout @user 10m spamming`).' },
                        { name: '`n!untimeout <user>`', value: 'Remove an active timeout from a member.' },
                        { name: '`n!purge <amount>`', value: 'Bulk delete up to 100 recent messages in the current channel.' },
                        { name: '`n!afkclear <user>`', value: 'Force remove a user\'s AFK status and clean their nickname.' },
                        { name: '`n!role <user> <role>`', value: 'Quickly assign or remove a role from a user.' }
                    );
            } else if (category === 'profile') {
                embed.setTitle('👤 Profiles, Leveling & AFK Commands')
                    .setDescription('Engage active chatters with experience points, custom rank cards, and AFK status.')
                    .addFields(
                        { name: '`n!afk [status]`', value: 'Set an AFK status (adds `[AFK]` to nick, alerts users when mentioned, auto-removes on return).' },
                        { name: '`n!rank [@user]`', value: 'Display your or another user\'s current server level, XP progress, and ranking.' },
                        { name: '`n!leaderboard`', value: 'View the top active server members ranked by total XP (Aliases: `n!lb`, `n!top`).' },
                        { name: '`n!mycard [@user]`', value: 'Display a rich interactive profile card with badges, custom bio, and linked accounts.' },
                        { name: '`n!levelupdms`', value: 'Toggle direct message notifications when you level up.' },
                        { name: '`n!invites [@user]`', value: 'Check your total tracked server invites and earned invite rewards.' }
                    );
            } else if (category === 'games') {
                embed.setTitle('🎮 Community Games & Fun Commands')
                    .setDescription('Interactive chat games and engagement tools for your community.')
                    .addFields(
                        { name: '`n!counting`', value: 'Advanced sequential counting game with math sandbox, milestone alerts, and XP rewards.' },
                        { name: '`n!story [start|stop|history|stats]`', value: 'Collaborative One Word Story game with auto-restart milestones (Alias: `n!story`).' },
                        { name: '`n!guess <number>`', value: 'Play the number guessing game against Nora for bonus XP.' },
                        { name: '`n!rps <rock|paper|scissors>`', value: 'Play Rock Paper Scissors against Nora with optional XP bets.' },
                        { name: '`n!ask <question>`', value: 'Chat with Nora\'s AI engine (Powered by Google Gemini / GPT-4o Mini).' },
                        { name: '`n!poll <question>`', value: 'Create quick interactive voting polls with reactions or buttons.' },
                        { name: '`n!giveaway <start|reroll|end>`', value: 'Host automated server giveaways with countdown timers.' }
                    );
            } else if (category === 'setup') {
                embed.setTitle('⚙️ Setup & Verification Commands')
                    .setDescription('Configure server features, automated verification gates, and logging.')
                    .addFields(
                        { name: '`n!setup`', value: 'Open the full interactive server management dashboard (Manage Server only).' },
                        { name: '`n!setup verify`', value: 'Configure **4 Verification Types**: 1-Click Button, Image CAPTCHA, Reaction, or Roblox.' },
                        { name: '`n!setup welcomer`', value: 'Configure automated welcome cards, welcome channel, and starter auto-roles.' },
                        { name: '`n!setup leveling`', value: 'Configure chat/voice XP rates, level-up channels, and role rewards.' },
                        { name: '`n!setup automod`', value: 'Enable Discord native AutoMod filters for profanity, slurs, spam, and scam links.' },
                        { name: '`n!setup logging`', value: 'Route audit logs across dedicated channels for messages, members, voice, and AutoMod.' },
                        { name: '`n!setup games`', value: 'Configure Counting channel, One Word Story, and Starboard.' }
                    );
            } else if (category === 'utility') {
                embed.setTitle('🎫 Support Tickets & Utilities')
                    .setDescription('Support ticket desks, applications, translations, and bot information.')
                    .addFields(
                        { name: '`n!ticket`', value: 'Open a private support ticket with server staff.' },
                        { name: '`n!apply`', value: 'Fill out custom application forms for server staff or whitelist positions.' },
                        { name: '`n!verify link <username>`', value: 'Link your Roblox account to gain verified server roles.' },
                        { name: '`n!verify check`', value: 'Finalize Roblox verification by checking your profile description.' },
                        { name: '`n!roblox profile <user>`', value: 'Inspect a Roblox user\'s avatar, profile details, and groups.' },
                        { name: '`n!avatar [@user]`', value: 'View and download high-resolution user avatars (Alias: `n!pfp`).' },
                        { name: '`n!botinfo`', value: 'View Nora\'s system uptime, server count, latency, and host specs.' },
                        { name: '`n!ping`', value: 'Test Discord Gateway WebSocket ping and REST API response latency.' },
                        { name: '`n!translate <text>`', value: 'Translate text across 100+ languages in real-time.' },
                        { name: '`n!invite`', value: 'Get the official link to invite Nora to your own Discord servers.' }
                    );
            } else if (category === 'premium') {
                embed.setTitle('💎 Nora Studio Premium Benefits')
                    .setDescription('Supercharge your server with maximum automation power, instant sync speed, and custom branding for just $1.99/mo!')
                    .addFields(
                        { name: '⚡ Real-Time Roblox Rank Sync', value: 'Zero polling delay! Rank changes and verification roles update instantly.' },
                        { name: '🤖 Nora AI Co-Pilot', value: 'Powered by Gemini 2.5 & GPT-4o for 24/7 AI server assistance & custom personas.' },
                        { name: '🚀 200 Custom Autoresponder Slots', value: '40x capacity with granular role ignored and allowed filters.' },
                        { name: '🎨 Custom GIF Rank Cards & HEX Colors', value: 'Personalize level rank cards with GIF backdrops and custom HEX styling.' },
                        { name: '🛡️ AutoMod Threat Shield & Multi-Audit Routing', value: 'Zero-latency native filters and dedicated audit log channels.' },
                        { name: '💖 Instant Activation', value: 'Run `/premium` or upgrade online at [https://vaztinix.dev/dashboard](https://vaztinix.dev/dashboard).' }
                    );
            }
            return embed;
        };

        const dropdownOptions = [
            { label: 'Main Menu', value: 'main', description: 'Overview of all Nora features', emoji: '💖' },
            { label: 'Counting Game', value: 'counting', description: 'Rules, math expressions, milestones, and stats', emoji: '🔢' },
            { label: 'Safety & Moderation', value: 'safety', description: 'Warns, bans, timeouts, and AutoMod', emoji: '🛡️' },
            { label: 'Profiles, Leveling & AFK', value: 'profile', description: 'Rank cards, XP leaderboards, and AFK status', emoji: '👤' },
            { label: 'Community Games & Fun', value: 'games', description: 'Story, RPS, Guess, Polls, and AI', emoji: '🎮' },
            { label: 'Setup & Verification', value: 'setup', description: 'Server dashboard, 4 verification types, and logs', emoji: '⚙️' },
            { label: 'Tickets & Utility', value: 'utility', description: 'Tickets, applications, roblox, and info', emoji: '🎫' },
            { label: 'Premium Perks', value: 'premium', description: 'Exclusive perks and server upgrades', emoji: '💎' }
        ];

        const dropdown = new StringSelectMenuBuilder()
            .setCustomId('help_select')
            .setPlaceholder('🚀 Choose a help category...')
            .addOptions(dropdownOptions.map(opt => ({ ...opt, default: opt.value === 'main' })));

        const row = new ActionRowBuilder().addComponents(dropdown);

        const response = await interaction.reply({
            embeds: [getEmbed('main')],
            components: [row]
        });

        if (response && typeof response.createMessageComponentCollector === 'function') {
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 600000
            });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ content: '⚠️ This help menu is controlled by another user.', ephemeral: true });
                }
                const selected = i.values[0];
                await i.update({
                    embeds: [getEmbed(selected)],
                    components: [
                        new ActionRowBuilder().addComponents(
                            dropdown.setOptions(dropdownOptions.map(opt => ({ ...opt, default: opt.value === selected })))
                        )
                    ]
                });
            });
        }
    }
};
