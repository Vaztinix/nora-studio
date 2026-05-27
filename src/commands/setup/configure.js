const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType, ChannelType } = require('discord.js');
const GuildSettings = require('../../database/models/GuildSettings');
const { handleError } = require('../../utils/embeds');
const { syncAutoModRule, syncAllAutoModRules } = require('../../utils/automodSync');

module.exports = {
    category: 'setup',
    data: new SlashCommandBuilder()
        .setName('configure')
        .setDescription('Open the settings menu dashboard for managing Nora.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    async execute(interaction, externalSettings) {
        let settings = externalSettings;
        if (!settings && interaction.guildId) {
            try {
                const [result] = await GuildSettings.findOrCreate({ where: { guildId: interaction.guildId } });
                settings = result;
            } catch (e) {
                settings = await GuildSettings.findOne({ where: { guildId: interaction.guildId } });
            }
        }

        const APP_OWNER_IDS = [process.env.APP_OWNER_ID || '1214048435632603137', '1366229304257544213'];

        let state = {
            rewardLevel: null,
            verifyChannel: null,
            verifyRole: null,
            ticketCh: null,
            currentView: 'main'
        };

        const getRoleColor = (interaction) => {
            if (!interaction.guild) return 0x57acf2;
            const color = interaction.guild.members.me.roles.highest.color;
            return color === 0 ? 0x57acf2 : color;
        };

        const buildDashboard = (viewName) => {
            const embed = new EmbedBuilder()
                .setColor(getRoleColor(interaction))
                .setTimestamp()
                .setFooter({ text: `Nora Settings • ${interaction.guild.name}` });

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('go_back').setLabel('Back to Menu').setStyle(ButtonStyle.Secondary)
            );

            // --- MAIN ---
            if (viewName === 'main') {
                embed.setTitle('Nora Settings')
                     .setDescription('Configure how Nora works in your server. Most features are automated for simplicity.');
                const menu = new StringSelectMenuBuilder().setCustomId('config_main').setPlaceholder('Choose a category...').addOptions([
                    { label: 'Safety & Anti-Raid', value: 'view_antiraid', description: 'Stop bot raids and new accounts.' },
                    { label: 'Chat Safety (AutoMod)', value: 'view_automod', description: 'Filter bad words and scam links automatically.' },
                    { label: 'Spam Control', value: 'view_antispam', description: 'Prevent users from flooding chat.' },
                    { label: 'Member Logs', value: 'view_logging', description: 'Keep track of joins, leaves, and edits.' },
                    { label: 'Leveling & XP', value: 'view_levels', description: 'Reward active chatters with ranks.' },
                    { label: 'Strikes & Bans', value: 'view_warnings', description: 'Manage how users are punished for bad behavior.' },
                    { label: 'Support Tickets', value: 'view_ticketing', description: 'Help members with a private ticket system.' },
                    { label: 'Join Verification', value: 'view_verify', description: 'Verify new members before they join.' },
                    { label: 'Self Roles', value: 'view_selfroles', description: 'Create interactive role panels.' },
                    { label: 'Fun & Games', value: 'view_extras', description: 'Welcomer, Counting game, and more.' },
                    { label: 'AI Settings', value: 'view_ai', description: 'Change Nora\'s AI engine and personality.' }
                ]);
                if (APP_OWNER_IDS.includes(interaction.user.id)) {
                    menu.addOptions([
                        { label: 'Dev Settings', value: 'view_dev', description: 'Reboot and sync database.' },
                        { label: 'Premium Settings', value: 'view_premium', description: 'Configure override premium status for users and guilds.' }
                    ]);
                }
                return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
            }

            // --- SAFETY & RAID ---
            if (viewName === 'view_antiraid') {
                embed.setTitle('Safety & Anti-Raid')
                     .setDescription('Settings to prevent your server from being raided by bots.')
                     .addFields(
                        { name: 'Anti-Raid', value: settings.antiRaidEnabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Lockdown', value: settings.lockdownMode ? 'Active' : 'Off', inline: true },
                        { name: 'Photo Check', value: settings.requirePFP ? 'Required' : 'Optional', inline: true },
                        { name: 'Age Gate', value: settings.minAccountAge > 0 ? `${settings.minAccountAge} days` : 'Off', inline: true },
                        { name: 'Nick Filter', value: settings.nicknameRaidFilter ? 'Active' : 'Off', inline: true },
                        { name: 'Action', value: settings.antiRaidAction, inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_antiraid_toggle').setLabel(settings.antiRaidEnabled ? 'Disable Anti-Raid' : 'Enable Anti-Raid').setStyle(settings.antiRaidEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('action_lockdown_toggle').setLabel(settings.lockdownMode ? 'End Lockdown' : 'Start Lockdown').setStyle(settings.lockdownMode ? ButtonStyle.Success : ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('action_pfp_toggle').setLabel('Toggle Photo Req').setStyle(settings.requirePFP ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_nickfilter_toggle').setLabel('Toggle Nick Filter').setStyle(settings.nicknameRaidFilter ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
                const rowB = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_antiraid_threshold').setPlaceholder('Sensitivity...').addOptions([{label:'Strict',value:'3'},{label:'Normal',value:'5'},{label:'Relaxed',value:'10'}]));
                const rowC = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_accountage_minage').setPlaceholder('Minimum Account Age...').addOptions([{label:'Disabled',value:'0'},{label:'1 Day',value:'1'},{label:'7 Days',value:'7'},{label:'30 Days',value:'30'}]));
                const rowD = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_antiraid_action').setPlaceholder('Action taken on raid detect...').addOptions([{label:'Notify Only',value:'notify'},{label:'Lockdown',value:'lockdown'},{label:'Kick New Users',value:'kick_new'}]));
                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            // --- CHAT SAFETY ---
            if (viewName === 'view_automod') {
                embed.setTitle('Chat Safety (AutoMod)')
                     .setDescription('Discord will automatically block messages that break these rules.')
                     .addFields(
                        { name: 'Bad Language', value: settings.automodProfanity ? 'Blocked' : 'Allowed', inline: true },
                        { name: 'Spam Links', value: settings.automodScam ? 'Blocked' : 'Allowed', inline: true },
                        { name: 'Spam Text', value: settings.automodSpam ? 'Blocked' : 'Allowed', inline: true },
                        { name: 'Hardcore Media', value: settings.automodHardcore ? 'Blocked' : 'Allowed', inline: true },
                        { name: 'Mention Limit', value: settings.automodMentions > 0 ? `${settings.automodMentions} max` : 'Off', inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_automod_profanity').setLabel('Toggle Bad Words').setStyle(settings.automodProfanity ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_scam').setLabel('Toggle Scam').setStyle(settings.automodScam ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_spam').setLabel('Toggle Text Spam').setStyle(settings.automodSpam ? ButtonStyle.Success : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('action_automod_hardcore').setLabel('Toggle Hardcore').setStyle(settings.automodHardcore ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
                const rowB = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_automod_mentions').setPlaceholder('Block Mention Spam at...').addOptions([{label:'Off',value:'0'},{label:'5 Mentions',value:'5'},{label:'10 Mentions',value:'10'}]));
                const rowC = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('action_automod_immune').setPlaceholder('Select Bypass Roles...').setMinValues(0).setMaxValues(20));
                
                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // --- SPAM CONTROL ---
            if (viewName === 'view_antispam') {
                embed.setTitle('Spam Control')
                     .setDescription('Stops users from typing too many messages too quickly.')
                     .addFields(
                        { name: 'Status', value: settings.spamDetectionEnabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Sensitivity', value: `${settings.spamThreshold} msgs`, inline: true },
                        { name: 'Window', value: `${settings.spamInterval / 1000} secs`, inline: true },
                        { name: 'Mute', value: `${settings.antiSpamMuteDuration / 60000} mins`, inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('action_antispam_toggle').setLabel(settings.spamDetectionEnabled ? 'Disable' : 'Enable').setStyle(settings.spamDetectionEnabled ? ButtonStyle.Danger : ButtonStyle.Success));
                const rowB = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_antispam_threshold').setPlaceholder('How strict?').addOptions([{label:'Strict (3 msgs)',value:'3'},{label:'Normal (5 msgs)',value:'5'},{label:'Relaxed (8 msgs)',value:'8'}]));
                const rowC = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_antispam_interval').setPlaceholder('Time window...').addOptions([{label:'3 Seconds',value:'3000'},{label:'5 Seconds',value:'5000'},{label:'10 Seconds',value:'10000'}]));
                const rowD = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_antispam_mute').setPlaceholder('Mute duration...').addOptions([{label:'1 Minute',value:'60000'},{label:'5 Minutes',value:'300000'},{label:'1 Hour',value:'3600000'}]));
                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            // --- MEMBER LOGS ---
            if (viewName === 'view_logging') {
                embed.setTitle('Member Logs')
                     .setDescription(`Logs are sent to: ${settings.loggingChannelId ? `<#${settings.loggingChannelId}>` : 'None'}`)
                     .addFields(
                         { name: 'Joins/Leaves', value: settings.logMemberJoins ? 'On' : 'Off', inline: true },
                         { name: 'Message Edits', value: settings.logMessageEdits ? 'On' : 'Off', inline: true },
                         { name: 'AutoMod', value: settings.logAutomod ? 'On' : 'Off', inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_log_toggle').setPlaceholder('What should I log?').addOptions([
                    {label:'Join/Leave',value:'log_joins'},
                    {label:'Edits/Deletes',value:'log_messages'},
                    {label:'Safety Actions',value:'log_automod'}
                ]));
                const rowB = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_log_channel').setPlaceholder('Select Log Channel...').setChannelTypes(ChannelType.GuildText));
                return { embeds: [embed], components: [rowA, rowB, backRow] };
            }

            // --- LEVELING ---
            if (viewName === 'view_levels') {
                embed.setTitle('Leveling & XP')
                     .setDescription('Users gain XP by chatting and being active in voice.')
                     .addFields(
                        { name: 'Level Alerts', value: settings.levelUpNotificationsEnabled ? 'On' : 'Off', inline: true },
                        { name: 'Alert Channel', value: settings.levelUpChannelId ? `<#${settings.levelUpChannelId}>` : 'Current Channel', inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('action_leveling_toggle').setLabel(settings.levelingEnabled ? 'Disable XP' : 'Enable XP').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('action_levelalert_toggle').setLabel('Toggle Alerts').setStyle(ButtonStyle.Secondary)
                );
                const rowB = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_levelalert_channel').setPlaceholder('Select Level Up Channel...').setChannelTypes(ChannelType.GuildText));
                return { embeds: [embed], components: [rowA, rowB, backRow] };
            }

            // --- AI SETTINGS ---
            if (viewName === 'view_ai') {
                embed.setTitle('AI Engine')
                     .setDescription(`Active Engine: **${settings.aiPreference}**`);
                const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('action_ai_pref').setPlaceholder('Choose Nora\'s Brain...').addOptions([
                    {label:'Built-in Logic (Free)',value:'LOCAL'},
                    {label:'Gemini (Google)',value:'BUILT_IN'},
                    {label:'ChatGPT (OpenAI)',value:'OPENAI'}
                ]));
                return { embeds: [embed], components: [row, backRow] };
            }

            // --- DEV SETTINGS ---
            if (viewName === 'view_dev') {
                embed.setTitle('Developer Operations')
                     .setDescription('High-level administrative commands for the bot owner.')
                     .setColor(getRoleColor(interaction));
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('dev_reboot').setLabel('Force Reboot').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('dev_dbsync').setLabel('Sync Database').setStyle(ButtonStyle.Primary)
                );
                return { embeds: [embed], components: [row, backRow] };
            }

            // --- PREMIUM SETTINGS ---
            if (viewName === 'view_premium') {
                embed.setTitle('Premium Management (Owner Only)')
                     .setDescription('Configure manual/override premium status for users and guilds.')
                     .setColor(getRoleColor(interaction));
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('premium_enable_btn').setLabel('Enable Premium').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('premium_disable_btn').setLabel('Disable Premium').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('premium_remove_btn').setLabel('Remove Premium').setStyle(ButtonStyle.Secondary)
                );
                return { embeds: [embed], components: [row, backRow] };
            }


            // --- WARNINGS ---
            if (viewName === 'view_warnings') {
                embed.setTitle('Strikes & Bans')
                     .setDescription('Manage how users are punished for bad behavior.')
                     .addFields(
                        { name: 'Max Warnings', value: settings.warningThreshold > 0 ? `${settings.warningThreshold}` : 'Off', inline: true },
                        { name: 'Action', value: settings.warningAction, inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_warning_thresh').setPlaceholder('Number of warnings...').addOptions([
                        {label:'1 Warning',value:'1'},
                        {label:'3 Warnings',value:'3'},
                        {label:'5 Warnings',value:'5'},
                        {label:'10 Warnings',value:'10'}
                    ])
                );
                const rowB = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('action_warning_action').setPlaceholder('Action on max warnings...').addOptions([
                        {label:'None',value:'none'},
                        {label:'Kick',value:'kick'},
                        {label:'Ban',value:'ban'},
                        {label:'Timeout',value:'timeout'}
                    ])
                );
                return { embeds: [embed], components: [rowA, rowB, backRow] };
            }

            // --- TICKETING ---
            if (viewName === 'view_ticketing') {
                embed.setTitle('Support Tickets')
                     .setDescription(`Current Ticket Category: ${settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : 'None'}`);
                const row = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_ticket_category').setPlaceholder('Select Ticket Category...').setChannelTypes(ChannelType.GuildCategory));
                const rowB = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('action_ticket_spawn').setLabel('Spawn Ticket Panel Here').setStyle(ButtonStyle.Success));
                return { embeds: [embed], components: [row, rowB, backRow] };
            }

            // --- VERIFY ---
            if (viewName === 'view_verify') {
                const rolesDisplay = settings.verifyRoleId ? settings.verifyRoleId.split(',').map(id => `<@&${id}>`).join(' ') : 'None';
                embed.setTitle('Join Verification')
                     .setDescription('Require new members to verify themselves before accessing the server.')
                     .addFields(
                         { name: 'Verify Channel', value: settings.verifyChannelId ? `<#${settings.verifyChannelId}>` : 'Current Channel', inline: true },
                         { name: 'Verified Roles', value: rolesDisplay, inline: false }
                     );
                const rowA = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_verify_channel').setPlaceholder('Select Custom Verify Channel...').setChannelTypes(ChannelType.GuildText));
                const rowB = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('action_verify_role').setPlaceholder('Select Verified Role(s)...').setMinValues(1).setMaxValues(5));
                const rowC = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('action_verify_spawn').setLabel('Spawn Verify Panel').setStyle(ButtonStyle.Success));
                return { embeds: [embed], components: [rowA, rowB, rowC, backRow] };
            }

            // --- SELF ROLES ---
            if (viewName === 'view_selfroles') {
                embed.setTitle('Self Roles Panel Builder')
                     .setDescription('Drop an interactive panel in this channel for users to assign themselves roles.')
                     .addFields({ name: 'Instructions', value: 'Click the button below to open the Builder. You will need the IDs of the roles you want to offer.' });
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('action_selfroles_build').setLabel('Build Panel Here').setStyle(ButtonStyle.Success));
                return { embeds: [embed], components: [row, backRow] };
            }

            // --- EXTRAS ---
            if (viewName === 'view_extras') {
                embed.setTitle('Fun & Games')
                     .setDescription('Additional fun features for your server.')
                     .addFields(
                        { name: 'Welcomer', value: settings.welcomerEnabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Welcome Ch.', value: settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : 'None', inline: true },
                        { name: 'Counting Ch.', value: settings.countingChannelId ? `<#${settings.countingChannelId}>` : 'None', inline: true },
                        { name: 'Vote Log', value: settings.voteLogChannelId ? `<#${settings.voteLogChannelId}>` : 'None', inline: true }
                     );
                const rowA = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('action_welcomer_toggle').setLabel(settings.welcomerEnabled ? 'Disable Welcomer' : 'Enable Welcomer').setStyle(settings.welcomerEnabled ? ButtonStyle.Danger : ButtonStyle.Success));
                const rowB = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_welcome_channel').setPlaceholder('Select Welcome Channel...').setChannelTypes(ChannelType.GuildText));
                const rowC = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_counting_channel').setPlaceholder('Select Counting Channel...').setChannelTypes(ChannelType.GuildText));
                const rowD = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('action_votelog_channel').setPlaceholder('Select Vote Log Channel...').setChannelTypes(ChannelType.GuildText));
                return { embeds: [embed], components: [rowA, rowB, rowC, rowD, backRow] };
            }

            embed.setTitle('Under Construction').setDescription('This menu is currently being built. Check back soon!');
            return { embeds: [embed], components: [backRow] };
        };

        const initialView = buildDashboard('main');
        let response;
        if (interaction.deferred || interaction.replied) {
            response = await interaction.editReply({ ...initialView, ephemeral: true });
        } else {
            response = await interaction.reply({ ...initialView, ephemeral: true });
        }

        const collector = response.createMessageComponentCollector({ time: 600000 });

        collector.on('collect', async i => {
            try {
                if (i.user.id !== interaction.user.id) return i.reply({ content: 'Not your menu.', ephemeral: true });

                if (i.customId === 'config_main' || i.customId.startsWith('view_')) {
                    const view = i.customId.startsWith('view_') ? i.customId : i.values[0];
                    state.currentView = view;
                    return i.update(buildDashboard(view));
                }

                if (i.customId === 'go_back') {
                    state.currentView = 'main';
                    return i.update(buildDashboard('main'));
                }

                let update = false;
                let sync = null;

                // Anti-Raid
                if (i.customId === 'action_antiraid_toggle') { settings.antiRaidEnabled = !settings.antiRaidEnabled; update = true; }
                if (i.customId === 'action_lockdown_toggle') { settings.lockdownMode = !settings.lockdownMode; update = true; }
                if (i.customId === 'action_pfp_toggle') { settings.requirePFP = !settings.requirePFP; update = true; }
                if (i.customId === 'action_nickfilter_toggle') { settings.nicknameRaidFilter = !settings.nicknameRaidFilter; update = true; }
                if (i.customId === 'action_antiraid_threshold') { settings.antiRaidThreshold = parseInt(i.values[0]); update = true; }
                if (i.customId === 'action_accountage_minage') { settings.minAccountAge = parseInt(i.values[0]); update = true; }
                if (i.customId === 'action_antiraid_action') { settings.antiRaidAction = i.values[0]; update = true; }

                // AutoMod
                if (i.customId === 'action_automod_profanity') { 
                    settings.automodProfanity = !settings.automodProfanity; 
                    settings.automodSexual = settings.automodProfanity;
                    settings.automodSlurs = settings.automodProfanity;
                    update = true; sync = 'profanity'; 
                }
                if (i.customId === 'action_automod_scam') { settings.automodScam = !settings.automodScam; update = true; sync = 'scam'; }
                if (i.customId === 'action_automod_spam') { settings.automodSpam = !settings.automodSpam; update = true; sync = 'spam'; }
                if (i.customId === 'action_automod_hardcore') { settings.automodHardcore = !settings.automodHardcore; update = true; sync = 'hardcore'; }
                if (i.customId === 'action_automod_mentions') { settings.automodMentions = parseInt(i.values[0]); update = true; sync = 'mentions'; }
                if (i.customId === 'action_automod_immune') { settings.automodImmuneRoles = JSON.stringify(i.values); update = true; sync = 'all'; }

                // Anti-Spam
                if (i.customId === 'action_antispam_toggle') { settings.spamDetectionEnabled = !settings.spamDetectionEnabled; update = true; }
                if (i.customId === 'action_antispam_threshold') { settings.spamThreshold = parseInt(i.values[0]); update = true; }
                if (i.customId === 'action_antispam_interval') { settings.spamInterval = parseInt(i.values[0]); update = true; }
                if (i.customId === 'action_antispam_mute') { settings.antiSpamMuteDuration = parseInt(i.values[0]); update = true; }

                // Logging
                if (i.customId === 'action_log_channel') { settings.loggingChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_log_toggle') {
                    const sel = i.values[0];
                    if (sel === 'log_joins') { settings.logMemberJoins = !settings.logMemberJoins; settings.logMemberLeaves = settings.logMemberJoins; }
                    if (sel === 'log_messages') { settings.logMessageEdits = !settings.logMessageEdits; settings.logMessageDeletes = settings.logMessageEdits; }
                    if (sel === 'log_automod') settings.logAutomod = !settings.logAutomod;
                    update = true;
                }

                // Leveling
                if (i.customId === 'action_leveling_toggle') { settings.levelingEnabled = !settings.levelingEnabled; update = true; }
                if (i.customId === 'action_levelalert_toggle') { settings.levelUpNotificationsEnabled = !settings.levelUpNotificationsEnabled; update = true; }
                if (i.customId === 'action_levelalert_channel') { settings.levelUpChannelId = i.values[0]; update = true; }

                // Base Settings
                if (i.customId === 'action_ai_pref') { settings.aiPreference = i.values[0]; update = true; }
                if (i.customId === 'action_warning_thresh') { settings.warningThreshold = parseInt(i.values[0]); update = true; }
                if (i.customId === 'action_warning_action') { settings.warningAction = i.values[0]; update = true; }
                
                // Ticketing
                if (i.customId === 'action_ticket_category') { settings.ticketCategoryId = i.values[0]; update = true; }
                if (i.customId === 'action_ticket_spawn') {
                    if (!settings.ticketCategoryId) return i.reply({ content: '⚠️ You must select a Ticket Category above first!', ephemeral: true });
                    const pEmbed = new EmbedBuilder()
                        .setTitle('Support Center')
                        .setDescription('Need assistance? Please select the category that best matches your issue below to open a private channel with the Staff team.\n\n**Categories:**\n**Support:** General questions or assistance.\n**Reporting:** Report a user breaking the rules or a bug.\n**Appeals:** Request an appeal for an action taken against you.\n**Other:** Anything else.')
                        .setColor(getRoleColor(interaction))
                        .setFooter({ text: 'Support Ticketing System' });

                    const pRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket_Support').setLabel('Support').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('ticket_Reporting').setLabel('Reporting').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('ticket_Appeals').setLabel('Appeals').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('ticket_Other').setLabel('Other').setStyle(ButtonStyle.Secondary)
                    );
                    await i.channel.send({ embeds: [pEmbed], components: [pRow] });
                    return i.reply({ content: 'Ticketing panel spawned in this channel!', ephemeral: true });
                }
                
                // Verify
                if (i.customId === 'action_verify_channel') { settings.verifyChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_verify_role') { settings.verifyRoleId = i.values.join(','); update = true; }
                if (i.customId === 'action_verify_spawn') {
                    if (!settings.verifyRoleId) return i.reply({ content: '⚠️ You must set the Verified Roles above first!', ephemeral: true });
                    const targetChannelId = settings.verifyChannelId || i.channel.id;
                    const channel = i.guild.channels.cache.get(targetChannelId) || i.channel;
                    
                    const pEmbed = new EmbedBuilder()
                        .setTitle('Server Verification Required')
                        .setDescription('To gain full access to the server, please verify that you are human.\n\nClick the **Verify** button below and complete the CAPTCHA.')
                        .setColor(getRoleColor(interaction))
                        .setFooter({ text: 'Nora Security Systems' });
                    const pRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_system_button').setLabel('Verify').setStyle(ButtonStyle.Success));
                    
                    await channel.send({ embeds: [pEmbed], components: [pRow] });
                    return i.reply({ content: `Verification panel spawned in <#${channel.id}>!`, ephemeral: true });
                }

                // Self Roles
                if (i.customId === 'action_selfroles_build') {
                    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                    const modal = new ModalBuilder().setCustomId('modal_selfroles_build').setTitle('Self Roles Builder');
                    
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sr_title').setLabel('Panel Title').setStyle(TextInputStyle.Short).setRequired(true).setValue('Self Roles')),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sr_desc').setLabel('Panel Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('Click the buttons below to assign or remove roles from yourself.')),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sr_roles').setLabel('Role IDs (comma-separated, max 5)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('123456789, 987654321'))
                    );
                    await i.showModal(modal);

                    try {
                        const submitted = await i.awaitModalSubmit({ time: 300000, filter: x => x.user.id === interaction.user.id && x.customId === 'modal_selfroles_build' });
                        
                        const title = submitted.fields.getTextInputValue('sr_title');
                        const desc = submitted.fields.getTextInputValue('sr_desc');
                        const roleStrs = submitted.fields.getTextInputValue('sr_roles').split(',').map(r => r.trim()).filter(r => r.length > 5);

                        if (roleStrs.length > 5 || roleStrs.length === 0) {
                            return submitted.reply({ content: '⚠️ You must provide between 1 and 5 valid Role IDs.', ephemeral: true });
                        }

                        const panelEmbed = new EmbedBuilder()
                            .setTitle(title)
                            .setDescription(desc)
                            .setColor(getRoleColor(interaction));

                        const row = new ActionRowBuilder();
                        let loaded = 0;
                        for (const rId of roleStrs) {
                            const role = i.guild.roles.cache.get(rId);
                            if (role) {
                                row.addComponents(new ButtonBuilder().setCustomId(`selfrole_assign_${role.id}`).setLabel(role.name).setStyle(ButtonStyle.Secondary));
                                loaded++;
                            }
                        }

                        if (loaded === 0) {
                            return submitted.reply({ content: '⚠️ Could not find any of those Role IDs in this server.', ephemeral: true });
                        }

                        await i.channel.send({ embeds: [panelEmbed], components: [row] });
                        return submitted.reply({ content: 'Self-roles panel successfully spawned!', ephemeral: true });
                    } catch (e) {
                        return; // modal timeout or other error silently dies
                    }
                }

                // Extras
                if (i.customId === 'action_welcomer_toggle') { settings.welcomerEnabled = !settings.welcomerEnabled; update = true; }
                if (i.customId === 'action_welcome_channel') { settings.welcomeChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_counting_channel') { settings.countingChannelId = i.values[0]; update = true; }
                if (i.customId === 'action_votelog_channel') { settings.voteLogChannelId = i.values[0]; update = true; }

                // Premium Overrides Modal Dispatch
                if (i.customId === 'premium_enable_btn' || i.customId === 'premium_disable_btn' || i.customId === 'premium_remove_btn') {
                    if (!APP_OWNER_IDS.includes(i.user.id)) return i.reply({ content: '❌ This action is strictly restricted to Bot Owners.', ephemeral: true });

                    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                    
                    const action = i.customId.replace('_btn', ''); // premium_enable, premium_disable, premium_remove
                    const actionLabel = i.customId.includes('enable') ? 'ENABLE' : i.customId.includes('disable') ? 'DISABLE' : 'REMOVE';
                    
                    const modal = new ModalBuilder()
                        .setCustomId(`modal_premium_${action}`)
                        .setTitle(`${actionLabel} PREMIUM`);

                    const userInput = new TextInputBuilder()
                        .setCustomId('user_id')
                        .setLabel('Target Discord User ID')
                        .setPlaceholder('Enter User ID (Optional)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false);

                    const guildInput = new TextInputBuilder()
                        .setCustomId('guild_id')
                        .setLabel('Target Discord Guild ID')
                        .setPlaceholder('Enter Guild ID (Optional)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(userInput),
                        new ActionRowBuilder().addComponents(guildInput)
                    );

                    await i.showModal(modal);
                    return;
                }

                // Dev Handlers
                if (i.customId === 'dev_reboot') {
                    if (!APP_OWNER_IDS.includes(i.user.id)) return i.reply({ content: 'Unauthorized.', ephemeral: true });
                    await i.update({ content: 'Rebooting application core...', embeds: [], components: [] });
                    process.exit(1); 
                }
                if (i.customId === 'dev_dbsync') {
                    if (!APP_OWNER_IDS.includes(i.user.id)) return i.reply({ content: 'Unauthorized.', ephemeral: true });
                    const sequelize = require('../../database/db');
                    await sequelize.sync({ alter: true }).catch(()=>{});
                    return i.reply({ content: 'Database correctly synchronized.', ephemeral: true });
                }

                if (update) {
                    await settings.save();
                    if (sync) {
                        if (sync === 'all') await syncAllAutoModRules(i.guild, settings);
                        else await syncAutoModRule(i.guild, sync, true, settings.automodMentions, settings);
                    }
                    return i.update(buildDashboard(state.currentView));
                }

            } catch (err) {
                console.error(err);
                if (!i.replied && !i.deferred) i.reply({ content: 'Save failed.', ephemeral: true }).catch(()=>{});
            }
        });
    },
};
