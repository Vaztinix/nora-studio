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
    customTheme: {
        type: DataTypes.STRING,
        defaultValue: 'default'
    },
    integrations: {
        type: DataTypes.TEXT,
        defaultValue: '{}'
    },
    dashboardSettings: {
        type: DataTypes.TEXT,
        defaultValue: '{}'
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
    },
    dmNotificationsEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    dmNotifLevels: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    dmNotifModeration: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    dmNotifBroadcasts: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isTerminated: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    terminationReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    displayName: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    tempBlacklistExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
    },
    // ---- Member Card & Image Customization ----
    overwriteServerPresets: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    showAvatarInRankCard: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    rankCardThemeMode: {
        type: DataTypes.STRING,
        defaultValue: 'preset' // 'preset', 'custom', 'image'
    },
    rankCardCustomColor: {
        type: DataTypes.STRING,
        defaultValue: '#7c3aed'
    },
    rankCardBackgroundImage: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    customRankCardBg: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    customLevelUpBg: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    // ---- Team Card Customization & Self-Management ----
    isTeamMember: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    hasTeamCard: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    teamCardImage: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    teamCardBanner: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    teamCardDisplayName: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    teamCardRole: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    teamCardDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    teamCardBadges: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    teamCardLinks: {
        type: DataTypes.TEXT,
        defaultValue: '{}'
    },
    teamCardHideRole: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    teamCardHideJoinDate: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    teamCardHideCard: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    customCardShape: {
        type: DataTypes.STRING,
        defaultValue: 'default'
    },
    // ---- Personal Premium Entitlement & Bound Target Server ----
    boundGuildId: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    boundGuildName: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    }
});

module.exports = UserPrefs;
