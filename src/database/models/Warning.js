const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Warning = sequelize.define('Warning', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    moderatorId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    reason: {
        type: DataTypes.STRING,
        defaultValue: 'No reason provided'
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
});

module.exports = Warning;
