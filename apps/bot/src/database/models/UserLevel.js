const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const UserLevel = sequelize.define('UserLevel', {
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    xp: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    level: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    totalXp: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    dailyXp: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    weeklyXp: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    lastMessageTimestamp: {
        type: DataTypes.DATE,
        allowNull: true
    },
    isPremium: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isManualPremium: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    voteCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    lastVoteTimestamp: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['userId', 'guildId']
        }
    ]
});

module.exports = UserLevel;
