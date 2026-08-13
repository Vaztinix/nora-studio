const express = require('express');
const router = express.Router();
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const GuildSettings = require('../../database/models/GuildSettings');

/**
 * Dispatch embed message to target Discord webhook or channel
 */
/**
 * Dispatch embed message to target Discord webhook or channel
 */
async function dispatchBotBoardEmbed(client, targetUrlOrChannel, embed) {
    if (!targetUrlOrChannel || typeof targetUrlOrChannel !== 'string') return false;
    try {
        if (targetUrlOrChannel.startsWith('http://') || targetUrlOrChannel.startsWith('https://')) {
            const parsed = new URL(targetUrlOrChannel);
            const hostname = parsed.hostname.toLowerCase();
            const isDiscordWebhook = parsed.protocol === 'https:' &&
                ['discord.com', 'canary.discord.com', 'ptb.discord.com'].includes(hostname) &&
                parsed.pathname.startsWith('/api/webhooks/');
            if (!isDiscordWebhook) {
                console.warn('[BotBoard Webhook Security] Blocked non-Discord webhook dispatch target:', hostname);
                return false;
            }
            // Reconstruct safe target URL explicitly to satisfy static analysis
            const safeWebhookUrl = `https://${hostname}${parsed.pathname}`;
            await axios.post(safeWebhookUrl, {
                embeds: [embed.toJSON()]
            }, { timeout: 5000 });
            return true;
        } else if (/^\d{17,20}$/.test(targetUrlOrChannel) && client && client.channels) {
            // Channel ID lookup
            const channel = await client.channels.fetch(targetUrlOrChannel).catch(() => null);
            if (channel && channel.send) {
                await channel.send({ embeds: [embed] });
                return true;
            }
        }
    } catch (err) {
        console.error('[BotBoard Webhook Dispatch Error]', err.message);
    }
    return false;
}

/**
 * Create formatted BotBoard Embed
 */
function buildBotBoardEmbed(payload) {
    const event = payload.event || 'new_review';
    const data = payload.data || {};
    const bot = data.bot || { name: 'Nora', slug: 'nora' };
    const review = data.review || {};

    const embed = new EmbedBuilder().setTimestamp();

    if (event === 'new_review') {
        const rawRating = parseInt(review.rating, 10);
        const rating = (!isNaN(rawRating) && isFinite(rawRating)) ? Math.min(5, Math.max(1, rawRating)) : 5;
        const starMap = ['', '⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];
        const stars = starMap[rating] || '⭐⭐⭐⭐⭐';
        const reviewer = review.reviewer || 'Anonymous';
        const body = review.body || 'Great bot!';
        const url = review.url || 'https://botboard.gg';
        const serverSize = review.serverSize ? `(${review.serverSize.toLocaleString()} servers)` : '';

        embed
            .setTitle(`🌟 New BotBoard Review for ${bot.name}!`)
            .setURL(url)
            .setColor('#7C3AED') // Vibrant Purple
            .setDescription(`"${body}"`)
            .addFields(
                { name: 'Rating', value: `${stars} (${rating}/5)`, inline: true },
                { name: 'Reviewer', value: `\`${reviewer}\` ${serverSize}`, inline: true }
            )
            .setFooter({ text: 'BotBoard.gg Webhook Integration' });
    } else if (event === 'health_change') {
        const score = data.healthScore || 100;
        const change = data.change || '+10';
        embed
            .setTitle(`💖 BotBoard Health Score Update`)
            .setColor('#10B981') // Emerald Green
            .setDescription(`Nora's listing health score changed by **${change}** points! Current Score: **${score}/100**`)
            .setFooter({ text: 'BotBoard.gg Health Monitor' });
    } else if (event === 'bot_featured') {
        embed
            .setTitle(`🎉 Nora is Featured on BotBoard.gg!`)
            .setColor('#F59E0B') // Amber Gold
            .setDescription(`Nora has been featured in a curated collection on BotBoard.gg!`)
            .setURL(review.url || 'https://botboard.gg')
            .setFooter({ text: 'BotBoard.gg Collection Features' });
    } else {
        // Test Ping / Generic
        embed
            .setTitle(`🔔 BotBoard Webhook Connected!`)
            .setColor('#3B82F6') // Blue
            .setDescription(`Test ping received successfully! BotBoard webhooks are online and listening for reviews.`)
            .setFooter({ text: 'BotBoard.gg Integration Test' });
    }

    return embed;
}

module.exports = function(client) {
    // ─────────────────────────────────────────────────────────────────────────────
    // 📥 INCOMING WEBHOOK RECEIVER FROM BOTBOARD.GG
    // ─────────────────────────────────────────────────────────────────────────────
    router.post('/', async (req, res) => {
        try {
            const payload = req.body || {};
            const safeEvent = String(payload.event || 'unknown').replace(/[^\w-]/g, '');
            console.log('[BotBoard Webhook Incoming] Event:', safeEvent);

            // Respond quickly with 200 OK to BotBoard servers
            res.json({ status: 'success', message: 'Webhook event processed.' });

            const embed = buildBotBoardEmbed(payload);

            // Forward to globally configured webhook or channel
            const globalWebhook = process.env.BOTBOARD_WEBHOOK_URL || process.env.DISCORD_LOG_WEBHOOK;
            if (globalWebhook) {
                await dispatchBotBoardEmbed(client, globalWebhook, embed);
            }

            // Also check GuildSettings for configured target channels
            const settingsList = await GuildSettings.findAll({
                where: { botboardWebhookUrl: { [require('sequelize').Op.ne]: null } }
            }).catch(() => []);

            for (const s of settingsList) {
                if (s.botboardWebhookUrl) {
                    await dispatchBotBoardEmbed(client, s.botboardWebhookUrl, embed);
                }
            }
        } catch (err) {
            console.error('[BotBoard Webhook Receiver Error]', err);
            if (!res.headersSent) res.status(500).json({ error: err.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 🧪 TEST PING ENDPOINT FOR DASHBOARD
    // ─────────────────────────────────────────────────────────────────────────────
    router.post('/test', async (req, res) => {
        try {
            const { targetUrl } = req.body || {};
            if (!targetUrl) {
                return res.status(400).json({ error: 'Target webhook URL or channel ID is required.' });
            }

            const testPayload = {
                event: 'new_review',
                timestamp: new Date().toISOString(),
                data: {
                    bot: { name: 'Nora', slug: 'nora' },
                    review: {
                        rating: 5,
                        body: 'Nora is an incredible Discord assistant! Super fast, beautiful dashboard, and rich features.',
                        reviewer: 'Vaztinix',
                        serverSize: client.guilds ? client.guilds.cache.size : 60,
                        url: 'https://botboard.gg/bots/nora'
                    }
                }
            };

            const embed = buildBotBoardEmbed(testPayload);
            const success = await dispatchBotBoardEmbed(client, targetUrl, embed);

            if (success) {
                res.json({ status: 'ok', message: 'Test review embed sent successfully to target!' });
            } else {
                res.status(400).json({ error: 'Failed to deliver test message. Verify channel ID or Discord Webhook URL.' });
            }
        } catch (err) {
            console.error('[BotBoard Test Error]', err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
