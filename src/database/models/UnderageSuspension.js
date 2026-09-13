const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const UnderageSuspension = sequelize.define('UnderageSuspension', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '1487342521133830174'
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    userTag: {
        type: DataTypes.STRING,
        allowNull: true
    },
    kickedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    rejoinEligibleAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'suspended' // 'suspended' | 'lifted'
    },
    staffNote: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    liftedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    liftedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    inviteSent: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    inviteUrl: {
        type: DataTypes.STRING,
        allowNull: true
    },
    reason: {
        type: DataTypes.TEXT,
        defaultValue: 'Determined underage for Discord (Recommended minimum age: 13)'
    }
});

module.exports = UnderageSuspension;
