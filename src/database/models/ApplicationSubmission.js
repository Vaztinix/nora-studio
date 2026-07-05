const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const ApplicationSubmission = sequelize.define('ApplicationSubmission', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
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
        allowNull: false
    },
    appName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    answers: {
        type: DataTypes.TEXT, // JSON object: { "question": "answer" }
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'PENDING' // PENDING, APPROVED, REJECTED
    },
    reviewerId: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

module.exports = ApplicationSubmission;
