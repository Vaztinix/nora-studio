const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const { encrypt, decrypt } = require('../../utils/security');

const GuildSettings = sequelize.define('GuildSettings', {
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    levelingEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    welcomerEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    welcomeChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    moderationEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    funEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    utilityEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    aiPreference: {
        type: DataTypes.STRING,
        defaultValue: 'LOCAL' // Default to our new Local Nora V10 Engine
    },
    levelUpNotificationsEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    levelUpChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    spamDetectionEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    spamThreshold: {
        type: DataTypes.INTEGER,
        defaultValue: 5 // messages per 5 seconds
    },
    countingChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    roleRewards: {
        type: DataTypes.TEXT, // JSON-formatted string: { "level": "roleId" }
        allowNull: true,
        defaultValue: '{}'
    },
    // ---- Dynamic Logging Framework ----
    loggingChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    logMessageEdits: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logMessageDeletes: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logMemberLeaves: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logMemberJoins: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logAutomod: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isPremium: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isManualPremium: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    spamInterval: {
        type: DataTypes.INTEGER,
        defaultValue: 5000 // default 5 seconds in ms
    },
    antiRaidEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    antiRaidThreshold: {
        type: DataTypes.INTEGER,
        defaultValue: 10 // 10 joins
    },
    antiRaidWindow: {
        type: DataTypes.INTEGER,
        defaultValue: 10000 // 10 seconds
    },
    antiRaidAction: {
        type: DataTypes.STRING,
        defaultValue: 'notify' // notify, lockdown, kick_new
    },
    lockdownMode: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    voteLogChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    promoterRoleId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ticketCategoryId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // ---- AutoMod Integration ----
    automodProfanity: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    automodSexual: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    automodSlurs: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    automodSpam: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    automodMentions: {
        type: DataTypes.INTEGER,
        defaultValue: 0 // 0 = disabled
    },
    automodScam: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    automodHardcore: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    automodImmuneRoles: {
        type: DataTypes.TEXT, // JSON array of role IDs
        defaultValue: '[]'
    },
    managedBotId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    managedBotToken: {
        type: DataTypes.TEXT, // AES-256-GCM encrypted
        allowNull: true,
        get() {
            const raw = this.getDataValue('managedBotToken');
            return raw ? decrypt(raw) : raw;
        },
        set(value) {
            this.setDataValue('managedBotToken', value ? encrypt(value) : value);
        }
    },
    // ---- Warning System ----
    warningThreshold: {
        type: DataTypes.INTEGER,
        defaultValue: 3
    },
    warningAction: {
        type: DataTypes.STRING,
        defaultValue: 'none' // none, kick, ban, timeout
    },
    antiSpamMuteDuration: {
        type: DataTypes.INTEGER,
        defaultValue: 60000 // 1 minute in ms
    },
    // ---- Advanced Security ----
    minAccountAge: {
        type: DataTypes.INTEGER,
        defaultValue: 0 // 0 = disabled (in days)
    },
    minAccountAgeAction: {
        type: DataTypes.STRING,
        defaultValue: 'kick' // kick, ban_7, ban_28, ban_90, ban_perm
    },
    requirePFP: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    nicknameRaidFilter: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // ---- Verification ----
    verifyChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    verifyRoleId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // ---- Dynamic Logging Framework Extensions ----
    logChannelCreates: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logChannelEdits: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logChannelDeletes: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logVoiceJoins: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logVoiceLeaves: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logVoiceMoves: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logMemberBoosts: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    logJoinMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    logLeaveMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    logBoostMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    // ---- Voice XP Configuration ----
    voiceXpRate: {
        type: DataTypes.INTEGER,
        defaultValue: 10
    },
    voiceXpInterval: {
        type: DataTypes.INTEGER,
        defaultValue: 60000
    },
    // ---- Level Up Configuration ----
    levelUpDmEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    xpRoleMultipliers: {
        type: DataTypes.TEXT,
        defaultValue: '{}'
    },
    guessGameXpReward: {
        type: DataTypes.INTEGER,
        defaultValue: 50
    },
    countingChannelXpReward: {
        type: DataTypes.INTEGER,
        defaultValue: 15
    },
    // ---- Roblox Integration ----
    robloxLiveActivityEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    robloxVerifyEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    robloxVerifyRoleId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    robloxGroupBindings: {
        type: DataTypes.TEXT,
        defaultValue: '[]'
    },
    robloxJoinGameEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // ---- Top.gg Integration ----
    topggBotId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    topggLegacyOwnerId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    topggWebhookAuth: {
        type: DataTypes.STRING,
        allowNull: true
    },
    topggVoteChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    topggVoteMessage: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    topggVoteContent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    topggVoteEmbedImage: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    topggVoteEmbedColor: {
        type: DataTypes.STRING,
        defaultValue: '#aeefff'
    },
    topggRewardRoleId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    topggVerifyCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    topggVerified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    topggXpBoost: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    topggDoubleXp: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    topggReminders: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    topggWebhookName: {
        type: DataTypes.STRING,
        defaultValue: 'Nora Webhook'
    },
    topggWebhookAvatar: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // ---- User preferences / UI States ----
    prefNotifVotes: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    prefNotifLevels: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    prefNotifSafety: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    prefNotifBroadcast: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    prefSecureSession: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    prefAccessLogs: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    notifPosition: {
        type: DataTypes.STRING,
        defaultValue: 'tr'
    },
    boostChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    boostRewardRoleId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // ---- Games Config ----
    guessGameEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    rpsGameEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    rpsGameXpReward: {
        type: DataTypes.INTEGER,
        defaultValue: 25
    },
    // ---- Language ----
    language: {
        type: DataTypes.STRING,
        defaultValue: 'en'
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
    levelUpMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    levelingPfpEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    levelingUseImages: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    logDashboardActions: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    customModResponses: {
        type: DataTypes.TEXT,
        defaultValue: '{}'
    },
    installedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    autoModActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    useDefaultSafetyRules: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    customBlockedContexts: {
        type: DataTypes.TEXT,
        defaultValue: '[]'
    },
    muteDurationMinutes: {
        type: DataTypes.INTEGER,
        defaultValue: 60
    },
    maxWarningsBeforeAction: {
        type: DataTypes.INTEGER,
        defaultValue: 3
    },
    countingWhitelistedRoles: {
        type: DataTypes.TEXT,
        defaultValue: '[]'
    },
    countingBlacklistedUsers: {
        type: DataTypes.TEXT,
        defaultValue: '[]'
    },
    themePrimaryColor: {
        type: DataTypes.STRING,
        defaultValue: '#4F46E5'
    },
    themeComponentRounding: {
        type: DataTypes.STRING,
        defaultValue: '8px'
    },
    themeSidebarState: {
        type: DataTypes.STRING,
        defaultValue: 'Locked'
    },
    themeBackgroundImage: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    ticketChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    robloxVerifyChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    reactionRoleNotifyDm: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    inviteTrackerEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    inviteTrackerChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

module.exports = GuildSettings;

