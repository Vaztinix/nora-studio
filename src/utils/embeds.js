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

    // Send Embed Response with automatic Components V2 or classic V1 fallback
    sendEmbedResponse: async function(interaction, embed, { ephemeral = false, components = [], files = [] } = {}) {
        let useV2 = true;
        try {
            if (interaction.guildId) {
                const settingsCache = require('./settingsCache');
                const settings = await settingsCache.get(interaction.guildId).catch(() => null);
                if (settings && settings.embedsVersion === 'v1') {
                    useV2 = false;
                }
            }
        } catch (e) {
            useV2 = true;
        }

        if (useV2) {
            try {
                const v2Payload = module.exports.buildEmbedV2Container(embed, components);
                const payload = {
                    components: v2Payload.components,
                    flags: v2Payload.flags,
                    files
                };
                if (ephemeral) payload.ephemeral = true;

                if (interaction.replied || interaction.deferred) {
                    return await interaction.editReply(payload);
                } else {
                    return await interaction.reply(payload);
                }
            } catch (err) {
                // Graceful fallback to V1 if V2 payload encounters API rejection
            }
        }

        const v1Payload = { embeds: [embed], components, files };
        if (ephemeral) v1Payload.ephemeral = true;
        try {
            if (interaction.replied || interaction.deferred) {
                return await interaction.editReply(v1Payload).catch(() => {});
            } else {
                return await interaction.reply(v1Payload).catch(() => {});
            }
        } catch (e) {
            console.error('[Embed Trace] Failed to send embed response:', e);
        }
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

        return await module.exports.sendEmbedResponse(interaction, embed, { ephemeral: true, components, files: [] });
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

        return await module.exports.sendEmbedResponse(interaction, embed, { ephemeral, components, files: [] });
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

        return await module.exports.sendEmbedResponse(interaction, embed, { ephemeral, fields, components, files: [] });
    }
,
    /**
     * Converts an EmbedBuilder or raw embed options into a Discord Components V2 Container payload (IS_COMPONENTS_V2 = 32768)
     * or returns classic V1 embed payload when version === 'v1'.
     */
    buildEmbedV2Container: function(embedOrOptions, extraActionRows = [], contentPrefix = '') {
        const data = (embedOrOptions && typeof embedOrOptions.toJSON === 'function')
            ? embedOrOptions.toJSON()
            : (embedOrOptions?.data || embedOrOptions || {});

        let accentColor = 0x5865f2;
        if (typeof data.color === 'number') {
            accentColor = data.color;
        } else if (typeof data.color === 'string') {
            const parsed = parseInt(data.color.replace('#', ''), 16);
            if (!isNaN(parsed)) accentColor = parsed;
        }

        const innerComponents = [];

        // 1. Optional Ping / Content Prefix at top of container
        if (contentPrefix && String(contentPrefix).trim()) {
            innerComponents.push({
                type: 10, // TextDisplay
                content: String(contentPrefix).trim()
            });
            innerComponents.push({
                type: 14, // Separator
                divider: true,
                spacing: 1
            });
        }

        // 2. Author + Title + Description block (with Thumbnail accessory if valid http(s) URL)
        const headerLines = [];
        if (data.author && data.author.name) {
            headerLines.push(`**${data.author.name}**`);
        }
        if (data.title) {
            headerLines.push(`## ${data.title}`);
        }
        if (data.description) {
            headerLines.push(String(data.description));
        }

        const headerMarkdown = headerLines.join('\n') || '​';
        const thumbUrl = data.thumbnail?.url || (typeof data.thumbnail === 'string' ? data.thumbnail : null);
        const isHttpThumb = thumbUrl && /^https?:\/\//i.test(thumbUrl);

        if (isHttpThumb) {
            innerComponents.push({
                type: 9, // Section
                components: [{ type: 10, content: headerMarkdown }],
                accessory: {
                    type: 11, // Thumbnail
                    media: { url: thumbUrl }
                }
            });
        } else if (headerLines.length > 0) {
            innerComponents.push({
                type: 10, // TextDisplay
                content: headerMarkdown
            });
        }

        // 3. Embed Fields
        if (Array.isArray(data.fields) && data.fields.length > 0) {
            innerComponents.push({
                type: 14, // Separator
                divider: true,
                spacing: 1
            });
            const fieldsMarkdown = data.fields
                .filter(f => f && (f.name || f.value))
                .map(f => `**${f.name || 'Field'}**\n${f.value || ''}`)
                .join('\n\n');
            if (fieldsMarkdown) {
                innerComponents.push({
                    type: 10,
                    content: fieldsMarkdown
                });
            }
        }

        // 4. Banner Image (MediaGallery type: 12)
        const imgUrl = data.image?.url || (typeof data.image === 'string' ? data.image : null);
        if (imgUrl && /^https?:\/\//i.test(imgUrl)) {
            innerComponents.push({
                type: 12, // MediaGallery
                items: [{ media: { url: imgUrl } }]
            });
        }

        // 5. Footer & Timestamp subtext
        const footerParts = [];
        if (data.footer && data.footer.text) {
            footerParts.push(data.footer.text);
        }
        if (data.timestamp) {
            const tsSec = Math.floor(new Date(data.timestamp).getTime() / 1000);
            if (!isNaN(tsSec)) footerParts.push(`<t:${tsSec}:f>`);
        }
        if (footerParts.length > 0) {
            innerComponents.push({
                type: 14,
                divider: true,
                spacing: 1
            });
            innerComponents.push({
                type: 10,
                content: `-# ${footerParts.join(' • ')}`
            });
        }

        // 6. Action Rows (Buttons / Selects) inside the V2 container
        if (Array.isArray(extraActionRows) && extraActionRows.length > 0) {
            extraActionRows.forEach(row => {
                const rowJson = (row && typeof row.toJSON === 'function') ? row.toJSON() : row;
                if (rowJson) innerComponents.push(rowJson);
            });
        }

        if (innerComponents.length === 0) {
            innerComponents.push({ type: 10, content: '​' });
        }

        return {
            flags: 32768, // MessageFlags.IsComponentsV2 (1 << 15)
            components: [
                {
                    type: 17, // Container
                    accent_color: accentColor,
                    components: innerComponents
                }
            ]
        };
    },

    /**
     * Sanitizes an interaction/message payload for Discord Components V2.
     * Prevents DiscordAPIError[50035]: data.embeds[MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2]
     */
    sanitizeComponentsV2Payload: function(options, targetMessage) {
        if (!options || typeof options !== 'object') return options;

        const msgHasV2 = Boolean(
            targetMessage?.flags?.has?.(32768) ||
            ((targetMessage?.flags?.bitfield || 0) & 32768) !== 0 ||
            ((options?.flags || 0) & 32768) !== 0
        );

        if (options.embeds && Array.isArray(options.embeds) && options.embeds.length > 0) {
            try {
                const v2 = module.exports.buildEmbedV2Container(
                    options.embeds[0],
                    options.components || [],
                    options.content || ''
                );
                const safe = {
                    ...options,
                    isComponentsV2Converted: true,
                    content: undefined,
                    components: v2.components,
                    flags: (options.flags || 0) | 32768
                };
                delete safe.embeds;
                return safe;
            } catch (e) {
                if (msgHasV2) {
                    const fallback = { ...options };
                    delete fallback.embeds;
                    return fallback;
                }
                return options;
            }
        } else if (msgHasV2 && 'embeds' in options) {
            const clean = { ...options };
            delete clean.embeds;
            return clean;
        }

        return options;
    }
};

