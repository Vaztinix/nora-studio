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
        type: DataTypes.TEXT,
        defaultValue: 'No reason provided'
    },
    severity: {
        type: DataTypes.STRING,
        defaultValue: 'medium',
        validate: {
            isIn: [['low', 'medium', 'high', 'critical']]
        }
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    editedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    editedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
});

module.exports = Warning;
