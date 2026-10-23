const { DataTypes } = require('sequelize');
const sequelize = require('../db');

/**
 * 🛡️ Internal Verification Network (IVN) — Verified Team Accounts
 * Stores verified accounts recognized by Nora Studio to interact with internal
 * Nora systems, developer modules, and configuration overrides.
 */
const InternalVerificationUser = sequelize.define('InternalVerificationUser', {
    userId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    username: {
        type: DataTypes.STRING,
        allowNull: true
    },
    displayName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    role: {
        type: DataTypes.STRING,
        defaultValue: 'Team Member'
    },
    verifiedBy: {
        type: DataTypes.STRING,
        defaultValue: 'System Core'
    },
    verifiedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    timestamps: true
});

module.exports = InternalVerificationUser;
