const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const OneTimeEvent = sequelize.define('OneTimeEvent', {
    eventId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    completed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

module.exports = OneTimeEvent;
