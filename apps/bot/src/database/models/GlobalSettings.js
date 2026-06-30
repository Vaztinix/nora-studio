const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const GlobalSettings = sequelize.define('GlobalSettings', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        defaultValue: 1
    },
    disabledCommands: {
        type: DataTypes.STRING,
        defaultValue: '[]' // JSON string of disabled command names
    },
    disabledFeatures: {
        type: DataTypes.STRING,
        defaultValue: '[]' // JSON string of disabled categories (e.g. 'leveling', 'fun')
    },
    bannedGuildIds: {
        type: DataTypes.TEXT,
        defaultValue: '[]' // JSON string of IDs Nora must NEVER join (Permanent Exile)
    },
    lastHeartbeat: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
});

module.exports = GlobalSettings;
