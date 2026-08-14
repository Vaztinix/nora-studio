const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const SiteAlert = sequelize.define('SiteAlert', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '📢 Nora Announcement'
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    type: {
        type: DataTypes.STRING,
        defaultValue: 'announcement' // announcement, info, warning, success
    },
    authorId: {
        type: DataTypes.STRING,
        defaultValue: '1214048435632603137'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
});

module.exports = SiteAlert;
