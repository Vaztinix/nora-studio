const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

module.exports = {
    category: 'fun',
    data: new SlashCommandBuilder()
        .setName('arcade')
        .setDescription('Launch Nora Overdrive: Cyber Assault arcade game and view top pilot rankings.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1),

    async execute(interaction, settings) {
        // Read top pilots from leaderboard
        let topPilotsText = '*No high scores logged yet. Be the first to conquer the grid!*';
        try {
            const lbPath = path.join(__dirname, '..', '..', '..', 'arcadeLeaderboard.json');
            const raw = await fs.readFile(lbPath, 'utf8');
            const list = JSON.parse(raw);
            if (Array.isArray(list) && list.length > 0) {
                const sorted = [...list].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
                topPilotsText = sorted.map((p, idx) => {
                    const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `#${idx + 1}`));
                    return `${medal} **${p.username}** — **${(p.score || 0).toLocaleString()} pts** *(Wave ${p.wave || 1})*`;
                }).join('\n');
            }
        } catch (_) {}

        const arcadeUrl = process.env.BASE_URL 
            ? `${process.env.BASE_URL.replace(/\/$/, '')}/arcade` 
            : 'https://vaztinix.dev/arcade';

        const embed = new EmbedBuilder()
            .setTitle('🚀 Nora Overdrive: Cyber Assault')
            .setDescription(
                'Pilot the **NORA-X1 Quantum Cruiser** in our fast-paced neon synthwave space combat game! ' +
                'Annihilate swarms of rogue drones, weave through bullet barrages, defeat mega boss cores, and **earn real Nora leveling XP** directly synced to your Discord profile!\n\n' +
                '🎮 **Controls**:\n' +
                '• **WASD / Arrows**: Glide & maneuver ship\n' +
                '• **Space / Left Click**: Fire plasma blasters *(Auto-Fire supported)*\n' +
                '• **Shift / Right Click**: Warp Dash *(Invulnerable burst speed)*\n' +
                '• **Mobile & Discord App**: Touch & drag controls with ergonomic dash button'
            )
            .setColor(0x38bdf8)
            .addFields(
                { name: '🏆 Top Global Pilots', value: topPilotsText, inline: false },
                { name: '💎 Data Crystals & Rewards', value: 'Collecting Data Crystals earns score and awards up to **+500 Nora XP** per game run!', inline: false }
            )
            .setFooter({ text: 'Nora Studio Arcade • Play on Desktop, Mobile, or Discord Activities' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('🚀 Play in Browser')
                .setStyle(ButtonStyle.Link)
                .setURL(arcadeUrl),
            new ButtonBuilder()
                .setLabel('🏆 Full Leaderboard')
                .setStyle(ButtonStyle.Link)
                .setURL(`${arcadeUrl}#rankings`),
            new ButtonBuilder()
                .setLabel('⚡ Launch Activity')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.com/oauth2/authorize?client_id=' + (interaction.client.user?.id || '1366229304257544213') + '&scope=applications.commands')
        );

        const { buildEmbedV2Container } = require('../../utils/embeds');
        if (settings?.embedsVersion !== 'v1') {
            try {
                const v2 = buildEmbedV2Container(embed, [row]);
                return await interaction.reply({ ...v2 });
            } catch (_) {}
        }

        return await interaction.reply({ embeds: [embed], components: [row] });
    }
};

