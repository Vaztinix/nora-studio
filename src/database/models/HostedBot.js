const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const HostedBot = sequelize.define('HostedBot', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
        comment: 'Discord bot ID (from token validation)'
    },
    ownerId: {
        type: DataTypes.STRING,
        allowNull: false,
        index: true,
        comment: 'Discord user ID of the bot owner'
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Bot display name from Discord API'
    },
    token: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Encrypted bot token (should be encrypted in production)'
    },
    inviteUrl: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'OAuth invite link for the bot'
    },
    avatar: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Avatar hash from Discord API'
    },
    prefix: {
        type: DataTypes.STRING,
        defaultValue: '!',
        comment: 'Command prefix for the bot'
    },
    totalTokensUsed: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Total tokens consumed this month (1 per event/command, +1 per block)'
    },
    tokenLimit: {
        type: DataTypes.INTEGER,
        defaultValue: 5000,
        comment: 'Monthly token limit (default 5000)'
    },
    tokensResetAt: {
        type: DataTypes.DATE,
        defaultValue: () => {
            const now = new Date();
            return new Date(now.getFullYear(), now.getMonth() + 1, 1);
        },
        comment: 'Date when token count resets to 0'
    },
    isEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: 'Whether the bot is active and running'
    },
    commandCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Total custom commands built for this bot'
    },
    totalEventsTriggered: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Lifetime event/command executions for analytics'
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'hostedBots',
    timestamps: true,
    indexes: [
        { fields: ['ownerId'] },
        { fields: ['createdAt'] }
    ]
});

module.exports = HostedBot;
