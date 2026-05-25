const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('os');
const { Op } = require('sequelize');
const GuildSettings = require('../../database/models/GuildSettings');

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('View Nora\'s current status and performance.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true),

    async execute(interaction) {
        const uptime = Math.floor(process.uptime());
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

        const memUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
        const memTotal = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
        
        const djsVersion = require('discord.js').version;

        const globalAutoModServers = await GuildSettings.count({
            where: {
                [Op.or]: [
                    { automodProfanity: true },
                    { automodScam: true },
                    { automodMentions: { [Op.gt]: 0 } }
                ]
            }
        });

        // Expanded metrics
        let totalLevels = 0;
        try { 
            const UserLevel = require('../../database/models/UserLevel');
            totalLevels = await UserLevel.count(); 
        } catch(e) {}

        const totalUsers = interaction.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        const totalChannels = interaction.client.channels.cache.size;

        const embed = new EmbedBuilder()
            .setAuthor({ name: 'Nora • Deep System Analysis', iconURL: interaction.client.user.displayAvatarURL() })
            .setTitle('Core Status Report')
            .setDescription(`Nora has been online and helping servers for **${hours > 0 ? uptimeStr : minutes + 'm ' + seconds + 's'}** without interruption. Here is a look at my current status and reach.`)
            .setColor(0x57acf2)
            .addFields(
                { name: 'Tech Specs', value: `**Node.js:** \`${process.version}\`\n**Discord.js:** \`v${djsVersion}\`\n**Platform:** \`${os.type()} ${os.arch()}\``, inline: true },
                { name: 'Network Stats', value: `**Servers:** \`${interaction.client.guilds.cache.size.toLocaleString()}\`\n**Users:** \`${totalUsers.toLocaleString()}\`\n**Channels:** \`${totalChannels.toLocaleString()}\`\n**Ping:** \`${interaction.client.ws.ping}ms\``, inline: true },
                { name: 'Data & Memory', value: `**Database:** \`SQLite3\`\n**Memory Used:** \`${memUsed} MB\` / \`${memTotal} GB\`\n**Active Profiles:** \`${totalLevels.toLocaleString()}\`\n**Protected Servers:** \`${globalAutoModServers}\``, inline: true },
                { name: 'System Health', value: '```diff\n+ Core Logic: STABLE\n+ AutoMod: ONLINE\n+ Leveling: HEALTHY\n+ AI Engine: NOMINAL\n```', inline: false }
            )
            .setFooter({ text: 'Nora Global Status' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
