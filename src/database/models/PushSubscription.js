const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const PushSubscription = sequelize.define('PushSubscription', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    endpoint: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true
    },
    p256dh: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    auth: {
        type: DataTypes.TEXT,
        allowNull: false
    }
});

module.exports = PushSubscription;
