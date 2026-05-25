const { DataTypes } = require('sequelize');
const sequelize = require('../db');

/**
 * Giveaway Model
 * Tracks all active and completed giveaways to ensure Nora can recover 
 * sessions after a bot restart or crash.
 */
const Giveaway = sequelize.define('Giveaway', {
    messageId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    channelId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    hostId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    winnerCount: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    endTime: {
        type: DataTypes.DATE,
        allowNull: false
    },
    requiredRoleId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ended: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

module.exports = Giveaway;