// 🛡️ Global Protection for Discord Components V2 Message Updates & Edits
const { MessageComponentInteraction, ModalSubmitInteraction, Message, MessagePayload } = require('discord.js');

if (MessagePayload && MessagePayload.prototype && !MessagePayload.prototype._v2BodyPatched) {
    MessagePayload.prototype._v2BodyPatched = true;
    const origResolveBody = MessagePayload.prototype.resolveBody;
    MessagePayload.prototype.resolveBody = function() {
        const res = origResolveBody.call(this);
        try {
            const targetMsg = this.target?.message || (this.isMessage ? this.target : null);
            const hasV2Flag = Boolean(
                ((this.body?.flags || 0) & 32768) !== 0 ||
                targetMsg?.flags?.has?.(32768) ||
                ((targetMsg?.flags?.bitfield || 0) & 32768) !== 0
            );
            if (hasV2Flag && this.body) {
                if (Array.isArray(this.body.embeds) && this.body.embeds.length > 0) {
                    const v2 = module.exports.buildEmbedV2Container(
                        this.body.embeds[0],
                        this.body.components || [],
                        this.body.content || ''
                    );
                    this.body.components = v2.components;
                    this.body.flags = (this.body.flags || 0) | 32768;
                } else if (this.body.content && String(this.body.content).trim().length > 0 && (!this.body.components || this.body.components.length === 0)) {
                    const v2 = module.exports.buildEmbedV2Container(
                        { description: String(this.body.content) },
                        []
                    );
                    this.body.components = v2.components;
                    this.body.flags = (this.body.flags || 0) | 32768;
                }
                delete this.body.embeds;
                delete this.body.content;
            }
        } catch (_) {}
        return res;
    };
}

if (MessageComponentInteraction && MessageComponentInteraction.prototype && !MessageComponentInteraction.prototype._v2Patched) {
    MessageComponentInteraction.prototype._v2Patched = true;
    const origUpdate = MessageComponentInteraction.prototype.update;
    MessageComponentInteraction.prototype.update = function(options) {
        try {
            const safeOptions = module.exports.sanitizeComponentsV2Payload(options, this.message);
            return origUpdate.call(this, safeOptions);
        } catch (e) {
            return origUpdate.call(this, options);
        }
    };
}

if (ModalSubmitInteraction && ModalSubmitInteraction.prototype && !ModalSubmitInteraction.prototype._v2Patched) {
    ModalSubmitInteraction.prototype._v2Patched = true;
    const origModalUpdate = ModalSubmitInteraction.prototype.update;
    ModalSubmitInteraction.prototype.update = function(options) {
        try {
            const safeOptions = module.exports.sanitizeComponentsV2Payload(options, this.message);
            return origModalUpdate.call(this, safeOptions);
        } catch (e) {
            return origModalUpdate.call(this, options);
        }
    };
}

if (Message && Message.prototype && !Message.prototype._v2Patched) {
    Message.prototype._v2Patched = true;
    const origEdit = Message.prototype.edit;
    Message.prototype.edit = function(options) {
        try {
            const safeOptions = module.exports.sanitizeComponentsV2Payload(options, this);
            return origEdit.call(this, safeOptions);
        } catch (e) {
            return origEdit.call(this, options);
        }
    };
}

