const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const GuildSettingsBackup = sequelize.define('GuildSettingsBackup', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    snapshot: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    changedKeys: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: '[]'
    },
    triggerSource: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'AUTO_SNAPSHOT'
    },
    actorId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    actorName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    note: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    timestamps: true,
    indexes: [
        { fields: ['guildId'] },
        { fields: ['createdAt'] }
    ]
});

module.exports = GuildSettingsBackup;
