const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Application = sequelize.define('Application', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    questions: {
        type: DataTypes.TEXT, // JSON array of questions, e.g., ["Why do you want to join?", "What is your experience?"]
        defaultValue: '[]'
    },
    reviewChannelId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    autoRoleId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    acceptMessage: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    denyMessage: {
        type: DataTypes.TEXT,
        allowNull: true
    }
});

module.exports = Application;
