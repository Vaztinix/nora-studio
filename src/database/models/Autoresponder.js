const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Autoresponder = sequelize.define('Autoresponder', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    trigger: {
        type: DataTypes.STRING,
        allowNull: false
    },
    response: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    matchType: {
        type: DataTypes.STRING,
        defaultValue: 'contains' // contains, exact, startsWith
    }
});

module.exports = Autoresponder;
