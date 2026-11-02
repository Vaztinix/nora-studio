const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const afkManager = require('../../utils/afkManager');
const settingsCache = require('../../utils/settingsCache');
const { handleError } = require('../../utils/embeds');

function parseDurationMs(input) {
    if (!input || typeof input !== 'string') return null;
    const match = input.trim().toLowerCase().match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/);
    if (!match) return null;
    const val = parseInt(match[1], 10);
    if (isNaN(val) || val <= 0) return null;
    const unit = match[2];
    if (unit.startsWith('m')) return val * 60 * 1000;
    if (unit.startsWith('h')) return val * 60 * 60 * 1000;
    if (unit.startsWith('d')) return val * 24 * 60 * 60 * 1000;
    return null;
}

async function resolveMediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    let clean = rawUrl.trim().replace(/^[\*_~<>`'"]+|[\*_~<>`'"]+$/g, '').trim();
    if (!clean) return null;
    try {
        const parsed = new URL(clean);
        if (parsed.hostname === 'klipy.com' || parsed.hostname.endsWith('.klipy.com')) {
            const slugMatch = clean.match(/klipy\.com\/(?:gifs|watch|clips|stickers|media)\/([a-zA-Z0-9_-]+)/i);
            if (slugMatch && slugMatch[1]) {
                const slug = slugMatch[1];
                const res = await fetch(`https://api.klipy.com/api/v1/gifs/${slug}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 NoraBot/1.0' },
                    signal: AbortSignal.timeout(3000)
                }).catch(() => null);
                if (res && res.ok) {
                    const data = await res.json().catch(() => null);
                    const direct = data?.data?.file?.hd?.gif?.url ||
                                   data?.data?.file?.md?.gif?.url ||
                                   data?.data?.file?.sm?.gif?.url ||
                                   data?.data?.file?.hd?.webp?.url;
                    if (direct) return direct;
                }
            }
        }
    } catch (_) {}
    return clean;
}

module.exports = {
    category: 'utility',
    ephemeral: false,
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set an AFK status to notify members when they mention you.')
        .setDMPermission(false)
        .addStringOption(opt =>
            opt.setName('status')
                .setDescription('The reason/status for being AFK (supports text and links)')
                .setMaxLength(500)
                .setRequired(false))
        .addStringOption(opt =>
            opt.setName('preset')
                .setDescription('Quick activity preset')
                .setRequired(false)
                .addChoices(
                    { name: '💤 Sleeping', value: 'Sleeping 💤' },
                    { name: '📚 Studying', value: 'Studying 📚' },
                    { name: '💼 Working', value: 'Working 💼' },
                    { name: '🍕 Eating', value: 'Eating 🍕' },
                    { name: '🎮 Gaming', value: 'Gaming 🎮' },
                    { name: '🚗 Driving', value: 'Driving 🚗' },
                    { name: '🏋️ Gym / Workout', value: 'Gym / Workout 🏋️' },
                    { name: '⏱️ Be Right Back', value: 'Be Right Back ⏱️' },
                    { name: '⛔ Busy / DND', value: 'Busy / DND ⛔' },
                    { name: '🚶 Away from Keyboard', value: 'Away from Keyboard 🚶' }
                ))
        .addStringOption(opt =>
            opt.setName('duration')
                .setDescription('Estimated duration you will be away (e.g. 15m, 1h, 8h)')
                .setRequired(false)
                .addChoices(
                    { name: '15 Minutes', value: '15m' },
                    { name: '30 Minutes', value: '30m' },
                    { name: '1 Hour', value: '1h' },
                    { name: '2 Hours', value: '2h' },
                    { name: '4 Hours', value: '4h' },
                    { name: '8 Hours', value: '8h' },
                    { name: '1 Day', value: '1d' }
                ))
        .addStringOption(opt =>
            opt.setName('gif')
                .setDescription('Optional GIF URL or image link (Tenor, Giphy, or direct image link)')
                .setRequired(false))
        .addAttachmentOption(opt =>
            opt.setName('media')
                .setDescription('Optional GIF or image attachment to display while AFK')
                .setRequired(false)),

    async execute(interaction) {
        const settings = await settingsCache.get(interaction.guild.id);
        if (settings && settings.afkEnabled === false) {
            return await handleError(
                interaction,
                'AFK Disabled',
                'The AFK system is currently disabled on this server.'
            );
        }

        const rawStatus = interaction.options.getString('status');
        const rawPreset = interaction.options.getString('preset');
        const rawDuration = interaction.options.getString('duration');
        const rawGif = interaction.options.getString('gif');
        const rawMedia = interaction.options.getAttachment('media');

        // Helper to strip markdown wrappers (**bold**, <angle>, etc.) from a URL while preserving underscores inside the URL path
        const cleanUrlForEmbed = (u) => {
            if (!u || typeof u !== 'string') return null;
            return u.trim()
                .replace(/^[\*_~<>`'"]+/, '')
                .replace(/[\*_~<>`'"]+$/, '')
                .trim();
        };

        // Extract GIF / image url if provided via option or attachment or inside status
        let gifUrl = null;
        if (rawMedia && (rawMedia.contentType?.startsWith('image/') || rawMedia.url)) {
            gifUrl = cleanUrlForEmbed(rawMedia.url);
        } else if (rawGif && /https?:\/\//i.test(rawGif.trim())) {
            gifUrl = cleanUrlForEmbed(rawGif);
        }

        // Combine preset and status intelligently
        let combinedStatus = '';
        if (rawPreset && rawStatus) {
            combinedStatus = `${rawPreset} — ${rawStatus.trim()}`;
        } else if (rawPreset) {
            combinedStatus = rawPreset;
        } else if (rawStatus) {
            combinedStatus = rawStatus.trim();
        } else {
            combinedStatus = 'AFK';
        }

        // Unwrap any markdown bold/italic/spoiler/angle-brackets surrounding URLs (preserving underscores in URLs)
        combinedStatus = combinedStatus.replace(/(?:\*{1,3}|_{1,2}|~{2}|<)+(https?:\/\/[^\s<>"'`]+?)(?:\*{1,3}|_{1,2}|~{2}|>)+/gi, '$1');

        // Also check if status text contains a direct GIF / image / Tenor / Giphy / Discord link
        const urlRegex = /(https?:\/\/[^\s<>*"'`]+)/gi;
        const matchedUrls = [...combinedStatus.matchAll(urlRegex)];
        if (!gifUrl && matchedUrls.length > 0) {
            const potentialMatch = matchedUrls.find(m => 
                /\.(gif|png|jpe?g|webp|mp4|webm)(\?.*)?$/i.test(m[1]) || 
                /tenor\.com|giphy\.com|imgur\.com|discordapp\.com|discordapp\.net|klipy\.com|catbox\.moe|gyazo\.com/i.test(m[1])
            ) || matchedUrls[0];
            if (potentialMatch) {
                gifUrl = cleanUrlForEmbed(potentialMatch[1]);
                // Remove the URL and any leftover empty markdown symbols from status text
                combinedStatus = combinedStatus
                    .replace(potentialMatch[0], '')
                    .replace(/\*{2,}/g, '')
                    .replace(/\s+/g, ' ')
                    .trim() || 'AFK';
            }
        }

        if (gifUrl) {
            gifUrl = await resolveMediaUrl(gifUrl);
        }

        // Calculate expiresAt if duration provided
        let expiresAt = null;
        if (rawDuration) {
            const durMs = parseDurationMs(rawDuration);
            if (durMs) {
                expiresAt = Date.now() + durMs;
            }
        }

        const member = interaction.member;
        let originalNickname = member?.nickname || null;
        let autoNicknameChanged = false;

        const autoNicknameEnabled = settings ? settings.afkAutoNickname !== false : true;

        if (autoNicknameEnabled && member && member.manageable) {
            const me = interaction.guild.members.me;
            if (me && me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                const currentName = member.displayName;
                if (!currentName.startsWith('[AFK]')) {
                    originalNickname = member.nickname; // null if they have no custom server nickname
                    const newNick = `[AFK] ${currentName}`.slice(0, 32);
                    try {
                        await member.setNickname(newNick);
                        autoNicknameChanged = true;
                    } catch (e) {
                        autoNicknameChanged = false;
                    }
                }
            }
        }

        await afkManager.setAfk(
            interaction.guild.id,
            interaction.user.id,
            combinedStatus,
            originalNickname,
            autoNicknameChanged,
            expiresAt,
            gifUrl
        );

        // Assign AFK role if configured
        let roleAssigned = false;
        if (member) {
            roleAssigned = await afkManager.applyAfkRole(interaction.guild, member);
        }

        const timeSuffix = expiresAt ? ` *(Back <t:${Math.floor(expiresAt / 1000)}:R>)*` : '';
        const roleSuffix = roleAssigned ? ' • 🏷️ *Role assigned*' : '';
        const hasCustomText = combinedStatus && combinedStatus !== 'AFK';
        const replyBody = gifUrl
            ? (hasCustomText ? `Set your AFK: **${combinedStatus}**${timeSuffix}${roleSuffix}\n${gifUrl}` : `Set your AFK:${timeSuffix}${roleSuffix}\n${gifUrl}`)
            : `Set your AFK: **${combinedStatus}**${timeSuffix}${roleSuffix}`;

        return await interaction.reply({
            content: replyBody,
            allowedMentions: { repliedUser: false }
        });
    }
};
