const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const ReactionRole = sequelize.define('ReactionRole', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    messageId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    emoji: {
        type: DataTypes.STRING,
        allowNull: false
    },
    roleId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    singleSelect: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

module.exports = ReactionRole;
