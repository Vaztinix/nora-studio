const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const GuildSettings = require('../../database/models/GuildSettings');
const UserPrefs = require('../../database/models/UserPrefs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('View Nora Premium benefits, status, and unlock high-power server features.'),

    async execute(interaction) {
        let isPremium = false;
        if (interaction.guildId) {
            const gs = await GuildSettings.findOne({ where: { guildId: interaction.guildId } });
            if (gs && (gs.isPremium || gs.isManualPremium || (gs.paidExpiresAt && new Date(gs.paidExpiresAt).getTime() > Date.now()))) {
                isPremium = true;
            }
        }
        
        const userPref = await UserPrefs.findOne({ where: { userId: interaction.user.id } });
        const userIsPremium = userPref && (userPref.isPremium || userPref.isManualPremium || (userPref.paidExpiresAt && new Date(userPref.paidExpiresAt).getTime() > Date.now()));

        const embed = new EmbedBuilder()
            .setTitle('💎 Nora Studio Premium — Supercharge Your Server')
            .setDescription(
                `Unlock maximum speed, unlimited automation rules, AI Co-Pilot, and custom branding for your community!\n\n` +
                `**Current Status:** ${isPremium ? '🟢 **PREMIUM ACTIVE ON THIS SERVER**' : (userIsPremium ? '⭐ **PREMIUM ACTIVE ON YOUR ACCOUNT**' : '⚪ **FREE TIER**')}`
            )
            .setColor(isPremium || userIsPremium ? 0x10B981 : 0x7C3AED)
            .addFields(
                {
                    name: '⚡ Instant Real-Time Roblox Rank Sync',
                    value: 'Zero polling delay! Automatically sync Roblox group rank changes, verifications, and rank-based role removals instantly.',
                    inline: false
                },
                {
                    name: '🤖 Aura AI Co-Pilot & Unlimited `/ask` Access',
                    value: 'Powered by Gemini 1.5 & GPT-4o. Get 24/7 AI moderation, automated member assistance, and custom system personas.',
                    inline: false
                },
                {
                    name: '🎨 Custom Brand & Rank Card Builder',
                    value: 'Upload GIF/video backdrops for rank cards, set custom HEX accent colors, and brand Nora with server-specific nicknames & themes.',
                    inline: false
                },
                {
                    name: '🚀 10x XP Boosters & 200 Custom Autoresponders',
                    value: 'Set custom role XP multipliers up to 10x, plus 200 autoresponder slots with granular role ignored/allowed filters.',
                    inline: false
                },
                {
                    name: '🛡️ AutoMod Pro Threat Shield & 15+ Audit Streams',
                    value: 'Contextual AI slur & harassment detection, anti-raid protection, and 15+ dedicated audit log channels.',
                    inline: false
                },
                {
                    name: '⚡ Dedicated VIP Gateway Route & 24/7 Priority SLA',
                    value: 'Guaranteed 99.99% uptime with VIP API priority dispatch for ultra-fast response times.',
                    inline: false
                }
            )
            .setFooter({ text: 'Nora Studio Premium • 30-Day Value Guarantee • Cancel Anytime', iconURL: interaction.client.user.displayAvatarURL() })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('⭐ Upgrade to Premium ($4.99/mo)')
                .setStyle(ButtonStyle.Link)
                .setURL('https://vaztinix.dev/dashboard'),
            new ButtonBuilder()
                .setLabel('🌐 Explore Features')
                .setStyle(ButtonStyle.Link)
                .setURL('https://vaztinix.dev')
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};
