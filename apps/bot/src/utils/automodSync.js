const { AutoModerationRuleEventType, AutoModerationRuleTriggerType, AutoModerationRuleKeywordPresetType, AutoModerationActionType } = require('discord.js');

function parseImmuneRoles(immuneRolesString) {
    if (!immuneRolesString) return [];
    const trimmed = immuneRolesString.trim();
    if (!trimmed) return [];
    
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.map(String);
        } catch (e) {}
    }
    
    return trimmed.split(/[,\s]+/).map(id => id.trim()).filter(id => /^\d+$/.test(id));
}

/**
 * Synchronizes Nora AutoMod rules with Discord's native system.
 * Discord limits: 1 KeywordPreset rule total.
 */

async function syncAutoModRule(guild, ruleType, enabled, threshold = 0, settings = null) {
    const translateError = (e) => {
        if (e.message.includes('community')) {
            return 'Auto-Mod requires this server to be a **Community Guild**. Enable Community in your server settings first.';
        }
        if (e.message.includes('403')) {
            return 'Nora lacks permission to manage Auto-Mod. Check "Manage Server" permissions and role hierarchy.';
        }
        if (e.message.includes('Max number of rules')) {
            return 'This server has reached Discord\'s limit for Auto-Mod rules (Max 10 total).';
        }
        return e.message;
    };

    if (!guild.members.me.permissions.has('ManageGuild')) {
        return { success: false, error: 'Nora needs the **Manage Server** permission to control Auto-Mod.' };
    }

    if (!guild.features.includes('COMMUNITY')) {
        return { success: false, error: 'Auto-Mod is only available for **Community Servers**. Please enable Community in settings first.' };
    }

    const existingRules = await guild.autoModerationRules.fetch().catch(e => {
        return { error: translateError(e) };
    });

    if (existingRules.error) return { success: false, error: existingRules.error };



    if (!settings) {
        try {
            const GuildSettings = require('../database/models/GuildSettings');
            settings = await GuildSettings.findByPk(guild.id);
        } catch (err) {}
    }
    const exemptRoles = settings ? parseImmuneRoles(settings.automodImmuneRoles) : [];

    // Group 1: Native Keyword Presets (Combined due to Discord LIMIT)
    const isPreset = ['profanity', 'sexual', 'slurs'].includes(ruleType);

    if (isPreset) {
        if (!settings) return { success: false, error: 'Nora settings could not be retrieved for this server.' };

        const ruleName = '[NORA] Global Content Filter';
        const existingRule = existingRules.find(r => r.name === ruleName || (r.triggerType === AutoModerationRuleTriggerType.KeywordPreset && r.name.includes('[NORA]')));

        const activePresets = [];
        if (settings.automodProfanity) activePresets.push(AutoModerationRuleKeywordPresetType.Profanity);
        if (settings.automodSexual) activePresets.push(AutoModerationRuleKeywordPresetType.SexualContent);
        if (settings.automodSlurs) activePresets.push(AutoModerationRuleKeywordPresetType.Slurs);

        if (activePresets.length === 0) {
            if (existingRule) await existingRule.delete().catch(() => { });
            return { success: true };
        }

        // Check for non-Nora overlaps
        const hasOverlap = existingRules.some(r => r.triggerType === AutoModerationRuleTriggerType.KeywordPreset && !r.name.includes('[NORA]'));
        if (hasOverlap) return { success: false, error: 'An external preset rule already exists. Please delete it first.' };

        // Discord API rejects custom messages on preset rules.
        const actions = [{ type: AutoModerationActionType.BlockMessage }];

        try {
            if (existingRule) {
                await existingRule.edit({
                    name: ruleName,
                    triggerMetadata: { presets: activePresets },
                    actions,
                    exemptRoles,
                    enabled: true
                });
            } else {
                await guild.autoModerationRules.create({
                    name: ruleName,
                    eventType: AutoModerationRuleEventType.MessageSend,
                    triggerType: AutoModerationRuleTriggerType.KeywordPreset,
                    triggerMetadata: { presets: activePresets },
                    actions,
                    exemptRoles,
                    enabled: true
                });
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: translateError(e) };
        }
    }

    // Group 2: Individual Rules (Mentions, Scam, Hardcore)
    const names = {
        'mentions': '[NORA] Block Mention Spam',
        'scam': '[NORA] Block Scam Links',
        'hardcore': '[NORA] Strict Content Filter (Regex)'
    };

    const ruleName = names[ruleType];
    const existingRule = existingRules.find(r => r.name === ruleName);

    if (!enabled) {
        if (existingRule) await existingRule.delete().catch(() => { });
        return { success: true };
    }

    let triggerType;
    let triggerMetadata = {};
    const eventType = AutoModerationRuleEventType.MessageSend;

    switch (ruleType) {
        case 'mentions':
            triggerType = AutoModerationRuleTriggerType.MentionSpam;
            triggerMetadata = { mentionTotalLimit: threshold || 5 };
            break;
        case 'scam':
            triggerType = AutoModerationRuleTriggerType.Keyword;
            triggerMetadata = { keywordFilter: ['*nitro*', '*gift card*', '*crypto*', '*free skins*', '*steam.promo*'] };
            break;
        case 'hardcore':
            triggerType = AutoModerationRuleTriggerType.Keyword;
            triggerMetadata = { regexPatterns: ['(?i)f[u*]ck', '(?i)n[i*]+gg[e*]r', '(?i)p[o*]rn'] };
            break;
    }

    const actions = [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Blocked by Nora Safety.' } }];
    if (ruleType === 'mentions') {
        actions.push({ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: 60 } });
    }

    try {
        if (existingRule) {
            await existingRule.edit({
                triggerMetadata,
                actions,
                exemptRoles,
                enabled: true
            });
        } else {
            await guild.autoModerationRules.create({
                name: ruleName,
                eventType,
                triggerType,
                triggerMetadata,
                actions,
                exemptRoles,
                enabled: true
            });
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: translateError(e) };
    }
}

async function syncAllAutoModRules(guild, settings = null) {
    if (!settings) {
        const GuildSettings = require('../database/models/GuildSettings');
        settings = await GuildSettings.findOne({ where: { guildId: guild.id } });
    }
    if (!settings) return { success: false, error: 'Database settings missing.' };

    const results = [];
    results.push(await syncAutoModRule(guild, 'profanity', true, 0, settings));
    results.push(await syncAutoModRule(guild, 'scam', settings.automodScam, 0, settings));
    results.push(await syncAutoModRule(guild, 'hardcore', settings.automodHardcore, 0, settings));
    results.push(await syncAutoModRule(guild, 'mentions', settings.automodMentions > 0, settings.automodMentions, settings));

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) return { success: false, error: failed[0].error };
    return { success: true };
}

module.exports = { syncAutoModRule, syncAllAutoModRules, parseImmuneRoles };
