const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const rokuController = require('../../utils/rokuController');

const AUTHORIZED_USER_ID = '1214048435632603137';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roku')
        .setDescription('Control your connected Roku Smart TV (Developer Exclusive)')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action to perform on the Roku TV')
                .setRequired(true)
                .addChoices(
                    { name: '⚡ Power On', value: 'POWER_ON' },
                    { name: '🌙 Power Off', value: 'POWER_OFF' },
                    { name: '🔘 Toggle Power', value: 'POWER_TOGGLE' },
                    { name: '🔄 Restart TV', value: 'RESTART' },
                    { name: '✍️ Write Message on Screen', value: 'WRITE_MESSAGE' },
                    { name: '⏯️ Play / Pause', value: 'PLAY' },
                    { name: '🏠 Home Screen', value: 'HOME' },
                    { name: '🔊 Volume Up (+3)', value: 'VOLUME_UP' },
                    { name: '🔉 Volume Down (-3)', value: 'VOLUME_DOWN' },
                    { name: '🔇 Mute / Unmute', value: 'MUTE' },
                    { name: '📺 Device Status', value: 'STATUS' },
                    { name: '🔍 Discover on Local Network', value: 'DISCOVER' },
                    { name: '📋 TV Help Guide', value: 'TV_HELP' },
                    { name: '👥 View Access List', value: 'ACCESS_LIST' },
                    { name: '🎟️ Grant Guest Access (Owner Only)', value: 'GRANT_ACCESS' },
                    { name: '➕ Grant Specific Permission (Owner Only)', value: 'GRANT_PERMISSION' },
                    { name: '✂️ Revoke Tries (Owner Only)', value: 'REVOKE_TRIES' },
                    { name: '🚫 Revoke Specific Permission (Owner Only)', value: 'REVOKE_PERMISSION' },
                    { name: '🔒 Revoke All Guest Access (Owner Only)', value: 'REVOKE_ACCESS' }
                )
        )
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Message to write or display on the Roku TV screen')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('app')
                .setDescription('Launch a specific app (YouTube, Netflix, Spotify, Hulu, Crunchyroll, etc.)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('ip')
                .setDescription('Set or update the Roku TV IP address (e.g. 192.168.1.150)')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Volume change amount or target level (1-100)')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(false)
        )
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Target user for guest access / permissions (Owner only)')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('tries')
                .setDescription('Number of tries to grant or revoke (Default: 1)')
                .setMinValue(1)
                .setMaxValue(1000000)
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('permissions')
                .setDescription('Command scopes: power, volume, playback, apps, nav, full')
                .setRequired(false)
                .addChoices(
                    { name: '⚡ Power Only (On/Off/Restart)', value: 'power' },
                    { name: '🔊 Volume & Audio (Volume & Mute)', value: 'volume' },
                    { name: '⏯️ Playback (Play/Pause/Rewind/Fast-Forward)', value: 'playback' },
                    { name: '📱 Apps (YouTube, Netflix, Crunchyroll, etc.)', value: 'apps' },
                    { name: '🎮 Remote Navigation (Home, Back, OK, D-Pad)', value: 'nav' },
                    { name: '🔌 HDMI & Inputs', value: 'inputs' },
                    { name: '⚡🔊 Power + Volume', value: 'power volume' },
                    { name: '⚡⏯️ Power + Playback', value: 'power playback' },
                    { name: '🌟 Full Access (All Commands)', value: 'full' }
                )
        ),

    async execute(interaction) {
        const WHITELISTED_GUILD_IDS = ['1487342521133830174', '1515800329889779954'];
        if (interaction.guild && !WHITELISTED_GUILD_IDS.includes(interaction.guild.id)) {
            return interaction.reply({
                content: '🔒 **Server Restricted**: Roku Smart TV integration is only available to be run in authorized headquarters servers (`1487342521133830174`, `1515800329889779954`).',
                ephemeral: true
            });
        }

        const action = interaction.options.getString('action');

        // TV Help Guide is accessible to everyone in authorized servers
        if (action === 'TV_HELP') {
            await interaction.deferReply({ ephemeral: true });
            const res = await rokuController.executeRokuCommand(interaction.user, { action: 'TV_HELP' });
            return interaction.editReply({ content: rokuController.sanitizeMessage(res.message) });
        }

        // Strict developer authorization & guest pass gate for other actions
        if (!rokuController.isAuthorized(interaction.user.id)) {
            return interaction.reply({
                content: `🔒 **Access Denied**: Roku Smart TV hardware integration is strictly restricted to <@${AUTHORIZED_USER_ID}> (or users granted guest access).`,
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const app = interaction.options.getString('app');
        const ip = interaction.options.getString('ip');
        const amount = interaction.options.getInteger('amount');
        const targetUser = interaction.options.getUser('user');
        const tries = interaction.options.getInteger('tries');
        const permissions = interaction.options.getString('permissions');

        // Handle Grant Guest Access
        if (action === 'GRANT_ACCESS') {
            if (interaction.user.id !== AUTHORIZED_USER_ID) {
                return interaction.editReply({
                    content: `🔒 **Access Denied**: Only developer <@${AUTHORIZED_USER_ID}> can grant Roku guest access.`
                });
            }
            if (!targetUser) {
                return interaction.editReply({
                    content: `⚠️ Please specify a user using the \`user\` option to grant guest access!`
                });
            }
            const allowedActions = permissions ? rokuController.resolveAllowedActions(permissions) : ['POWER_ON', 'POWER_OFF', 'POWER_TOGGLE'];
            const res = await rokuController.executeRokuCommand(interaction.user, {
                action: 'GRANT_ACCESS',
                targetId: targetUser.id,
                tries: tries || 1,
                allowedActions
            });
            return interaction.editReply({ content: rokuController.sanitizeMessage(res.message) });
        }

        // Handle Grant Specific Permission
        if (action === 'GRANT_PERMISSION') {
            if (interaction.user.id !== AUTHORIZED_USER_ID) {
                return interaction.editReply({
                    content: `🔒 **Access Denied**: Only developer <@${AUTHORIZED_USER_ID}> can manage permissions.`
                });
            }
            if (!targetUser) {
                return interaction.editReply({
                    content: `⚠️ Please specify a user using the \`user\` option!`
                });
            }
            const res = await rokuController.executeRokuCommand(interaction.user, {
                action: 'GRANT_PERMISSION',
                targetId: targetUser.id,
                permissionScope: permissions || 'power',
                tries: tries || 0
            });
            return interaction.editReply({ content: rokuController.sanitizeMessage(res.message) });
        }

        // Handle Revoke Tries
        if (action === 'REVOKE_TRIES') {
            if (interaction.user.id !== AUTHORIZED_USER_ID) {
                return interaction.editReply({
                    content: `🔒 **Access Denied**: Only developer <@${AUTHORIZED_USER_ID}> can revoke guest tries.`
                });
            }
            if (!targetUser) {
                return interaction.editReply({
                    content: `⚠️ Please specify a user using the \`user\` option to revoke tries from!`
                });
            }
            const res = await rokuController.executeRokuCommand(interaction.user, {
                action: 'REVOKE_TRIES',
                targetId: targetUser.id,
                count: tries || 1
            });
            return interaction.editReply({ content: rokuController.sanitizeMessage(res.message) });
        }

        // Handle Revoke Specific Permission
        if (action === 'REVOKE_PERMISSION') {
            if (interaction.user.id !== AUTHORIZED_USER_ID) {
                return interaction.editReply({
                    content: `🔒 **Access Denied**: Only developer <@${AUTHORIZED_USER_ID}> can revoke permissions.`
                });
            }
            if (!targetUser) {
                return interaction.editReply({
                    content: `⚠️ Please specify a user using the \`user\` option!`
                });
            }
            const res = await rokuController.executeRokuCommand(interaction.user, {
                action: 'REVOKE_PERMISSION',
                targetId: targetUser.id,
                permissionScope: permissions || 'volume'
            });
            return interaction.editReply({ content: rokuController.sanitizeMessage(res.message) });
        }

        // Handle Revoke All Guest Access
        if (action === 'REVOKE_ACCESS') {
            if (interaction.user.id !== AUTHORIZED_USER_ID) {
                return interaction.editReply({
                    content: `🔒 **Access Denied**: Only developer <@${AUTHORIZED_USER_ID}> can revoke access.`
                });
            }
            if (!targetUser) {
                return interaction.editReply({
                    content: `⚠️ Please specify a user using the \`user\` option to revoke access from!`
                });
            }
            const res = await rokuController.executeRokuCommand(interaction.user, {
                action: 'REVOKE_ACCESS',
                targetId: targetUser.id
            });
            return interaction.editReply({ content: rokuController.sanitizeMessage(res.message) });
        }

        // Handle IP update
        if (ip) {
            const res = await rokuController.executeRokuCommand(interaction.user, { action: 'SET_IP', ip });
            return interaction.editReply({ content: rokuController.sanitizeMessage(res.message) });
        }

        // Handle App launch
        if (app) {
            const res = await rokuController.executeRokuCommand(interaction.user, { action: 'LAUNCH_APP', appName: app });
            return interaction.editReply({ content: rokuController.sanitizeMessage(res.message) });
        }

        const screenMsg = interaction.options.getString('message');

        // Handle Volume amount
        let intent = { action };
        if (action === 'VOLUME_UP' || action === 'VOLUME_DOWN') {
            intent.amount = amount || 3;
        } else if (action === 'WRITE_MESSAGE') {
            intent.messageText = screenMsg || 'Hello from Nora!';
        }

        const res = await rokuController.executeRokuCommand(interaction.user, intent);
        return interaction.editReply({ content: rokuController.sanitizeMessage(res.message) });
    }
};
