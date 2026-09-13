const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const GuildActivityDaily = sequelize.define('GuildActivityDaily', {
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    date: {
        type: DataTypes.STRING, // Format: YYYY-MM-DD (UTC)
        allowNull: false
    },
    messageCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    joinsCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    leavesCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    channelsData: {
        type: DataTypes.TEXT, // JSON map { channelId: messageCount }
        defaultValue: '{}'
    },
    activeUsersData: {
        type: DataTypes.TEXT, // JSON array of active user IDs on this day
        defaultValue: '[]'
    },
    hourlyActivity: {
        type: DataTypes.TEXT, // JSON array of 24 UTC hour counts [0..23]
        defaultValue: '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['guildId', 'date']
        },
        {
            fields: ['guildId']
        },
        {
            fields: ['date']
        }
    ]
});

module.exports = GuildActivityDaily;
