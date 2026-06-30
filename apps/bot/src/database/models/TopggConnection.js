const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const TopggConnection = sequelize.define('TopggConnection', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    targetId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false, // "bot" or "server"
        defaultValue: 'bot'
    },
    token: {
        type: DataTypes.STRING,
        allowNull: true // The Top.gg webhook secret/auth token for validation
    },
    verified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    ownerId: {
        type: DataTypes.STRING, // User ID who linked it
        allowNull: true
    }
});

module.exports = TopggConnection;
