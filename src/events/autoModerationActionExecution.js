const { Events, EmbedBuilder, AutoModerationRuleTriggerType, AutoModerationActionType } = require('discord.js');
const settingsCache = require('../utils/settingsCache');
const loggerUtil = require('../utils/logger');

// Map trigger types to readable labels
const TRIGGER_LABELS = {
    [AutoModerationRuleTriggerType.Keyword]:       'Keyword / Regex Match',
    [AutoModerationRuleTriggerType.KeywordPreset]: 'Preset Word Filter',
    [AutoModerationRuleTriggerType.MentionSpam]:   'Mention Spam',
    [AutoModerationRuleTriggerType.Spam]:          'Spam Detected',
};

const ACTION_LABELS = {
    [AutoModerationActionType.BlockMessage]:   '🚫 Message Blocked',
    [AutoModerationActionType.SendAlertMessage]: '📢 Alert Sent',
    [AutoModerationActionType.Timeout]:         '⏱️ User Timed Out',
};

module.exports = {
    name: Events.AutoModerationActionExecution,
    async execute(execution, client) {
        if (!execution.guild) return;

        try {
            const settings = await settingsCache.get(execution.guild.id);
            if (!settings) return;
            if (!settings.logAutomod) return;

            const user = execution.user;
            const channel = execution.channel;

            // Rule metadata
            const triggerLabel = TRIGGER_LABELS[execution.ruleTriggerType] ?? `Rule Type ${execution.ruleTriggerType}`;
            const actionLabel  = ACTION_LABELS[execution.action?.type] ?? 'Unknown Action';

            const ruleName       = execution.ruleName       ?? 'Unknown Rule';
            const matchedKeyword = execution.matchedKeyword ?? null;
            const matchedContent = execution.matchedContent ?? null;
            const alertMessage   = execution.alertSystemMessage ?? null;

            const descLines = [
                `**User:** ${user ? `${user.username} (<@${user.id}>)` : 'Unknown User'}`,
                `**Channel:** ${channel ? `<#${channel.id}>` : 'Unknown Channel'}`,
                `**Rule:** \`${ruleName}\``,
                `**Trigger:** ${triggerLabel}`,
                `**Action:** ${actionLabel}`,
            ];

            if (matchedKeyword) descLines.push(`**Matched Keyword:** \`${matchedKeyword}\``);
            if (matchedContent) descLines.push(`**Matched Content:**\n\`\`\`${matchedContent.substring(0, 400)}\`\`\``);
            if (alertMessage)   descLines.push(`**Alert Message:** ${alertMessage}`);

            const embed = new EmbedBuilder()
                .setAuthor({
                    name: user ? `${user.username} (${user.id})` : 'Unknown User',
                    iconURL: user?.displayAvatarURL({ dynamic: true }) ?? undefined,
                })
                .setTitle('🛡️ Discord AutoMod Triggered')
                .setColor(0xED4245)
                .setDescription(descLines.join('\n'))
                .setTimestamp();

            await loggerUtil.sendEventLog(execution.guild, 'automod', embed, settings);
        } catch (error) {
            console.error('[AutoMod Event] Error in AutoModerationActionExecution:', error);
        }
    },
};
