const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const ContentFeed = sequelize.define('ContentFeed', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    platform: {
        type: DataTypes.STRING,
        allowNull: false // YOUTUBE, TWITCH, TIKTOK
    },
    publicHandle: {
        type: DataTypes.STRING,
        allowNull: false
    },
    targetChannelId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    alertTemplate: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: 'Hey @everyone! {creator} is live! Link: {link}'
    }
});

module.exports = ContentFeed;
