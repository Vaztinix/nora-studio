const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const TicketHistory = sequelize.define('TicketHistory', {
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
        allowNull: false
    },
    ownerId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'open',
        validate: {
            isIn: [['open', 'closed']]
        }
    },
    topic: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'Support'
    },
    openTime: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    resolveTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    closedById: {
        type: DataTypes.STRING,
        allowNull: true
    },
    intakeResponses: {
        type: DataTypes.TEXT, // Stored as JSON string
        allowNull: true
    }
});

module.exports = TicketHistory;
