const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const AfkUser = sequelize.define('AfkUser', {
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
    status: {
        type: DataTypes.TEXT,
        defaultValue: 'AFK'
    },
    timestamp: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    originalNickname: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    autoNicknameChanged: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['guildId', 'userId']
        }
    ]
});

module.exports = AfkUser;
