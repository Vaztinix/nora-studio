const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Case = sequelize.define('Case', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    moderatorId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'WARN'
    },
    // Keep 'action' as a virtual getter for backward compatibility
    action: {
        type: DataTypes.VIRTUAL,
        get() {
            return this.getDataValue('type');
        },
        set(value) {
            // Normalize old-style action values to uppercase type
            const normalized = (value || '').toUpperCase();
            const mapping = {
                'WARN': 'WARN', 'BAN': 'BAN', 'KICK': 'KICK',
                'MUTE': 'MUTE', 'UNMUTE': 'UNMUTE', 'UNBAN': 'UNBAN',
                'TEMPBAN': 'TEMPBAN', 'ROLE_ADD': 'ROLE_ADD', 'ROLE_REMOVE': 'ROLE_REMOVE'
            };
            this.setDataValue('type', mapping[normalized] || normalized);
        }
    },
    reason: {
        type: DataTypes.TEXT,
        defaultValue: 'No reason provided'
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'active',
        validate: {
            isIn: [['active', 'resolved', 'appealed', 'expired']]
        }
    },
    evidenceUrls: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
        get() {
            const raw = this.getDataValue('evidenceUrls');
            if (!raw) return [];
            try { return JSON.parse(raw); } catch (e) { return []; }
        },
        set(value) {
            this.setDataValue('evidenceUrls', value ? JSON.stringify(value) : null);
        }
    },
    duration: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null
    },
    linkedWarningId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null
    },
    editedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    editedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
});

module.exports = Case;
