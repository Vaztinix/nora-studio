const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const StarboardEntry = sequelize.define('StarboardEntry', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    channelId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    messageId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    starboardMessageId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    authorId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    authorTag: {
        type: DataTypes.STRING,
        allowNull: true
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    starCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    starsGivenBy: {
        type: DataTypes.TEXT,
        defaultValue: '[]'
    },
    attachmentUrl: {
        type: DataTypes.STRING,
        allowNull: true
    },
    jumpUrl: {
        type: DataTypes.STRING,
        allowNull: true
    },
    tierEmoji: {
        type: DataTypes.STRING,
        defaultValue: '⭐'
    }
}, {
    indexes: [
        { fields: ['guildId'] },
        { fields: ['messageId'] },
        { fields: ['authorId'] }
    ]
});

module.exports = StarboardEntry;
