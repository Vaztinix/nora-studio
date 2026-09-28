const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');
const noraVoiceAIManager = require('../../utils/noraVoiceAIManager');
const geminiKeyManager = require('../../utils/geminiKeyManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voice-ai')
        .setDescription('Summon Nora Voice AI (Speech-to-Text & Real-Time Spoken Audio) in Milo\'s World')
        .addSubcommand(sub =>
            sub.setName('join')
                .setDescription('Summon Nora Voice AI into your current voice channel')
        )
        .addSubcommand(sub =>
            sub.setName('leave')
                .setDescription('Disconnect Nora Voice AI from the voice channel')
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('View active voice AI pipeline, audio visualizer, and quota status')
        )
        .setDMPermission(false),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // 1. Beta Guild Restriction Check
        if (!noraVoiceAIManager.isGuildAllowed(guildId)) {
            const betaPayload = noraVoiceAIManager.getBetaRestrictionPayload();
            return interaction.reply({
                ...betaPayload,
                ephemeral: true
            });
        }

        // 2. Execute Subcommands
        if (subcommand === 'join') {
            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) {
                return interaction.reply({
                    content: '❌ **You must be in a Voice Channel** in Milo\'s World before summoning Nora Voice AI!',
                    ephemeral: true
                });
            }

            await interaction.deferReply();

            const result = await noraVoiceAIManager.joinVoice(voiceChannel, interaction.channel, interaction.member);
            if (!result.success) {
                if (result.isRestricted) {
                    return interaction.editReply(result.payload);
                }
                return interaction.editReply({ content: result.message });
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('🎙️ Nora Voice AI Connected')
                .setDescription(
                    `✨ Successfully joined **${voiceChannel.name}**!\n\n` +
                    `• **Speech-to-Text:** Active (Gemini Transcribe)\n` +
                    `• **Voice Synthesis:** Active (Real-Time Neural Speech)\n` +
                    `• **Interactive Visualizer:** Displayed below\n\n` +
                    `*Unmute your microphone and speak naturally to talk with Nora!*`
                )
                .setColor(0x00F0FF)
                .setFooter({ text: 'Milo\'s World Voice AI • Real-Time Voice Assistant' });

            return interaction.editReply({ embeds: [successEmbed] });
        }

        if (subcommand === 'leave') {
            const session = noraVoiceAIManager.getSession(guildId);
            if (!session) {
                return interaction.reply({
                    content: 'ℹ️ Nora Voice AI is not currently connected to any voice channel in this server.',
                    ephemeral: true
                });
            }

            noraVoiceAIManager.leaveVoice(guildId, true);
            return interaction.reply({
                content: '🛑 Nora Voice AI has disconnected from the voice channel.',
                ephemeral: true
            });
        }

        if (subcommand === 'status') {
            const session = noraVoiceAIManager.getSession(guildId);
            const quotaStats = geminiKeyManager.getQuotaStats();

            const statusEmbed = new EmbedBuilder()
                .setTitle('📊 Nora Voice AI — System Status')
                .setColor(session ? 0x00FF88 : 0x5865F2)
                .addFields(
                    {
                        name: '🎙️ Voice Session',
                        value: session
                            ? `🟢 **Online** in \`${session.voiceChannel.name}\`\nInitiator: <@${session.initiatorMember.id}>`
                            : '⚪ **Idle** (Not connected to voice)',
                        inline: true
                    },
                    {
                        name: '⚡ Quota Headroom',
                        value: `**~${quotaStats.wordsRemainingInWindow.toLocaleString()} words** left in active window\nDaily Headroom: ~${quotaStats.wordsRemainingDaily.toLocaleString()} words`,
                        inline: true
                    },
                    {
                        name: '🔑 Multi-Key Pool',
                        value: `Active Keys: **${quotaStats.availableKeys}/${quotaStats.totalKeys}**\nTotal Requests: **${quotaStats.totalRequests}**`,
                        inline: true
                    }
                )
                .setFooter({ text: 'Nora Voice AI Core • Milo\'s World' })
                .setTimestamp();

            return interaction.reply({ embeds: [statusEmbed], ephemeral: true });
        }
    }
};
