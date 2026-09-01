const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const afkManager = require('../../utils/afkManager');
const settingsCache = require('../../utils/settingsCache');
const { handleError } = require('../../utils/embeds');

module.exports = {
    category: 'utility',
    ephemeral: false,
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set an AFK status to notify members when they mention you.')
        .setDMPermission(false)
        .addStringOption(opt =>
            opt.setName('status')
                .setDescription('The reason/status for being AFK (e.g. Eating dinner, studying, sleeping)')
                .setMaxLength(200)
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

        const rawStatus = interaction.options.getString('status') || 'AFK';
        const status = rawStatus.trim() || 'AFK';

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
            status,
            originalNickname,
            autoNicknameChanged
        );

        return await interaction.reply({
            content: `💤 I set your AFK: **${status}**`,
            allowedMentions: { repliedUser: false }
        });
    }
};
