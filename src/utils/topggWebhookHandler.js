const { EmbedBuilder } = require('discord.js');

function replacePlaceholders(template, user, guild, settings, voteCount, count) {
    if (!template) return '';
    return template
        .replace(/{user\.mention}/g, user ? `<@${user.id}>` : `Unknown User`)
        .replace(/{user\.tag}/g, user ? user.tag : 'Voter#0000')
        .replace(/{user\.username}/g, user ? user.username : 'Voter')
        .replace(/{user\.displayname}/g, user ? (user.globalName || user.username) : 'Voter')
        .replace(/{user\.id}/g, user ? user.id : '0')
        .replace(/{guild\.name}/g, guild.name)
        .replace(/{guild\.count}/g, guild.memberCount)
        .replace(/{guild\.active}/g, guild.presences?.cache?.filter(p => p.status !== 'offline').size || guild.memberCount)
        .replace(/{bot\.name}/g, guild.client.user.username)
        .replace(/{bot\.link}/g, settings.topggBotId ? `https://top.gg/bot/${settings.topggBotId}` : `https://top.gg`)
        .replace(/{count}/g, count.toString());
}

async function sendVoteNotification(guild, settings, userId, isTest = false) {
    const channel = guild.channels.cache.get(settings.topggVoteChannelId);
    if (!channel) return console.warn(`[Top.gg handler] Vote channel ${settings.topggVoteChannelId} not found in guild ${guild.id}`);

    // Fetch user details
    const member = await guild.members.fetch(userId).catch(() => null);
    const user = member ? member.user : await guild.client.users.fetch(userId).catch(() => null);

    const voteCount = settings.voteCount || 0; // fallback
    const count = isTest ? 1 : ((settings.topggDoubleXp && [6, 0].includes(new Date().getDay())) ? 2 : 1);

    // Build alert content and embed
    const contentTemplate = settings.topggVoteContent || 'New vote alert!';
    const embedTemplate = settings.topggVoteMessage || '{user.mention} just voted! Thanks!';

    const formattedContent = replacePlaceholders(contentTemplate, user, guild, settings, voteCount, count);
    const formattedEmbedDesc = replacePlaceholders(embedTemplate, user, guild, settings, voteCount, count);

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
            if (!webhook) {
                webhook = await channel.createWebhook({
                    name: settings.topggWebhookName || 'Nora Vote Tracker',
                    avatar: settings.topggWebhookAvatar || null,
                    reason: 'Nora Vote Notification Webhook'
                });
            }

            const sendPayload = {
                content: formattedContent || undefined,
                embeds: [embed],
                username: settings.topggWebhookName || 'Nora Vote Tracker',
                avatarURL: settings.topggWebhookAvatar || undefined
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
