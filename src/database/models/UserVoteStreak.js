const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const UserVoteStreak = sequelize.define('UserVoteStreak', {
    userId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    currentStreak: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    lastVoteClaimAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    totalVotesCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    totalRewardsClaimed: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }
});

module.exports = UserVoteStreak;

