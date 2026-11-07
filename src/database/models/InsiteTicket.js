const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const InsiteTicket = sequelize.define('InsiteTicket', {
    ticketId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false
    }
}, {
    timestamps: true,
    indexes: [
        { fields: ['guildId'] },
        { fields: ['expiresAt'] }
    ]
});

module.exports = InsiteTicket;
