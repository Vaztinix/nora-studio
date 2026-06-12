const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const RobloxVerify = sequelize.define('RobloxVerify', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    robloxId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    verifyCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'PENDING' // PENDING, VERIFIED
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

module.exports = RobloxVerify;
