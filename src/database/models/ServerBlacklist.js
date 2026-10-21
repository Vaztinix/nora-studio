const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const ServerBlacklist = sequelize.define('ServerBlacklist', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    guildName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ownerId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    reason: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: 'Administrative server revocation & permanent blacklist'
    },
    revokedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    revokedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
});

module.exports = ServerBlacklist;
