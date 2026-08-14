const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Reminder = sequelize.define('Reminder', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    triggerTime: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    isTriggered: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

module.exports = Reminder;
