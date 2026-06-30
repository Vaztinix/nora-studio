const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const MemberRolesHistory = sequelize.define('MemberRolesHistory', {
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
    roles: {
        type: DataTypes.TEXT, // Stored as a JSON string array of role IDs
        allowNull: false,
        defaultValue: '[]'
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['userId', 'guildId']
        }
    ]
});

module.exports = MemberRolesHistory;
