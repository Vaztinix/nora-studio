const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const GuildSettings = require('../../database/models/GuildSettings');
const settingsCache = require('../../utils/settingsCache');
const { POPULAR_DISCORD_GAMES, parseRules } = require('../../utils/activityVoiceRouter');

module.exports = {
    category: 'setup',
    data: new SlashCommandBuilder()
        .setName('activities')
        .setDescription('Configure Current User Activities and Game Voice Channel Locks.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View all active game voice channel locks and configuration.')
        )
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Lock a game to a specific voice channel.')
                .addStringOption(opt =>
                    opt.setName('game')
                        .setDescription('The name of the game (e.g. Roblox, Rocket League, Minecraft)')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('The voice channel users will be moved to when playing this game')
                        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a game voice channel lock.')
                .addStringOption(opt =>
                    opt.setName('game')
                        .setDescription('The game to remove from voice channel locking')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('toggle')
                .setDescription('Enable or disable the Current User Activities Voice Router.')
                .addBooleanOption(opt =>
                    opt.setName('enabled')
                        .setDescription('Enable or disable the system')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('notify')
                .setDescription('Toggle whether users receive a polite DM when automatically routed.')
                .addBooleanOption(opt =>
                    opt.setName('enabled')
                        .setDescription('Send a direct message when moved')
                        .setRequired(true)
                )
        ),

    /**
     * Autocomplete handler for Discord Game selections
     */
    async autocomplete(interaction) {
        try {
            const focusedOption = interaction.options.getFocused(true);
            const subcommand = interaction.options.getSubcommand();
            const query = (focusedOption.value || '').toLowerCase().trim();

            if (focusedOption.name === 'game') {
                if (subcommand === 'remove') {
                    // Autocomplete currently mapped games
                    const settings = await settingsCache.get(interaction.guildId);
                    const rules = parseRules(settings?.activityVcRules);
                    const choices = rules.map(r => r.gameName);
                    const filtered = choices
                        .filter(name => name.toLowerCase().includes(query))
                        .slice(0, 25);
                    return await interaction.respond(
                        filtered.map(name => ({ name, value: name }))
                    );
                } else {
                    // Autocomplete from popular Discord game library + query
                    const filtered = POPULAR_DISCORD_GAMES
                        .filter(game => game.toLowerCase().includes(query))
                        .slice(0, 25);
                    
                    // If user typed a unique custom game not in list, offer it as first choice
                    const results = filtered.map(game => ({ name: game, value: game }));
                    if (query && !POPULAR_DISCORD_GAMES.some(g => g.toLowerCase() === query)) {
                        results.unshift({ name: `Custom: "${focusedOption.value}"`, value: focusedOption.value });
                    }

                    return await interaction.respond(results.slice(0, 25));
                }
            }
        } catch (e) {
            console.error('[Activities Autocomplete Error]:', e.message);
        }
    },

    async execute(interaction, guildSettings) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const [settings] = await GuildSettings.findOrCreate({ where: { guildId } });

        const rules = parseRules(settings.activityVcRules);

        if (subcommand === 'list') {
            const isEnabled = !!settings.activityVcLockEnabled;
            const notifyUser = settings.activityVcNotifyUser !== false;

            const embed = new EmbedBuilder()
                .setTitle('🎮 Current User Activities — Game Voice Locks')
                .setDescription('Automatically detects Discord Game Presence and moves playing members to their designated game voice channels in real time.')
                .addFields(
                    { 
                        name: 'System Status', 
                        value: isEnabled ? '🟢 **Active & Enabled**' : '🔴 **Disabled** (Use `/activities toggle enabled:True` to activate)', 
                        inline: true 
                    },
                    { 
                        name: 'DM Notifications', 
                        value: notifyUser ? '🔔 **Enabled**' : '🔕 **Disabled**', 
                        inline: true 
                    },
                    { 
                        name: 'Total Mappings', 
                        value: `\`${rules.length}\` game rules configured`, 
                        inline: true 
                    }
                )
                .setColor(isEnabled ? 0x22c55e : 0x64748b)
                .setFooter({ text: 'Current User Activities VC Lock • Nora' })
                .setTimestamp();

            if (rules.length === 0) {
                embed.addFields({
                    name: 'Configured Rules',
                    value: '*No game locks configured yet. Use `/activities add game:<game> channel:<vc>` to link your first game!*'
                });
            } else {
                const rulesList = rules.map((r, i) => {
                    const channel = interaction.guild.channels.cache.get(r.channelId);
                    const chName = channel ? `<#${r.channelId}>` : `*(Deleted Channel: ${r.channelId})*`;
                    return `**${i + 1}.** 🎯 **${r.gameName}** ➔ ${chName}`;
                }).join('\n');

                embed.addFields({
                    name: 'Active Game Voice Locks',
                    value: rulesList.length > 1024 ? rulesList.substring(0, 1020) + '...' : rulesList
                });
            }

            return await interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'toggle') {
            const enabled = interaction.options.getBoolean('enabled', true);
            await settings.update({ activityVcLockEnabled: enabled });
            settingsCache.invalidate(guildId);

            const embed = new EmbedBuilder()
                .setTitle(enabled ? '🟢 Current User Activities Activated' : '🔴 Current User Activities Disabled')
                .setDescription(
                    enabled 
                        ? 'Nora is now actively monitoring user game presence and routing playing members to their designated game channels!'
                        : 'Current User Activities voice routing has been paused.'
                )
                .setColor(enabled ? 0x22c55e : 0xef4444)
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'notify') {
            const notify = interaction.options.getBoolean('enabled', true);
            await settings.update({ activityVcNotifyUser: notify });
            settingsCache.invalidate(guildId);

            const embed = new EmbedBuilder()
                .setTitle('🔔 Notification Preference Updated')
                .setDescription(
                    notify
                        ? 'Members will receive a polite DM notification when automatically routed to a game channel.'
                        : 'Members will be silently moved without receiving DM notifications.'
                )
                .setColor(0x5865F2)
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'add') {
            const gameInput = interaction.options.getString('game', true).trim();
            const channel = interaction.options.getChannel('channel', true);

            // Cap at 25 rules per server
            if (rules.length >= 25 && !rules.some(r => r.gameName.toLowerCase() === gameInput.toLowerCase())) {
                return await interaction.reply({
                    content: '❌ **Rule Limit Reached**: You can configure up to 25 game voice channel locks per server.',
                    ephemeral: true
                });
            }

            // Check if Nora has Move Members permission
            const botMember = interaction.guild.members.me;
            if (!botMember.permissions.has(PermissionFlagsBits.MoveMembers)) {
                return await interaction.reply({
                    content: '⚠️ **Missing Permission**: Nora requires the **Move Members** permission in this server to automatically route voice members.',
                    ephemeral: true
                });
            }

            // Remove existing mapping for this game if it exists
            const existingIndex = rules.findIndex(r => r.gameName.toLowerCase() === gameInput.toLowerCase());
            const newRule = {
                id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                gameName: gameInput,
                channelId: channel.id
            };

            if (existingIndex >= 0) {
                rules[existingIndex] = newRule;
            } else {
                rules.push(newRule);
            }

            await settings.update({
                activityVcRules: JSON.stringify(rules),
                // If it was disabled, automatically enable it when adding the first rule
                activityVcLockEnabled: true
            });
            settingsCache.invalidate(guildId);

            const embed = new EmbedBuilder()
                .setTitle('🎯 Game Voice Lock Configured')
                .setDescription(`Successfully locked **${gameInput}** to <#${channel.id}>!`)
                .addFields(
                    { name: 'Target Game', value: `🎮 \`${gameInput}\``, inline: true },
                    { name: 'Voice Channel', value: `<#${channel.id}>`, inline: true },
                    { name: 'System Status', value: '🟢 **Active**', inline: true }
                )
                .setColor(0x22c55e)
                .setFooter({ text: 'Current User Activities VC Lock • Nora' })
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'remove') {
            const gameInput = interaction.options.getString('game', true).trim();
            const initialLength = rules.length;
            const updatedRules = rules.filter(r => r.gameName.toLowerCase() !== gameInput.toLowerCase());

            if (updatedRules.length === initialLength) {
                return await interaction.reply({
                    content: `⚠️ No active voice channel lock was found for **${gameInput}**. Use \`/activities list\` to view active mappings.`,
                    ephemeral: true
                });
            }

            await settings.update({ activityVcRules: JSON.stringify(updatedRules) });
            settingsCache.invalidate(guildId);

            const embed = new EmbedBuilder()
                .setTitle('🗑️ Game Voice Lock Removed')
                .setDescription(`Successfully removed the voice channel lock for **${gameInput}**.`)
                .setColor(0xef4444)
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });
        }
    }
};
