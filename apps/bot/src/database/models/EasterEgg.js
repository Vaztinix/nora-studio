const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const EasterEgg = sequelize.define('EasterEgg', {
    userId: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true
    },
    foundEggs: {
        type: DataTypes.STRING,
        defaultValue: '[]' // Will store JSON stringified array of egg IDs (1-10)
    },
    roleAwarded: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

module.exports = EasterEgg;
