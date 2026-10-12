const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const VoteReminder = sequelize.define('VoteReminder', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    botId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    botName: {
        type: DataTypes.STRING,
        defaultValue: 'Nora'
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    votedAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    remindAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    isReminded: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    tableName: 'VoteReminders',
    timestamps: true
});

module.exports = VoteReminder;
