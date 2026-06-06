const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const { encrypt, decrypt } = require('../../utils/security');

const Session = sequelize.define('Session', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    discordToken: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
            const raw = this.getDataValue('discordToken');
            return raw ? decrypt(raw) : raw;
        },
        set(value) {
            this.setDataValue('discordToken', value ? encrypt(value) : value);
        }
    },
    ipAddress: {
        type: DataTypes.STRING,
        allowNull: true
    },
    userAgent: {
        type: DataTypes.STRING,
        allowNull: true
    },
    location: {
        type: DataTypes.STRING,
        allowNull: true
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
});

module.exports = Session;
