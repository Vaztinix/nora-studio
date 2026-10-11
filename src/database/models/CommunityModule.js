const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const CommunityModule = sequelize.define('CommunityModule', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    moduleId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    authorId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    authorTag: {
        type: DataTypes.STRING,
        allowNull: false
    },
    authorAvatar: {
        type: DataTypes.STRING,
        allowNull: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    summary: {
        type: DataTypes.STRING(300),
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    category: {
        type: DataTypes.STRING,
        defaultValue: 'utility' // moderation, utility, ai_prompts, games, leveling, integrations
    },
    tags: {
        type: DataTypes.TEXT,
        defaultValue: '[]' // JSON array string
    },
    version: {
        type: DataTypes.STRING,
        defaultValue: '1.0.0'
    },
    code: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    configSchema: {
        type: DataTypes.TEXT,
        defaultValue: '{}' // JSON string schema for user configurable options
    },
    permissions: {
        type: DataTypes.TEXT,
        defaultValue: '[]' // JSON array of required Discord permissions
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'PENDING' // PENDING, APPROVED, DECLINED
    },
    declineReason: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    aiSafetyScore: {
        type: DataTypes.INTEGER,
        defaultValue: 100 // 0 to 100
    },
    aiSafetyVerdict: {
        type: DataTypes.STRING,
        defaultValue: 'SAFE' // SAFE, CAUTION, UNSAFE
    },
    aiSafetyReport: {
        type: DataTypes.TEXT,
        defaultValue: '{}' // JSON string with detailed AI scanner breakdown
    },
    installCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    likesCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    isFeatured: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    reviewedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
});

module.exports = CommunityModule;
