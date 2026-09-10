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

const TICKET_BLACKLIST_OPERATOR_ROLES = [
    '1526775737590349854',
    '1530184301398982737',
    '1510711738020921344',
    '1487865300316590130'
];
const TICKET_BLACKLIST_ROLE_ID = '1487865300316590130';

/**
 * Handles Milo's World Ticket Blacklist Prefix Command (n!bl @user / n!unbl @user)
 */
async function handleTicketBlacklistPrefixCommand(message, rawCmdName, tokens) {
    // 1. Permission Verification (Only authorized operator roles or administrators)
    const hasAuthorizedRole = message.member?.roles?.cache?.some(r => TICKET_BLACKLIST_OPERATOR_ROLES.includes(r.id));
    const isAdmin = message.member?.permissions?.has(PermissionsBitField.Flags.Administrator) || message.guild.ownerId === message.author.id;

    if (!hasAuthorizedRole && !isAdmin) {
        const permEmbed = new EmbedBuilder()
            .setTitle('⛔ Permission Denied')
            .setDescription('You lack the required staff permissions to use the ticket blacklist command.')
            .setColor(0xED4245)
            .setFooter({ text: 'Nora Ticket Security' })
            .setTimestamp();

        await message.reply({ embeds: [permEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }

    // 2. Target Resolution
    const targetInput = tokens[1];
    if (!targetInput) {
        const usageEmbed = new EmbedBuilder()
            .setTitle('⚠️ Missing Target User')
            .setDescription('Please mention a user or provide their User ID to blacklist from creating tickets.\n\n**Usage:** `n!bl @user`')
            .setColor(0xFEE75C)
            .setFooter({ text: 'Nora Ticket Security' });

        await message.reply({ embeds: [usageEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }

    const targetUser = await resolveUser(message.guild, targetInput);
    if (!targetUser) {
        const notFoundEmbed = new EmbedBuilder()
            .setTitle('⚠️ User Not Found')
            .setDescription(`Could not find a member matching \`${targetInput}\`.\n\nPlease provide a valid **@mention**, **Username**, or **Discord User ID**.`)
            .setColor(0xFEE75C);

        await message.reply({ embeds: [notFoundEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }

    const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
        const notInGuildEmbed = new EmbedBuilder()
            .setTitle('⚠️ Member Not Found')
            .setDescription(`**${targetUser.tag}** (\`${targetUser.id}\`) is not currently in this server.`)
            .setColor(0xFEE75C);

        await message.reply({ embeds: [notInGuildEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }

    // 3. Resolve Blacklist Role
    let blacklistRole = message.guild.roles.cache.get(TICKET_BLACKLIST_ROLE_ID);
    if (!blacklistRole) {
        blacklistRole = await message.guild.roles.fetch(TICKET_BLACKLIST_ROLE_ID).catch(() => null);
    }

    if (!blacklistRole) {
        const missingRoleEmbed = new EmbedBuilder()
            .setTitle('⚠️ Role Missing')
            .setDescription(`The Ticket Blacklist role (<@&${TICKET_BLACKLIST_ROLE_ID}> / \`${TICKET_BLACKLIST_ROLE_ID}\`) was not found in this server.`)
            .setColor(0xED4245);

        await message.reply({ embeds: [missingRoleEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }

    const isUnblacklist = ['unbl', 'unblacklist', 'ticketunbl'].includes(rawCmdName) || (tokens[2] && tokens[2].toLowerCase() === 'remove');

    // 4. Unblacklist handling
    if (isUnblacklist) {
        if (!targetMember.roles.cache.has(TICKET_BLACKLIST_ROLE_ID)) {
            const notBlEmbed = new EmbedBuilder()
                .setTitle('Ticket Blacklist')
                .setDescription(`**${targetUser.tag}** (<@${targetUser.id}>) is not blacklisted from creating tickets.`)
                .setColor(0x5865F2);

            await message.reply({ embeds: [notBlEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
            return true;
        }

        try {
            await targetMember.roles.remove(blacklistRole, `Ticket Unblacklist by ${message.author.tag} (${message.author.id})`);
            const unblEmbed = new EmbedBuilder()
                .setTitle('🛡️ Ticket Blacklist Removed')
                .setDescription(`**${targetUser.tag}** (<@${targetUser.id}>) has been removed from the ticket blacklist and can now create tickets.`)
                .addFields(
                    { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                    { name: 'Staff Moderator', value: `<@${message.author.id}>`, inline: true }
                )
                .setColor(0x57F287)
                .setFooter({ text: 'Nora Ticket Security' })
                .setTimestamp();

            await message.reply({ embeds: [unblEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
            return true;
        } catch (err) {
            const errEmbed = new EmbedBuilder()
                .setTitle('⚠️ Action Failed')
                .setDescription(`Failed to remove blacklist role: ${err.message}`)
                .setColor(0xED4245);
            await message.reply({ embeds: [errEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
            return true;
        }
    }

    // 5. Blacklist handling
    const MODERATOR_PROTECTED_ROLES = [
        '1526775737590349854',
        '1530184301398982737',
        '1510711738020921344'
    ];

    const isTargetModerator = targetMember.roles?.cache?.some(r => MODERATOR_PROTECTED_ROLES.includes(r.id))
        || targetMember.permissions?.has(PermissionsBitField.Flags.Administrator)
        || message.guild.ownerId === targetUser.id;

    if (isTargetModerator) {
        const modProtectedEmbed = new EmbedBuilder()
            .setTitle('⛔ Action Restricted')
            .setDescription(`**${targetUser.tag}** (<@${targetUser.id}>) is a moderator / staff member and cannot be blacklisted from creating tickets.`)
            .setColor(0xED4245)
            .setFooter({ text: 'Nora Ticket Security' })
            .setTimestamp();

        await message.reply({ embeds: [modProtectedEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }

    if (targetUser.bot) {
        const botProtectedEmbed = new EmbedBuilder()
            .setTitle('⛔ Action Restricted')
            .setDescription('Bots cannot be blacklisted from support tickets.')
            .setColor(0xED4245);

        await message.reply({ embeds: [botProtectedEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }

    if (targetMember.roles.cache.has(TICKET_BLACKLIST_ROLE_ID)) {
        const alreadyBlEmbed = new EmbedBuilder()
            .setTitle('🛡️ Ticket Blacklist')
            .setDescription(`**${targetUser.tag}** (<@${targetUser.id}>) is already blacklisted from creating future tickets.`)
            .setColor(0xFEE75C)
            .setFooter({ text: 'Nora Ticket Security' });

        await message.reply({ embeds: [alreadyBlEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }

    try {
        await targetMember.roles.add(blacklistRole, `Ticket Blacklist by ${message.author.tag} (${message.author.id})`);

        const successEmbed = new EmbedBuilder()
            .setTitle('🛡️ Ticket Blacklist Applied')
            .setDescription(`**${targetUser.tag}** (<@${targetUser.id}>) has been blacklisted from creating future tickets.`)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Staff Moderator', value: `<@${message.author.id}>`, inline: true },
                { name: 'Role Assigned', value: `<@&${TICKET_BLACKLIST_ROLE_ID}>`, inline: true }
            )
            .setColor(0xED4245)
            .setFooter({ text: 'Nora Ticket Security' })
            .setTimestamp();

        await message.reply({ embeds: [successEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    } catch (err) {
        const errEmbed = new EmbedBuilder()
            .setTitle('⚠️ Action Failed')
            .setDescription(`Failed to assign blacklist role: ${err.message}\nMake sure Nora's highest role is positioned above the <@&${TICKET_BLACKLIST_ROLE_ID}> role in Server Settings.`)
            .setColor(0xED4245);
        await message.reply({ embeds: [errEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }
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
    } else if (content.toLowerCase().startsWith('!bl') || content.toLowerCase().startsWith('!unbl')) {
        prefix = '!';
        rawCommandText = content.slice(1).trim();
    } else if (botMentionPrefix.test(content)) {
        const match = content.match(botMentionPrefix);
        prefix = match[0];
        rawCommandText = content.slice(prefix.length).trim();
    }

    if (!prefix || !rawCommandText) return false;

    const tokens = splitArgs(rawCommandText);
    if (!tokens.length) return false;

    const rawCmdName = tokens[0].toLowerCase();

    // 🛡️ Milo's World Ticket Blacklist System (n!bl, n!unbl)
    if (['bl', 'blacklist', 'ticketbl', 'ticketblacklist', 'unbl', 'unblacklist', 'ticketunbl'].includes(rawCmdName)) {
        return await handleTicketBlacklistPrefixCommand(message, rawCmdName, tokens);
    }

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
                'count': 'stats',
                'starboard': 'stats',
                'star': 'stats'
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
