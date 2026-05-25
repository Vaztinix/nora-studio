const { DataTypes } = require('sequelize');
const sequelize = require('../db');

/**
 * Aura V1 User Memory Model
 * Distills user interests, traits, and behavior for long-term "understanding"
 * without storing entire conversation logs permanently.
 */
const UserMemory = sequelize.define('UserMemory', {
    userId: {
        type: DataTypes.STRING,
        primaryKey: true,
    },
    // Distilled "Insights" about the user (e.g. "Likes gaming", "Helpful", "Frequent chatter")
    insights: {
        type: DataTypes.TEXT,
        defaultValue: '[]' // Stored as a JSON array of strings
    },
    // Specific interests detected by Aura
    interests: {
        type: DataTypes.TEXT,
        defaultValue: '{}' // Stored as a JSON object: { "gaming": 5, "music": 2 }
    },
    // Last interaction timestamp
    lastInteracted: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
});

module.exports = UserMemory;
