const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const IpBan = sequelize.define('IpBan', {
    ipAddress: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    associatedUserId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    reason: {
        type: DataTypes.TEXT,
        allowNull: true
    }
});

module.exports = IpBan;
