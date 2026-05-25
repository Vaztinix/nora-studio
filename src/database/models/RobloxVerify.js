const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const RobloxVerify = sequelize.define('RobloxVerify', {
    userId: {
        type: DataTypes.STRING,
        primaryKey: true
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
    }
});

module.exports = RobloxVerify;
