const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Nora Knowledge Base & Query Assistant
 * Delivers clear, human-written guidance across server setup,
 * moderation policies, leveling mechanics, and Discord tools.
 */
function getAssistantResponse(prompt) {
    const p = prompt.toLowerCase().trim();

    // 1. Leveling & XP questions
    if (p.includes('level') || p.includes('xp') || p.includes('rank') || p.includes('multiplier')) {
        return {
            title: 'Leveling & Progression System',
            color: 0x5865F2,
            description: 'Nora calculates user progression dynamically across text and voice channels.',
            fields: [
                {
                    name: 'How XP is calculated',
                    value: '• **Text Messages**: 15 to 25 XP per message (with a 60-second cooldown to prevent spam).\n• **Voice Activity**: 10 XP per minute in unmuted voice channels.\n• **Multipliers**: Server staff can configure custom role and channel multipliers.'
                },
                {
                    name: 'Level formula',
                    value: '`XP for next level = 5 * (Level ^ 2) + 50 * Level + 100`\nEach level requires slightly more experience than the last.'
                },
                {
                    name: 'Rank Cards',
                    value: 'Use `/rank` to check your rank card. Custom themes, animated backgrounds, and colors can be adjusted on the dashboard.'
                }
            ],
            footer: 'You can set up role rewards for specific levels in /setup.'
        };
    }

    // 2. Moderation & Automod
    if (p.includes('moderation') || p.includes('automod') || p.includes('mute') || p.includes('ban') || p.includes('warn') || p.includes('filter')) {
        return {
            title: 'Server Moderation & Safety',
            color: 0x4F545C,
            description: 'Core moderation commands and automated filters available in Nora.',
            fields: [
                {
                    name: 'Staff Commands',
                    value: '• `/warn <user> [reason]` - Issue a recorded warning\n• `/mute <user> <duration> [reason]` - Discord timeout (1m to 28d)\n• `/kick <user> [reason]` - Kick a member\n• `/ban <user> [delete_days] [reason]` - Ban a member\n• `/purge <amount>` - Bulk delete messages'
                },
                {
                    name: 'Automod Features',
                    value: '• Anti-Invite and anti-link filters\n• Mass-mention and spam rate limiters\n• Configurable word blacklists\n• Auto-sanction thresholds for repeat warnings'
                },
                {
                    name: 'Case History',
                    value: 'Each moderation action generates a unique case ID. Use `/case view <id>` or `/user info` to review past infractions.'
                }
            ],
            footer: 'Make sure Nora\'s role is higher than the roles of members she moderates.'
        };
    }

    // 3. Verification & Onboarding
    if (p.includes('verify') || p.includes('verification') || p.includes('setup') || p.includes('captcha') || p.includes('roblox')) {
        return {
            title: 'Member Verification Setup',
            color: 0x5865F2,
            description: 'Overview of gatekeeping and verification modes.',
            fields: [
                {
                    name: 'Supported Modes',
                    value: '• **Button**: Single-click agreement button for quick onboarding.\n• **Captcha**: Image code verification for anti-raid defense.\n• **Roblox**: Links Discord members to verified Roblox accounts.'
                },
                {
                    name: 'Configuration',
                    value: 'Run `/setup` and choose **Verification** to set the target role and channel.'
                }
            ],
            footer: 'Pair verification with the welcome module to greet members once verified.'
        };
    }

    // 4. Tickets
    if (p.includes('ticket') || p.includes('support') || p.includes('transcript')) {
        return {
            title: 'Ticket Support System',
            color: 0x5865F2,
            description: 'Private support channels and transcript management.',
            fields: [
                {
                    name: 'Capabilities',
                    value: '• Multi-panel support categories\n• Staff-only permissions on newly created ticket channels\n• Automatic markdown transcripts sent on ticket close'
                },
                {
                    name: 'Getting Started',
                    value: 'Configure ticket panels and transcript channels in `/setup` or on the web dashboard.'
                }
            ],
            footer: 'Transcripts can be archived directly to a private staff channel.'
        };
    }

    // 5. Hierarchy & Permissions
    if (p.includes('permission') || p.includes('hierarchy') || p.includes('role') || p.includes('error')) {
        return {
            title: 'Discord Permissions & Role Hierarchy',
            color: 0x4F545C,
            description: 'Guidelines for resolving permission conflicts.',
            fields: [
                {
                    name: 'Role Order',
                    value: 'Discord prevents bots from managing or modifying any member whose highest role is higher than or equal to the bot\'s highest role.'
                },
                {
                    name: 'Recommended Setup',
                    value: 'Place the **Nora** role above all standard member and moderator roles in Server Settings > Roles.'
                }
            ],
            footer: 'Granting Administrator permission avoids channel-level permission overrides.'
        };
    }

    // 6. General
    return {
        title: 'Nora Assistant Guide',
        color: 0x5865F2,
        description: `Information regarding: **${prompt.length > 100 ? prompt.substring(0, 97) + '...' : prompt}**`,
        fields: [
            {
                name: 'Core Modules',
                value: '• **Moderation & Logs**: Timeout, ban, warn, kick, and purge with full case tracking.\n• **Community Engagement**: Leveling leaderboards, Starboard, RPS, and Guessing.\n• **Utility & Management**: Member audit dossiers, polls, custom invites, and Roblox profile lookups.'
            },
            {
                name: 'Helpful Commands',
                value: '• `/help` - Full command list organized by category\n• `/info` - Bot status, latency, and uptime\n• `/mycard` - Profile card with stats and badges\n• `/setup` - Server configuration menu'
            }
        ],
        footer: 'Ask about leveling, moderation, verification, tickets, or permissions for specific guidance.'
    };
}

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Ask Nora for server management guidance, feature explanations, and tips.')
        .addStringOption(option => 
            option.setName('prompt')
                .setDescription('What would you like help with?')
                .setRequired(true)
        )
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        const query = interaction.options?.getString?.('prompt')?.trim() || 'How does Nora work?';
        const responseData = getAssistantResponse(query);

        const embed = new EmbedBuilder()
            .setAuthor({ 
                name: 'Nora Assistant', 
                iconURL: interaction.client.user.displayAvatarURL() 
            })
            .setTitle(responseData.title)
            .setColor(responseData.color)
            .setDescription(responseData.description)
            .addFields(
                { name: 'Question', value: `*${query.length > 200 ? query.substring(0, 197) + '...' : query}*` },
                ...responseData.fields
            )
            .setFooter({ text: responseData.footer || 'Nora Assistant • vaztinix.dev' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Dashboard')
                .setURL('https://vaztinix.dev/dashboard')
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel('Support')
                .setURL('https://discord.gg/Uxb2tNAxtp')
                .setStyle(ButtonStyle.Link)
        );

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [embed], components: [row] });
        } else {
            await interaction.reply({ embeds: [embed], components: [row] });
        }
    }
};
