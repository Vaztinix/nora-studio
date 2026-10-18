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

module.exports = {
    category: 'utility',
    ephemeral: false,
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set an AFK status to notify members when they mention you.')
        .setDMPermission(false)
        .addStringOption(opt =>
            opt.setName('status')
                .setDescription('The reason/status for being AFK (supports text, links, and GIFs)')
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
                )),

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

        // Calculate expiresAt if duration provided
        let expiresAt = null;
        if (rawDuration) {
            const durMs = parseDurationMs(rawDuration);
            if (durMs) {
                expiresAt = Date.now() + durMs;
            }
        }

        const member = interaction.member;
        let originalNickname = member.nickname || null;
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
            expiresAt
        );

        // Assign AFK role if configured
        let roleAssigned = false;
        if (member) {
            roleAssigned = await afkManager.applyAfkRole(interaction.guild, member);
        }

        // Separate URLs and GIFs from markdown bold so Discord embeds them reliably
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        const urls = combinedStatus.match(urlRegex);
        let replyContent;

        const timeSuffix = expiresAt ? ` *(Back <t:${Math.floor(expiresAt / 1000)}:R>)*` : '';
        const roleSuffix = roleAssigned ? ' • 🏷️ *Role assigned*' : '';

        if (!urls) {
            replyContent = `Set your AFK: **${combinedStatus}**${timeSuffix}${roleSuffix}`;
        } else {
            const textOnly = combinedStatus.replace(urlRegex, '').replace(/\s+/g, ' ').trim();
            const urlString = urls.join('\n');
            if (!textOnly) {
                replyContent = `Set your AFK:${timeSuffix}${roleSuffix}\n${urlString}`;
            } else {
                replyContent = `Set your AFK: **${textOnly}**${timeSuffix}${roleSuffix}\n${urlString}`;
            }
        }

        return await interaction.reply({
            content: replyContent,
            allowedMentions: { repliedUser: false }
        });
    }
};
