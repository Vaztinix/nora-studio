const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Notification = sequelize.define('Notification', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    type: {
        type: DataTypes.STRING,
        defaultValue: 'info' // info, success, warning, error, special
    },
    read: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isSpecial: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isOwnerAction: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    serverName: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

module.exports = Notification;
