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
    } else if (name === 'starboard') {
        examples.push('`n!starboard`', '`n!starboard top`', '`n!starboard halloffame`', '`n!starboard random`', '`n!starboard channel #starboard`', '`n!starboard threshold 4`');
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
                embed.setTitle('Nora Help & Commands Manual')
                    .setDescription(
                        `**Welcome to Nora.** A streamlined community engagement, moderation, and automation assistant.\n\n` +
                        `• **Command Prefixes:** Use **\`/\`** (Slash) or **\`n!\`** / **\`n?\`** for any command.\n` +
                        `• **Command Manual:** Type **\`n!help <command>\`** (e.g. \`n!help warn\` or \`n!help giveaway\`) for parameters and syntax.\n` +
                        `• **Web Dashboard:** [vaztinix.dev/dashboard](https://vaztinix.dev/dashboard)\n\n` +
                        `Select a category below to explore commands.`
                    )
                    .addFields(
                        { 
                            name: 'Safety & Moderation', 
                            value: '`n!warn`, `n!case`, `n!ban`, `n!tempban`, `n!kick`, `n!timeout`, `n!purge`, `n!bulkrole`, `n!lock`, `n!unlock`' 
                        },
                        { 
                            name: 'Profiles, Leveling & AFK', 
                            value: '`n!rank`, `n!leaderboard`, `n!mycard`, `n!afk [status]`, `n!levelupdms`, `n!invites`' 
                        },
                        { 
                            name: 'Counting Game', 
                            value: '`n!counting [stats|top|rules|channel|reset]`, sandboxed math parser, records & milestones' 
                        },
                        { 
                            name: 'Community & Giveaways', 
                            value: '`n!giveaway`, `n!story`, `n!guess`, `n!rps`, `n!ask [prompt]`, `n!poll`' 
                        },
                        { 
                            name: 'Server Setup & Verification', 
                            value: '`n!setup` (1-Click, CAPTCHA, Reaction, Roblox), Welcomer, AutoMod, Logging' 
                        },
                        { 
                            name: 'Support & Utility', 
                            value: '`n!ticket`, `n!apply`, `n!avatar`, `n!info`, `n!ping`, `n!translate`, `n!invite`' 
                        }
                    );
            } else if (category === 'counting') {
                embed.setTitle('Counting Game Guide')
                    .setDescription(
                        'Nora features a **sequential counting engine** with sandboxed math evaluation, server streak records, contributor leaderboards, and XP rewards.\n\n' +
                        '**How it works:** Members take turns counting up sequentially in the designated channel. Chat or emojis are ignored, but wrong numbers or counting twice in a row resets the count.'
                    )
                    .addFields(
                        { 
                            name: 'Rules & Mechanics', 
                            value: '• Start counting at **1** and increment by **1** with each message.\n' +
                                   '• **Alternating Turns:** You cannot count twice in a row. Another member must count next.\n' +
                                   '• Entering the wrong number or double counting resets the count to **0** while preserving the server record.'
                        },
                        { 
                            name: 'Math Expression Support', 
                            value: '• Nora evaluates mathematical expressions safely in a secure sandbox.\n' +
                                   '• Supported operators: `+`, `-`, `*`, `/`, `^` (power), `%` (modulo), and parentheses `( )`.\n' +
                                   '• Examples: `5 + 5` (=10), `10 * 2 + 5` (=25), `(8 - 2) * 4` (=24), `2^4` (=16).'
                        },
                        { 
                            name: 'Counting Commands', 
                            value: '• `n!counting` or `/counting stats` — Live count and server records.\n' +
                                   '• `n!counting top` or `/counting leaderboard` — Top counting contributors.\n' +
                                   '• `n!counting rules` — In-chat quick guide.\n' +
                                   '• `n!counting channel <#channel>` — Set counting channel (Staff).\n' +
                                   '• `n!counting reset [count]` — Calibrate count (Staff).'
                        }
                    );
            } else if (category === 'safety') {
                embed.setTitle('Safety & Moderation Commands')
                    .setDescription('Tools to keep your server secure, enforce rules, and audit member activity.\n*Type `n!help <command>` for detailed parameters.*')
                    .addFields(
                        { name: '`n!warn <add|view|remove|clear|edit>`', value: 'Manage formal server strikes and auto-moderation thresholds.' },
                        { name: '`n!case <view|edit|history|resolve>`', value: 'Inspect, edit, and track moderation audit cases.' },
                        { name: '`n!ban <user> [reason]`', value: 'Permanently ban a member with optional message purge.' },
                        { name: '`n!tempban <user> <duration> [reason]`', value: 'Temporarily ban a user with automated unban timer.' },
                        { name: '`n!kick <user> [reason]`', value: 'Kick a member from the server.' },
                        { name: '`n!timeout <user> <duration> [reason]`', value: 'Timeout / mute a member for up to 28 days.' },
                        { name: '`n!untimeout <user>`', value: 'Remove an active timeout from a member.' },
                        { name: '`n!purge <amount>`', value: 'Bulk delete up to 250 recent messages with keyword/user filters.' },
                        { name: '`n!bulkrole <add|remove|view|cancel>`', value: 'Bulk assign or remove roles from filtered members with live progress & audit logs.' },
                        { name: '`n!lock` / `n!unlock`', value: 'Lock or unlock the current channel for regular members.' },
                        { name: '`n!slowmode <seconds>`', value: 'Set message cooldown interval on the current channel.' }
                    );
            } else if (category === 'profile') {
                embed.setTitle('Profiles, Leveling & AFK Commands')
                    .setDescription('Member experience points, customized rank cards, and AFK status.')
                    .addFields(
                        { name: '`n!afk [status]`', value: 'Set AFK status (prefixes `[AFK]` to nickname, notifies on mention, auto-removes on return).' },
                        { name: '`n!rank [@user]`', value: 'Display current server level, XP progress, and rank card.' },
                        { name: '`n!leaderboard`', value: 'View server members ranked by total XP (Aliases: `n!lb`, `n!top`).' },
                        { name: '`n!mycard [@user]`', value: 'Display interactive digital profile pass with stats, badges, and Roblox identity.' },
                        { name: '`n!levelupdms`', value: 'Toggle direct message notifications upon leveling up.' },
                        { name: '`n!invites [@user]`', value: 'Check tracked server invites and statistics.' }
                    );
            } else if (category === 'games') {
                embed.setTitle('Community Games & Giveaways')
                    .setDescription('Interactive chat activities, games, and giveaway management.')
                    .addFields(
                        { name: '`n!giveaway [panel|start|end|reroll|list]`', value: 'Full Giveaway Manager to host, track, and conclude server giveaways.' },
                        { name: '`n!counting`', value: 'Sequential counting game with math evaluation and milestones.' },
                        { name: '`n!starboard`', value: 'Starboard system with dynamic star tiers and Hall of Fame.' },
                        { name: '`n!story`', value: 'Collaborative One Word Story game.' },
                        { name: '`n!guess <number>`', value: 'Number guessing game against Nora for XP.' },
                        { name: '`n!rps <choice>`', value: 'Rock Paper Scissors with optional XP bets.' },
                        { name: '`n!ask <prompt>`', value: 'Guidance and feature explanations from Nora.' },
                        { name: '`n!poll <question>`', value: 'Create interactive voting polls.' }
                    );
            } else if (category === 'setup') {
                embed.setTitle('Setup & Verification Commands')
                    .setDescription('Configure server features, automated verification gates, and logging.')
                    .addFields(
                        { name: '`n!setup`', value: 'Open the full server configuration menu (Manage Server only).' },
                        { name: '`n!setup verify`', value: 'Configure Verification: 1-Click Button, CAPTCHA, Reaction, or Roblox.' },
                        { name: '`n!setup welcomer`', value: 'Configure automated welcome cards, channel, and auto-roles.' },
                        { name: '`n!setup leveling`', value: 'Configure chat/voice XP rates, level-up channels, and rewards.' },
                        { name: '`n!setup automod`', value: 'Configure filters for profanity, slurs, spam, and invite links.' },
                        { name: '`n!setup logging`', value: 'Route audit logs across dedicated channels.' }
                    );
            } else if (category === 'utility') {
                embed.setTitle('Support & Utilities')
                    .setDescription('Support tickets, applications, translations, and bot information.')
                    .addFields(
                        { name: '`n!ticket`', value: 'Open a private support ticket with server staff.' },
                        { name: '`n!apply`', value: 'Submit custom application forms for server positions.' },
                        { name: '`n!verify link <username>`', value: 'Link Roblox account to gain verified server roles.' },
                        { name: '`n!verify check`', value: 'Finalize Roblox verification check.' },
                        { name: '`n!roblox profile <user>`', value: 'Inspect a Roblox user avatar and profile.' },
                        { name: '`n!avatar [@user]`', value: 'View high-resolution user avatars (Alias: `n!pfp`).' },
                        { name: '`n!info`', value: 'View Nora uptime, health metrics, and server count.' },
                        { name: '`n!ping`', value: 'Test Discord Gateway WebSocket ping and REST API latency.' },
                        { name: '`n!translate <text>`', value: 'Translate text across 100+ languages.' },
                        { name: '`n!invite`', value: 'Official invite link for Nora Bot.' }
                    );
            }
            return embed;
        };

        const dropdownOptions = [
            { label: 'Main Menu', value: 'main', description: 'Overview of all Nora features' },
            { label: 'Safety & Moderation', value: 'safety', description: 'Warns, cases, bans, timeouts, and bulk roles' },
            { label: 'Profiles & Leveling', value: 'profile', description: 'Rank cards, XP leaderboards, and AFK' },
            { label: 'Counting Game', value: 'counting', description: 'Rules, math expressions, and records' },
            { label: 'Community & Giveaways', value: 'games', description: 'Giveaway manager, story, and polls' },
            { label: 'Setup & Verification', value: 'setup', description: 'Server dashboard, 4 verification types, and logs' },
            { label: 'Support & Utility', value: 'utility', description: 'Tickets, applications, roblox, and info' }
        ];

        const dropdown = new StringSelectMenuBuilder()
            .setCustomId('help_select')
            .setPlaceholder('Select a help category...')
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
