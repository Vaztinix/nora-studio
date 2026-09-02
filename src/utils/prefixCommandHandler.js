const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    PermissionsBitField, 
    ChannelType 
} = require('discord.js');
const settingsCache = require('./settingsCache');
const { handleError } = require('./embeds');

// Comprehensive shorthand aliases for quick typing
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

/**
 * Parses user mention, ID, or username from string argument
 */
async function resolveUser(guild, input) {
    if (!input) return null;
    const cleanId = input.replace(/[<@!>]/g, '').trim();
    if (/^\d{17,20}$/.test(cleanId)) {
        const cached = guild.client.users.cache.get(cleanId);
        if (cached) return cached;
        return await guild.client.users.fetch(cleanId).catch(() => null);
    }
    const member = guild.members.cache.find(m => 
        m.user.username.toLowerCase() === input.toLowerCase() ||
        m.displayName.toLowerCase() === input.toLowerCase()
    );
    return member ? member.user : null;
}

/**
 * Parses channel mention, ID, or name
 */
async function resolveChannel(guild, input) {
    if (!input) return null;
    const cleanId = input.replace(/[<#>]/g, '').trim();
    if (/^\d{17,20}$/.test(cleanId)) {
        return guild.channels.cache.get(cleanId) || await guild.channels.fetch(cleanId).catch(() => null);
    }
    return guild.channels.cache.find(c => c.name.toLowerCase() === input.toLowerCase().replace(/^#/, '')) || null;
}

/**
 * Parses role mention, ID, or name
 */
async function resolveRole(guild, input) {
    if (!input) return null;
    const cleanId = input.replace(/[<@&>]/g, '').trim();
    if (/^\d{17,20}$/.test(cleanId)) {
        return guild.roles.cache.get(cleanId) || await guild.roles.fetch(cleanId).catch(() => null);
    }
    return guild.roles.cache.find(r => r.name.toLowerCase() === input.toLowerCase()) || null;
}

/**
 * Splits command arguments respecting quotes
 */
function splitArgs(str) {
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const args = [];
    let match;
    while ((match = regex.exec(str)) !== null) {
        args.push(match[1] || match[2] || match[0]);
    }
    return args;
}

/**
 * Generates formatted syntax string for options
 */
function formatOptionsSyntax(optionDefs) {
    if (!optionDefs || !optionDefs.length) return '';
    return optionDefs.map(opt => {
        const name = opt.name;
        return opt.required ? `<${name}>` : `[${name}]`;
    }).join(' ');
}

/**
 * Builds a compatible mock interaction object for slash commands
 */
function createMockInteraction(message, commandName, subcommand, parsedOptions) {
    let repliedMessage = null;
    let isDeferred = false;
    let isReplied = false;

    const interaction = {
        isChatInputCommand: () => true,
        isCommand: () => true,
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        isRepliable: () => true,

        id: message.id,
        commandName,
        guild: message.guild,
        guildId: message.guild.id,
        channel: message.channel,
        channelId: message.channel.id,
        user: message.author,
        member: message.member,
        client: message.client,
        createdAt: message.createdAt,
        createdTimestamp: message.createdTimestamp,

        get deferred() { return isDeferred; },
        get replied() { return isReplied; },

        options: {
            getSubcommand: (required = true) => {
                if (subcommand) return subcommand;
                if (required) throw new Error('No subcommand provided.');
                return null;
            },
            getSubcommandGroup: () => null,
            getString: (name, required = false) => {
                const val = parsedOptions[name.toLowerCase()];
                return val !== undefined && val !== null ? String(val) : null;
            },
            getUser: (name, required = false) => {
                const val = parsedOptions[name.toLowerCase()];
                return (val && val.id) ? val : null;
            },
            getMember: (name, required = false) => {
                const val = parsedOptions[name.toLowerCase()];
                if (val && val.id) {
                    return message.guild.members.cache.get(val.id) || null;
                }
                return null;
            },
            getChannel: (name, required = false) => {
                const val = parsedOptions[name.toLowerCase()];
                return (val && val.id) ? val : null;
            },
            getRole: (name, required = false) => {
                const val = parsedOptions[name.toLowerCase()];
                return (val && val.id) ? val : null;
            },
            getInteger: (name, required = false) => {
                const val = parsedOptions[name.toLowerCase()];
                if (val === undefined || val === null) return null;
                const num = parseInt(val);
                return isNaN(num) ? null : num;
            },
            getNumber: (name, required = false) => {
                const val = parsedOptions[name.toLowerCase()];
                if (val === undefined || val === null) return null;
                const num = parseFloat(val);
                return isNaN(num) ? null : num;
            },
            getBoolean: (name, required = false) => {
                const val = parsedOptions[name.toLowerCase()];
                if (val === undefined || val === null) return null;
                if (typeof val === 'boolean') return val;
                const s = String(val).toLowerCase();
                return ['true', 'yes', '1', 'on', 'enable'].includes(s);
            },
            getAttachment: () => null,
            getMentionable: (name, required = false) => {
                return parsedOptions[name.toLowerCase()] || null;
            }
        },

        deferReply: async (opts = {}) => {
            if (isDeferred || isReplied) return;
            isDeferred = true;
            await message.channel.sendTyping().catch(() => {});
            return;
        },

        reply: async (payload) => {
            isReplied = true;
            isDeferred = false;
            const normalized = typeof payload === 'string' ? { content: payload } : { ...payload };
            normalized.allowedMentions = normalized.allowedMentions || { repliedUser: false };
            try {
                repliedMessage = await message.reply(normalized);
                return repliedMessage;
            } catch (err) {
                repliedMessage = await message.channel.send(normalized).catch(() => null);
                return repliedMessage;
            }
        },

        editReply: async (payload) => {
            const normalized = typeof payload === 'string' ? { content: payload } : { ...payload };
            normalized.allowedMentions = normalized.allowedMentions || { repliedUser: false };
            if (repliedMessage) {
                try {
                    return await repliedMessage.edit(normalized);
                } catch (e) {}
            }
            isReplied = true;
            isDeferred = false;
            try {
                repliedMessage = await message.reply(normalized);
                return repliedMessage;
            } catch (err) {
                repliedMessage = await message.channel.send(normalized).catch(() => null);
                return repliedMessage;
            }
        },

        followUp: async (payload) => {
            const normalized = typeof payload === 'string' ? { content: payload } : { ...payload };
            normalized.allowedMentions = normalized.allowedMentions || { repliedUser: false };
            return await message.channel.send(normalized).catch(() => null);
        },

        deleteReply: async () => {
            if (repliedMessage && repliedMessage.deletable) {
                await repliedMessage.delete().catch(() => {});
            }
        },

        fetchReply: async () => repliedMessage
    };

    return interaction;
}

/**
 * Main prefix command handler called on every messageCreate
 */
async function handlePrefixCommand(message, client) {
    if (!message || !message.content || !message.guild) return false;

    const content = message.content.trim();
    const botMentionPrefix = new RegExp(`^<@!?${client.user?.id}>\\s*`, 'i');

    let prefix = null;
    let rawCommandText = '';

    if (content.toLowerCase().startsWith('n!')) {
        prefix = 'n!';
        rawCommandText = content.slice(2).trim();
    } else if (content.toLowerCase().startsWith('n?')) {
        prefix = 'n?';
        rawCommandText = content.slice(2).trim();
    } else if (botMentionPrefix.test(content)) {
        const match = content.match(botMentionPrefix);
        prefix = match[0];
        rawCommandText = content.slice(prefix.length).trim();
    }

    if (!prefix || !rawCommandText) return false;

    const tokens = splitArgs(rawCommandText);
    if (!tokens.length) return false;

    const rawCmdName = tokens[0].toLowerCase();
    const resolvedName = COMMAND_ALIASES[rawCmdName] || rawCmdName;
    const command = client.commands.get(resolvedName);

    if (!command) {
        // Not a recognized command, do not consume message
        return false;
    }

    const commandName = command.data?.name || resolvedName;
    const args = tokens.slice(1);

    // Permission Verification
    if (command.data?.default_member_permissions) {
        try {
            const requiredPerms = new PermissionsBitField(BigInt(command.data.default_member_permissions));
            if (!message.member.permissions.has(requiredPerms)) {
                const missingPerms = requiredPerms.toArray().join(', ');
                const permEmbed = new EmbedBuilder()
                    .setTitle('⛔ Permission Denied')
                    .setDescription(`You lack the required permissions to execute this command.\n\n**Required:** \`${missingPerms}\``)
                    .setColor(0xED4245)
                    .setFooter({ text: 'Nora Security Protocol' })
                    .setTimestamp();

                await message.reply({ embeds: [permEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
                return true;
            }
        } catch (e) {}
    }

    // Inspect command options from SlashCommandBuilder schema
    const rawOptions = (command.data?.options || []).map(opt => (typeof opt.toJSON === 'function' ? opt.toJSON() : opt));
    const subcommands = rawOptions.filter(o => o.type === 1); // 1 = Subcommand

    let chosenSubcommand = null;
    let optionDefs = rawOptions;

    if (subcommands.length > 0) {
        if (args.length > 0 && subcommands.some(s => s.name.toLowerCase() === args[0].toLowerCase())) {
            chosenSubcommand = args.shift().toLowerCase();
            const subDef = subcommands.find(s => s.name.toLowerCase() === chosenSubcommand);
            optionDefs = subDef ? (subDef.options || []) : [];
        } else {
            // Check default subcommands for known commands
            const defaultSubcommandMap = {
                'warn': 'add',
                'setup': 'dashboard',
                'verify': 'link',
                'apply': 'start',
                'giveaway': 'start',
                'roblox': 'profile',
                'onewordstory': 'start',
                'counting': 'stats',
                'count': 'stats'
            };

            const preferredDefault = defaultSubcommandMap[commandName] || subcommands[0].name;
            const subDef = subcommands.find(s => s.name.toLowerCase() === preferredDefault);
            
            chosenSubcommand = preferredDefault;
            optionDefs = subDef ? (subDef.options || []) : [];
        }
    }

    // Parse arguments into named options
    const parsedOptions = {};
    const missingRequired = [];

    for (let i = 0; i < optionDefs.length; i++) {
        const def = optionDefs[i];
        const defName = def.name.toLowerCase();
        const isLastOption = (i === optionDefs.length - 1);

        if (i >= args.length) {
            // Argument was not supplied
            if (def.required) {
                // Special exemption: commands where target user defaults to the author
                if (['rank', 'avatar', 'mycard', 'profile'].includes(commandName) && (defName === 'target' || defName === 'user')) {
                    parsedOptions[defName] = message.author;
                    continue;
                }
                missingRequired.push(def);
            }
            continue;
        }

        const rawArg = args[i];

        if (def.type === 3) { // String
            if (isLastOption) {
                parsedOptions[defName] = args.slice(i).join(' ');
            } else {
                parsedOptions[defName] = rawArg;
            }
        } else if (def.type === 6) { // User
            const user = await resolveUser(message.guild, rawArg);
            if (!user && def.required) {
                const errEmbed = new EmbedBuilder()
                    .setTitle('⚠️ User Not Found')
                    .setDescription(`Could not find a member matching \`${rawArg}\`.\n\nPlease provide a valid **@mention**, **Username**, or **18-digit Discord User ID**.`)
                    .setColor(0xFEE75C);
                await message.reply({ embeds: [errEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
                return true;
            }
            parsedOptions[defName] = user || message.author;
        } else if (def.type === 7) { // Channel
            const channel = await resolveChannel(message.guild, rawArg);
            if (!channel && def.required) {
                const errEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Channel Not Found')
                    .setDescription(`Could not find a channel matching \`${rawArg}\`.\n\nPlease provide a valid **#channel** mention, channel name, or **Channel ID**.`)
                    .setColor(0xFEE75C);
                await message.reply({ embeds: [errEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
                return true;
            }
            parsedOptions[defName] = channel || message.channel;
        } else if (def.type === 8) { // Role
            const role = await resolveRole(message.guild, rawArg);
            if (!role && def.required) {
                const errEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Role Not Found')
                    .setDescription(`Could not find a role matching \`${rawArg}\`.\n\nPlease provide a valid **@role** mention, role name, or **Role ID**.`)
                    .setColor(0xFEE75C);
                await message.reply({ embeds: [errEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
                return true;
            }
            parsedOptions[defName] = role;
        } else if (def.type === 4 || def.type === 10) { // Integer or Number
            const num = def.type === 4 ? parseInt(rawArg) : parseFloat(rawArg);
            if (isNaN(num) && def.required) {
                const errEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Invalid Number')
                    .setDescription(`Expected a number for \`<${def.name}>\`, but received \`${rawArg}\`.`)
                    .setColor(0xFEE75C);
                await message.reply({ embeds: [errEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
                return true;
            }
            parsedOptions[defName] = isNaN(num) ? null : num;
        } else if (def.type === 5) { // Boolean
            const s = String(rawArg).toLowerCase();
            parsedOptions[defName] = ['true', 'yes', '1', 'on', 'enable'].includes(s);
        } else {
            parsedOptions[defName] = rawArg;
        }
    }

    // Default target for self-profile commands if omitted
    if (['rank', 'avatar', 'mycard', 'profile'].includes(commandName) && !parsedOptions['target'] && !parsedOptions['user']) {
        parsedOptions['target'] = message.author;
        parsedOptions['user'] = message.author;
    }

    // Check if missing required options
    if (missingRequired.length > 0) {
        const missingNames = missingRequired.map(m => `\`<${m.name}>\``).join(', ');
        const syntaxStr = `n!${commandName}${chosenSubcommand ? ' ' + chosenSubcommand : ''} ${formatOptionsSyntax(optionDefs)}`.trim();
        const slashSyntaxStr = `/${commandName}${chosenSubcommand ? ' ' + chosenSubcommand : ''} ${formatOptionsSyntax(optionDefs)}`.trim();

        const missingEmbed = new EmbedBuilder()
            .setTitle('⚠️ Missing Required Information')
            .setDescription(
                `You must provide the required parameter(s): ${missingNames}\n\n` +
                `**Prefix Usage:** \`${syntaxStr}\`\n` +
                `**Slash Usage:** \`${slashSyntaxStr}\`\n\n` +
                `**Parameter Details:**\n` +
                missingRequired.map(m => `• **\`<${m.name}>\`**: ${m.description || 'No description'}`).join('\n') +
                `\n\n*Type \`n!help ${commandName}\` for full instructions, aliases, and examples.*`
            )
            .setColor(0xFEE75C)
            .setFooter({ text: 'Nora Command Validator' });

        await message.reply({ embeds: [missingEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }

    // Create mock interaction
    const mockInteraction = createMockInteraction(message, commandName, chosenSubcommand, parsedOptions);

    try {
        console.log(`[Prefix Command] ${message.author.tag} executed ${prefix}${commandName} in #${message.channel.name}`);
        await command.execute(mockInteraction, client);
        return true;
    } catch (err) {
        console.error(`[Prefix Command Error] Failed executing ${commandName}:`, err);
        if (!mockInteraction.replied && !mockInteraction.deferred) {
            await message.reply({
                content: `⚠️ An error occurred while executing **${prefix}${commandName}**: ${err.message || 'Unknown error'}`,
                allowedMentions: { repliedUser: false }
            }).catch(() => {});
        }
        return true;
    }
}

module.exports = {
    handlePrefixCommand,
    COMMAND_ALIASES
};
