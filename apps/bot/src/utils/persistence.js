const fs = require('fs');
const path = require('path');

/**
 * Nora Core Persistence - V17.2 Data Integrity Unit
 */
module.exports = {
    /**
     * Creates a physical copy of the SQLite database as a fail-safe recovery point.
     * Executes on every successful system sync.
     */
    systemBackup: () => {
        try {
            const dbPath = path.join(__dirname, '..', 'database', 'database.sqlite');
            const backupPath = path.join(__dirname, '..', 'database', 'database.sqlite.bak');

            if (fs.existsSync(dbPath)) {
                fs.copyFileSync(dbPath, backupPath);
                console.log('[System Maintenance] Database Backup Created: database.sqlite.bak');
            }
        } catch (error) {
            console.error('[System Fail-Safe] Backup Fault:', error);
        }
    },

    /**
     * Converts level data into a portable JSON format for master-channel echoes.
     */
    exportData: async () => {
        try {
            const UserLevel = require('../database/models/UserLevel');
            const GuildSettings = require('../database/models/GuildSettings');
            
            const users = await UserLevel.findAll();
            const settings = await GuildSettings.findAll();
            
            return {
                timestamp: new Date().toISOString(),
                version: 'V17.2',
                data: {
                    userLevels: users.map(u => u.toJSON()),
                    guildSettings: settings.map(s => s.toJSON())
                }
            };
        } catch (error) {
            console.error('[System Persistence] Export Fault:', error);
            return null;
        }
    }
};
