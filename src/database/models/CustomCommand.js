const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const CustomCommand = sequelize.define('CustomCommand', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
        comment: 'UUID or generated ID for the command'
    },
    botId: {
        type: DataTypes.STRING,
        allowNull: false,
        index: true,
        references: {
            model: 'hostedBots',
            key: 'id'
        },
        comment: 'Discord ID of the bot this command belongs to'
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Command name (lowercase, no spaces)'
    },
    description: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Command description shown in help'
    },
    type: {
        type: DataTypes.ENUM('text', 'embed', 'action'),
        defaultValue: 'text',
        comment: 'Response type: simple text, embed, or action (reaction, role assignment)'
    },
    responseContent: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Raw response text or JSON for embeds'
    },
    trigger: {
        type: DataTypes.ENUM('message', 'reaction', 'timer'),
        defaultValue: 'message',
        comment: 'What triggers this command'
    },
    arguments: {
        type: DataTypes.JSON,
        defaultValue: [],
        comment: 'Array of arguments the command accepts'
    },
    permissions: {
        type: DataTypes.JSON,
        defaultValue: [],
        comment: 'Required Discord permissions to use'
    },
    tokenCost: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        comment: 'Tokens consumed per execution (1 base + extras per block)'
    },
    totalExecutions: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Times this command has been run (for analytics)'
    },
    enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: 'Whether this command is active'
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
    tableName: 'customCommands',
    timestamps: true,
    indexes: [
        { fields: ['botId', 'name'], unique: true },
        { fields: ['botId'] }
    ]
});

module.exports = CustomCommand;
