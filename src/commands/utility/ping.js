const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, PermissionFlagsBits } = require('discord.js');
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
        const wsPing = Math.max(1, Math.round(interaction.client.ws?.ping || 20));

        // Measure database query speed
        let dbLatency = 0;
        try {
            const dbStart = Date.now();
            await sequelize.query('SELECT 1+1 AS result;');
            dbLatency = Date.now() - dbStart;
        } catch (e) {
            dbLatency = -1;
        }

        // Check if the bot has permission to send embeds in the channel
        const botMember = interaction.guild?.members?.me || (interaction.guild ? interaction.guild.members.cache.get(interaction.client.user?.id) : null);
        const hasEmbedPerms = !interaction.guild || !interaction.channel?.permissionsFor || Boolean(interaction.channel.permissionsFor(botMember)?.has(PermissionFlagsBits.EmbedLinks));

        const buildResponse = (apiRoundtrip, currentWs, currentDb) => {
            const mem = process.memoryUsage();
            const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
            const totalGuilds = interaction.client.guilds?.cache?.size || 1;

            let qualityText = 'Operational';
            let qualityColor = 0x5865F2;
            let qualityEmoji = '🟢';

            if (currentWs > 250 || apiRoundtrip > 350) {
                qualityText = 'High Latency';
                qualityColor = 0xED4245;
                qualityEmoji = '🔴';
            } else if (currentWs > 120 || apiRoundtrip > 200) {
                qualityText = 'Moderate';
                qualityColor = 0xFEE75C;
                qualityEmoji = '🟡';
            }

            const dbFormatted = currentDb >= 0 ? `${currentDb}ms` : 'Unavailable';
            const summaryText = `${qualityEmoji} 🏓 **Pong!** Gateway: \`${currentWs}ms\` • REST API: \`${apiRoundtrip}ms\` • Database: \`${dbFormatted}\``;

            const userTag = interaction.user?.tag || interaction.user?.username || 'User';

            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: 'Nora Network Diagnostics', 
                    iconURL: interaction.client.user?.displayAvatarURL?.() || null
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
                .setFooter({ text: `Requested by ${userTag}` })
                .setTimestamp();

            if (!hasEmbedPerms) {
                const fallbackContent = 
                    `${summaryText}\n\n` +
                    `• **Memory:** \`${heapMB} MB\` (Heap Used)\n` +
                    `• **Active Servers:** \`${totalGuilds}\` on Shard 0\n` +
                    `• **Uptime:** <t:${Math.floor((Date.now() - (process.uptime() * 1000)) / 1000)}:R>\n\n` +
                    `⚠️ *Note: Grant Nora the **Embed Links** permission in this channel to render the full diagnostics card.*`;
                return { content: fallbackContent, embeds: [] };
            }

            return { content: summaryText, embeds: [embed] };
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
                content: '🏓 Measuring latency...', 
                fetchReply: true 
            });
        } else {
            initialReply = await interaction.reply({ 
                content: '🏓 Measuring latency...', 
                fetchReply: true 
            });
        }

        const apiRoundtrip = Math.max(1, Date.now() - start);
        const responseData = buildResponse(apiRoundtrip, wsPing, dbLatency);

        const responseMsg = await interaction.editReply({
            content: responseData.content,
            embeds: responseData.embeds,
            components: [buttons]
        });

        // Interactive collector for instant refresh
        if (responseMsg && typeof responseMsg.createMessageComponentCollector === 'function') {
            const collector = responseMsg.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000
            });

            collector.on('collect', async (btnInt) => {
                if (btnInt.customId === 'btn_ping_refresh') {
                    const refreshStart = Date.now();
                    await btnInt.deferUpdate().catch(() => {});

                    let newDb = 0;
                    try {
                        const dStart = Date.now();
                        await sequelize.query('SELECT 1+1 AS result;');
                        newDb = Date.now() - dStart;
                    } catch (e) {
                        newDb = -1;
                    }

                    const newWs = Math.max(1, Math.round(interaction.client.ws?.ping || 20));
                    const newRoundtrip = Math.max(1, Date.now() - refreshStart);
                    const freshData = buildResponse(newRoundtrip, newWs, newDb);

                    await interaction.editReply({
                        content: freshData.content,
                        embeds: freshData.embeds,
                        components: [buttons]
                    }).catch(() => {});
                }
            });

            collector.on('end', async () => {
                const disabledButtons = ActionRowBuilder.from(buttons);
                disabledButtons.components[0].setDisabled(true);
                await interaction.editReply({ components: [disabledButtons] }).catch(() => {});
            });
        }
    }
};
