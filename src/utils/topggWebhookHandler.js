const { EmbedBuilder } = require('discord.js');

function replacePlaceholders(template, user, guild, settings, voteCount, count, customBot = null) {
    if (!template) return '';
    const botName = customBot ? customBot.username : guild.client.user.username;
    return template
        .replace(/{user\.mention}/g, user ? `<@${user.id}>` : `Unknown User`)
        .replace(/{user\.tag}/g, user ? user.tag : 'Voter#0000')
        .replace(/{user\.username}/g, user ? user.username : 'Voter')
        .replace(/{user\.displayname}/g, user ? (user.globalName || user.username) : 'Voter')
        .replace(/{user\.id}/g, user ? user.id : '0')
        .replace(/{guild\.name}/g, guild.name)
        .replace(/{guild\.count}/g, guild.memberCount)
        .replace(/{guild\.active}/g, guild.presences?.cache?.filter(p => p.status !== 'offline').size || guild.memberCount)
        .replace(/{bot\.name}/g, botName)
        .replace(/{bot\.link}/g, settings.topggBotId ? `https://top.gg/bot/${settings.topggBotId}` : `https://top.gg`)
        .replace(/{count}/g, count.toString());
}

async function sendVoteNotification(guild, settings, userId, isTest = false) {
    const channel = guild.channels.cache.get(settings.topggVoteChannelId);
    if (!channel) return console.warn(`[Top.gg handler] Vote channel ${settings.topggVoteChannelId} not found in guild ${guild.id}`);

    // Fetch custom bot details if verified and linked
    let customBot = null;
    if (settings.topggVerified && settings.topggBotId) {
        customBot = await guild.client.users.fetch(settings.topggBotId).catch(() => null);
    }

    // Fetch user details
    const member = await guild.members.fetch(userId).catch(() => null);
    const user = member ? member.user : await guild.client.users.fetch(userId).catch(() => null);

    const voteCount = settings.voteCount || 0; // fallback
    const count = isTest ? 1 : ((settings.topggDoubleXp && [6, 0].includes(new Date().getDay())) ? 2 : 1);

    // Build alert content and embed
    const contentTemplate = settings.topggVoteContent || 'New vote alert!';
    const embedTemplate = settings.topggVoteMessage || '{user.mention} just voted! Thanks!';

    const formattedContent = replacePlaceholders(contentTemplate, user, guild, settings, voteCount, count, customBot);
    const formattedEmbedDesc = replacePlaceholders(embedTemplate, user, guild, settings, voteCount, count, customBot);

    const embed = new EmbedBuilder()
        .setDescription(formattedEmbedDesc)
        .setColor(settings.topggVoteEmbedColor || '#aeefff')
        .setTimestamp();

    if (settings.topggVoteEmbedImage) {
        embed.setImage(settings.topggVoteEmbedImage);
    }

    const botMember = guild.members.me || await guild.members.fetch(guild.client.user.id).catch(() => null);
    const canManageWebhooks = botMember && channel.permissionsFor(botMember)?.has('ManageWebhooks');

    if (canManageWebhooks) {
        try {
            const webhooks = await channel.fetchWebhooks();
            let webhook = webhooks.find(wh => wh.owner.id === guild.client.user.id);
            
            const webhookName = customBot ? customBot.username : (settings.topggWebhookName || 'Nora Vote Tracker');
            const webhookAvatar = customBot ? customBot.displayAvatarURL({ size: 128 }) : (settings.topggWebhookAvatar || null);

            if (!webhook) {
                webhook = await channel.createWebhook({
                    name: webhookName,
                    avatar: webhookAvatar,
                    reason: 'Nora Vote Notification Webhook'
                });
            } else {
                // Keep webhook credentials/identity synchronized with the custom bot
                await webhook.edit({
                    name: webhookName,
                    avatar: webhookAvatar
                }).catch(() => {});
            }

            const sendPayload = {
                content: formattedContent || undefined,
                embeds: [embed],
                username: webhookName,
                avatarURL: webhookAvatar
            };

            await webhook.send(sendPayload);
            return;
        } catch (e) {
            console.error('[Top.gg handler] Webhook execution failed, falling back to message send.', e);
        }
    }

    // Fallback to sending standard message
    await channel.send({ content: formattedContent || undefined, embeds: [embed] }).catch(err => {
        console.error('[Top.gg handler] Fallback message send failed:', err);
    });
}

module.exports = { sendVoteNotification };
