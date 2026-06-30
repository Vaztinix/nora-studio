const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const UserLevel = require('../../database/models/UserLevel');
const { handleError, handleSuccess } = require('../../utils/embeds');

module.exports = {
    category: 'moderation',
    data: new SlashCommandBuilder()
        .setName('setlevel')
        .setDescription('Force-update a user\'s current level and progress.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user you want to modify')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('The level you are setting them to')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)),

    async execute(interaction) {
        const target = interaction.options.getUser('target');
        const newLevel = interaction.options.getInteger('level');

        // Check if the target is a bot
        if (target.bot) {
            return handleError(interaction, 'System Error', 'Bots are not eligible for the leveling system.');
        }

        try {
            const { getTotalXPForLevel } = require('../../utils/noraLeveling');
            const newTotalXp = getTotalXPForLevel(newLevel);

            // Fetch User Record
            let userLevel = await UserLevel.findOne({
                where: { userId: target.id, guildId: interaction.guildId }
            });

            if (!userLevel) {
                // If they don't have a record yet, create one
                userLevel = await UserLevel.create({
                    userId: target.id,
                    guildId: interaction.guildId,
                    xp: newTotalXp,
                    level: newLevel,
                    totalXp: newTotalXp 
                });
            } else {
                // Overwrite both existing fields with the cumulative lifetime minimum
                userLevel.level = newLevel;
                userLevel.xp = newTotalXp; 
                userLevel.totalXp = newTotalXp;
                await userLevel.save();
            }

            return handleSuccess(interaction, 'Level Synchronized', `Successfully adjusted **${target.tag}** to **Level ${newLevel}**.`);
        } catch (error) {
            console.error('[System Commands Error]: Level Override Failure:', error.message);
            if (error.code === 50013) {
                return handleError(interaction, 'Missing Permissions (50013)', 'Nora lacks permissions to perform this action or modify this user.');
            }
            return handleError(interaction, 'Database Error', 'An internal error occurred while trying to push the new level to the database.');
        }
    }
};
