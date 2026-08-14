const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const StatusFlag = sequelize.define('StatusFlag', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    severity: {
        type: DataTypes.ENUM('info', 'degraded', 'outage', 'maintenance'),
        defaultValue: 'info',
        allowNull: false
    },
    shardId: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
    },
    isResolved: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    resolutionNote: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    author: {
        type: DataTypes.STRING,
        defaultValue: 'System Auto-Monitor',
        allowNull: false
    }
}, {
    timestamps: true
});

module.exports = StatusFlag;
