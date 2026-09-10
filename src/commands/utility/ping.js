const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const sequelize = require('../../database/db');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check connection latency, gateway heartbeat, and system health.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        const start = Date.now();
        const wsPing = Math.max(1, Math.round(interaction.client.ws.ping || 20));

        // Measure database query speed
        let dbLatency = 0;
        try {
            const dbStart = Date.now();
            await sequelize.query('SELECT 1+1 AS result;');
            dbLatency = Date.now() - dbStart;
        } catch (e) {
            dbLatency = -1;
        }

        const buildEmbed = (apiRoundtrip, currentWs, currentDb) => {
            const mem = process.memoryUsage();
            const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
            const totalGuilds = interaction.client.guilds.cache.size;

            let qualityText = 'Operational';
            let qualityColor = 0x5865F2;

            if (currentWs > 250 || apiRoundtrip > 350) {
                qualityText = 'High Latency';
                qualityColor = 0xED4245;
            } else if (currentWs > 120 || apiRoundtrip > 200) {
                qualityText = 'Moderate';
                qualityColor = 0xFEE75C;
            }

            return new EmbedBuilder()
                .setAuthor({ 
                    name: 'Nora Network Diagnostics', 
                    iconURL: interaction.client.user.displayAvatarURL() 
                })
                .setTitle('Latency & System Health')
                .setColor(qualityColor)
                .setDescription(`Status: **${qualityText}**`)
                .addFields(
                    { 
                        name: 'Gateway WebSocket', 
                        value: `\`${currentWs}ms\` (Discord heartbeat)`, 
                        inline: true 
                    },
                    { 
                        name: 'REST Roundtrip', 
                        value: `\`${apiRoundtrip}ms\` (API latency)`, 
                        inline: true 
                    },
                    { 
                        name: 'Database Query', 
                        value: currentDb >= 0 ? `\`${currentDb}ms\` (SQLite cluster)` : '`Unavailable`', 
                        inline: true 
                    },
                    { 
                        name: 'Memory (Heap)', 
                        value: `\`${heapMB} MB\``, 
                        inline: true 
                    },
                    { 
                        name: 'Active Servers', 
                        value: `\`${totalGuilds}\` on Shard 0`, 
                        inline: true 
                    },
                    { 
                        name: 'Uptime', 
                        value: `<t:${Math.floor((Date.now() - (process.uptime() * 1000)) / 1000)}:R>`, 
                        inline: true 
                    }
                )
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();
        };

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_ping_refresh')
                .setLabel('Refresh')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setLabel('Status Page')
                .setURL('https://vaztinix.dev')
                .setStyle(ButtonStyle.Link)
        );

        let initialReply;
        if (interaction.deferred || interaction.replied) {
            initialReply = await interaction.editReply({ 
                content: 'Measuring latency...', 
                fetchReply: true 
            });
        } else {
            initialReply = await interaction.reply({ 
                content: 'Measuring latency...', 
                fetchReply: true 
            });
        }

        const apiRoundtrip = Math.max(1, Date.now() - start);
        const embed = buildEmbed(apiRoundtrip, wsPing, dbLatency);

        const responseMsg = await interaction.editReply({
            content: null,
            embeds: [embed],
            components: [buttons]
        });

        // Interactive collector for instant refresh
        const collector = responseMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000
        });

        collector.on('collect', async (btnInt) => {
            if (btnInt.customId === 'btn_ping_refresh') {
                const refreshStart = Date.now();
                await btnInt.deferUpdate();

                let newDb = 0;
                try {
                    const dStart = Date.now();
                    await sequelize.query('SELECT 1+1 AS result;');
                    newDb = Date.now() - dStart;
                } catch (e) {
                    newDb = -1;
                }

                const newWs = Math.max(1, Math.round(interaction.client.ws.ping || 20));
                const newRoundtrip = Math.max(1, Date.now() - refreshStart);
                const updatedEmbed = buildEmbed(newRoundtrip, newWs, newDb);

                await interaction.editReply({
                    embeds: [updatedEmbed],
                    components: [buttons]
                });
            }
        });

        collector.on('end', async () => {
            const disabledButtons = ActionRowBuilder.from(buttons);
            disabledButtons.components[0].setDisabled(true);
            await interaction.editReply({ components: [disabledButtons] }).catch(() => {});
        });
    }
};
