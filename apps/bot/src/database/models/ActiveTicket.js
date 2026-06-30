const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const ActiveTicket = sequelize.define('ActiveTicket', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    channelId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    ownerId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    isOpen: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    capturedIntake: {
        type: DataTypes.TEXT, // Stored as a JSON string
        allowNull: true
    }
});

module.exports = ActiveTicket;
