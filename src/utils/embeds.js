const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const COLORS = {
    DEFAULT: 0x6366f1, // Indigo / Modern Nora Blue
    SUCCESS: 0x10b981, // Emerald Green
    ERROR: 0xef4444,   // Crimson Red
    WARNING: 0xf59e0b, // Amber Gold
    INFO: 0x3b82f6,    // Radiant Blue
    PURPLE: 0x8b5cf6,  // Royal Violet
    DARK: 0x0f172a     // Midnight Slate
};

module.exports = {
    COLORS,

    // Dynamic Branding Engine: Matches Nora's Embeds to her Guild Role Color or standard modern tint
    getRoleColor: (interaction, fallbackColor = COLORS.DEFAULT) => {
        if (!interaction || !interaction.guild || !interaction.guild.members || !interaction.guild.members.me) {
            return fallbackColor;
        }
        const color = interaction.guild.members.me.roles.highest?.color;
        return (color && color !== 0) ? color : fallbackColor;
    },

    /**
     * Base builder for consistent Nora aesthetic across all features.
     */
    createBaseEmbed: function(interaction, options = {}) {
        const clientUser = interaction?.client?.user;
        const color = options.color || module.exports.getRoleColor(interaction, options.fallbackColor);

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTimestamp();

        if (options.author !== false) {
            embed.setAuthor({
                name: options.authorName || 'Nora System',
                iconURL: clientUser?.displayAvatarURL({ dynamic: true }) || ''
            });
        }

        if (options.title) embed.setTitle(options.title);
        if (options.description) embed.setDescription(options.description);
        
        const footerText = options.footerText ? `Nora • ${options.footerText}` : 'Nora Assistant • Ultra Tier';
        embed.setFooter({ 
            text: footerText,
            iconURL: clientUser?.displayAvatarURL({ dynamic: true }) || undefined
        });

        if (options.thumbnail) embed.setThumbnail(options.thumbnail);
        if (options.image) embed.setImage(options.image);
        if (options.fields && Array.isArray(options.fields)) embed.addFields(options.fields);

        return embed;
    },

    // 🚫 Casual Access/Error Embed
    handleError: async function(interaction, title, description, components = []) {
        const safeTitle = (typeof title === 'string' && title.trim().length > 0) ? title : 'Action Unsuccessful';
        const safeDesc = (typeof description === 'string' && description.trim().length > 0) ? description : 'Something went wrong while processing your request.';

        const embed = module.exports.createBaseEmbed(interaction, {
            title: `🚨  ${safeTitle}`,
            description: `${safeDesc}\n\n*If this issue persists, please consult server documentation or admin staff.*`,
            color: COLORS.ERROR,
            footerText: 'System Alert'
        });

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: [embed], components, files: [] }).catch(() => {});
            } else {
                await interaction.reply({ embeds: [embed], components, ephemeral: true }).catch(() => {});
            }
        } catch (e) {
            console.error('[Embed Trace] Failed to send error embed:', e);
        }
    },
    
    // Standard Success Embed
    handleSuccess: async function(interaction, title, description, ephemeral = true, components = []) {
        const safeTitle = (typeof title === 'string' && title.trim().length > 0) ? title : 'Action Completed';
        const safeDesc = (typeof description === 'string' && description.trim().length > 0) ? description : 'Operation was executed successfully.';

        const embed = module.exports.createBaseEmbed(interaction, {
            title: `✨  ${safeTitle}`,
            description: safeDesc,
            color: COLORS.SUCCESS,
            footerText: 'Operation Verified'
        });

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: [embed], components, files: [] }).catch(() => {});
            } else {
                await interaction.reply({ embeds: [embed], components, ephemeral }).catch(() => {});
            }
        } catch (e) {
            console.error('[Embed Trace] Failed to send success embed:', e);
        }
    },

    // Sleek Info Card Embed
    handleInfo: async function(interaction, title, description, fields = [], ephemeral = false, components = []) {
        const embed = module.exports.createBaseEmbed(interaction, {
            title: `⚡  ${title}`,
            description,
            color: COLORS.INFO,
            fields,
            footerText: 'Information Hub'
        });

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: [embed], components, files: [] }).catch(() => {});
            } else {
                await interaction.reply({ embeds: [embed], components, ephemeral }).catch(() => {});
            }
        } catch (e) {
            console.error('[Embed Trace] Failed to send info embed:', e);
        }
    }
};

