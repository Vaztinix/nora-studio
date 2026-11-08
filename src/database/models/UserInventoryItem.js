const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const UserInventoryItem = sequelize.define('UserInventoryItem', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    itemType: {
        type: DataTypes.STRING, // 'xp_voucher', 'ai_credits', 'mytv_tokens', 'premium_pass'
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
    quantity: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    metadata: {
        type: DataTypes.TEXT, // JSON string e.g. { xpAmount: 250 }
        allowNull: true
    },
    isRedeemed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    redeemedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    redeemedGuildId: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

module.exports = UserInventoryItem;

