const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const VerificationLog = sequelize.define('VerificationLog', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    username: {
        type: DataTypes.STRING,
        allowNull: true
    },
    userAvatar: {
        type: DataTypes.STRING,
        allowNull: true
    },
    method: {
        type: DataTypes.STRING,
        defaultValue: 'Standard' // CAPTCHA, 1-Click Button, Emoji Reaction, Roblox Link
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'VERIFIED' // VERIFIED, FLAGGED, BLOCKED, OVERRIDDEN
    },
    riskScore: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    riskLevel: {
        type: DataTypes.STRING,
        defaultValue: 'Low' // Low, Medium, High, Critical
    },
    robloxId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    robloxUsername: {
        type: DataTypes.STRING,
        allowNull: true
    },
    findingsSummary: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    confidenceScore: {
        type: DataTypes.STRING,
        defaultValue: '100% Match'
    },
    sourcesData: {
        type: DataTypes.TEXT, // JSON array of sites/sources checked
        allowNull: true
    },
    evidenceData: {
        type: DataTypes.TEXT, // JSON array of evidence points
        allowNull: true
    }
}, {
    timestamps: true,
    indexes: [
        { fields: ['guildId'] },
        { fields: ['guildId', 'createdAt'] },
        { fields: ['userId'] }
    ]
});

module.exports = VerificationLog;
