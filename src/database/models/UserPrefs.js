const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const UserPrefs = sequelize.define('UserPrefs', {
    userId: {
        type: DataTypes.STRING,
        primaryKey: true,
    },
    robloxPublic: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    profilePublic: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    bio: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true
    },
    customTheme: {
        type: DataTypes.STRING,
        defaultValue: 'default'
    },
    integrations: {
        type: DataTypes.TEXT,
        defaultValue: '{}' // JSON string for future expansion
    },
    dashboardSettings: {
        type: DataTypes.TEXT,
        defaultValue: '{}' // JSON string for UI preferences (theme, view mode)
    },
    joinMeEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    joinLink: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    sessionHardened: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    language: {
        type: DataTypes.STRING,
        defaultValue: 'en'
    },
    isPremium: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isManualPremium: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    aiProfile: {
        type: DataTypes.TEXT,
        defaultValue: '{}'
    },
    // ---- Premium & Expanded Time Duration Gates ----
    paidExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
    },
    expandedTimeMs: {
        type: DataTypes.BIGINT,
        defaultValue: 0
    },
    premiumExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
    },
    sessionGenerationMarker: {
        type: DataTypes.STRING,
        defaultValue: () => require('uuid').v4()
    },
    auxiliaryRobloxHandles: {
        type: DataTypes.TEXT,
        defaultValue: '[]'
    }
});

module.exports = UserPrefs;

