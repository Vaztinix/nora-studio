const fs = require('fs');
const path = require('path');
const sequelize = require('./src/database/db');

// Dynamically load all models so Sequelize registers them
const modelsDir = path.join(__dirname, 'src/database/models');
fs.readdirSync(modelsDir).forEach(file => {
    if (file.endsWith('.js')) {
        require(path.join(modelsDir, file));
    }
});

async function syncDB() {
    try {
        console.log('Running manual schema migrations for SQLite...');
        
        // Safely attempt to add the isManualPremium column to GuildSettings
        try {
            await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `isManualPremium` TINYINT(1) DEFAULT 0;");
            console.log('Successfully added isManualPremium to GuildSettings');
        } catch (err) {
            if (err.message.includes('duplicate column name') || err.message.includes('already exists')) {
                console.log('Column isManualPremium already exists in GuildSettings');
            } else {
                console.warn('Warning adding isManualPremium to GuildSettings:', err.message);
            }
        }

        // Safely attempt to add the isManualPremium column to UserLevels
        try {
            await sequelize.query("ALTER TABLE `UserLevels` ADD COLUMN `isManualPremium` TINYINT(1) DEFAULT 0;");
            console.log('Successfully added isManualPremium to UserLevels');
        } catch (err) {
            if (err.message.includes('duplicate column name') || err.message.includes('already exists')) {
                console.log('Column isManualPremium already exists in UserLevels');
            } else {
                console.warn('Warning adding isManualPremium to UserLevels:', err.message);
            }
        }

        // Safely attempt to add the levelUpMessage column to GuildSettings
        try {
            await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `levelUpMessage` TEXT DEFAULT NULL;");
            console.log('Successfully added levelUpMessage to GuildSettings');
        } catch (err) {
            if (err.message.includes('duplicate column name') || err.message.includes('already exists')) {
                console.log('Column levelUpMessage already exists in GuildSettings');
            } else {
                console.warn('Warning adding levelUpMessage to GuildSettings:', err.message);
            }
        }

        // --- NORA ECOSYSTEM V2.0 SCHEMA MIGRATIONS ---
        const newGuildSettingsColumns = [
            { name: 'installedAt', type: 'DATETIME DEFAULT NULL' },
            { name: 'autoModActive', type: 'TINYINT(1) DEFAULT 0' },
            { name: 'useDefaultSafetyRules', type: 'TINYINT(1) DEFAULT 1' },
            { name: 'customBlockedContexts', type: 'TEXT DEFAULT "[]"' },
            { name: 'muteDurationMinutes', type: 'INTEGER DEFAULT 60' },
            { name: 'maxWarningsBeforeAction', type: 'INTEGER DEFAULT 3' },
            { name: 'countingWhitelistedRoles', type: 'TEXT DEFAULT "[]"' },
            { name: 'countingBlacklistedUsers', type: 'TEXT DEFAULT "[]"' },
            { name: 'themePrimaryColor', type: 'VARCHAR(50) DEFAULT "#4F46E5"' },
            { name: 'themeComponentRounding', type: 'VARCHAR(50) DEFAULT "8px"' },
            { name: 'themeSidebarState', type: 'VARCHAR(50) DEFAULT "Locked"' },
            { name: 'themeBackgroundImage', type: 'TEXT DEFAULT NULL' },
            { name: 'welcomeRoleId', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'guessGameMin', type: 'INTEGER DEFAULT 1' },
            { name: 'guessGameMax', type: 'INTEGER DEFAULT 100' },
            { name: 'rpsMinBet', type: 'INTEGER DEFAULT 0' },
            { name: 'rpsMaxBet', type: 'INTEGER DEFAULT 10000' }
        ];

        for (const col of newGuildSettingsColumns) {
            try {
                await sequelize.query(`ALTER TABLE \`GuildSettings\` ADD COLUMN \`${col.name}\` ${col.type};`);
                console.log(`Successfully added ${col.name} column to GuildSettings`);
            } catch (err) {
                if (err.message.includes('duplicate column name') || err.message.includes('already exists')) {
                    console.log(`Column ${col.name} already exists in GuildSettings`);
                } else {
                    console.warn(`Warning adding ${col.name} to GuildSettings:`, err.message);
                }
            }
        }

        const newUserPrefsColumns = [
            { name: 'sessionGenerationMarker', type: 'TEXT DEFAULT NULL' },
            { name: 'auxiliaryRobloxHandles', type: 'TEXT DEFAULT "[]"' },
            { name: 'isTerminated', type: 'TINYINT(1) DEFAULT 0' },
            { name: 'terminationReason', type: 'TEXT DEFAULT NULL' },
            { name: 'dmNotificationsEnabled', type: 'TINYINT(1) DEFAULT 0' },
            { name: 'dmNotifLevels', type: 'TINYINT(1) DEFAULT 0' },
            { name: 'dmNotifModeration', type: 'TINYINT(1) DEFAULT 0' },
            { name: 'dmNotifBroadcasts', type: 'TINYINT(1) DEFAULT 0' }
        ];

        for (const col of newUserPrefsColumns) {
            try {
                await sequelize.query(`ALTER TABLE \`UserPrefs\` ADD COLUMN \`${col.name}\` ${col.type};`);
                console.log(`Successfully added ${col.name} column to UserPrefs`);
            } catch (err) {
                if (err.message.includes('duplicate column name') || err.message.includes('already exists')) {
                    console.log(`Column ${col.name} already exists in UserPrefs`);
                } else {
                    console.warn(`Warning adding ${col.name} to UserPrefs:`, err.message);
                }
            }
        }

        try {
            await sequelize.query("ALTER TABLE `Sessions` ADD COLUMN `sessionGenerationMarker` TEXT DEFAULT NULL;");
            console.log('Successfully added sessionGenerationMarker to Sessions');
        } catch (err) {
            if (err.message.includes('duplicate column name') || err.message.includes('already exists')) {
                console.log('Column sessionGenerationMarker already exists in Sessions');
            } else {
                console.warn('Warning adding sessionGenerationMarker to Sessions:', err.message);
            }
        }

        try {
            await sequelize.query("SELECT `id` FROM `RobloxVerifies` LIMIT 1;");
        } catch (err) {
            console.log('RobloxVerifies does not have auto-increment id. Dropping table for recreation...');
            try {
                await sequelize.query("DROP TABLE IF EXISTS `RobloxVerifies`;");
            } catch (e) {
                console.warn('Failed to drop RobloxVerifies:', e.message);
            }
        }

        // Safely add columns to Autoresponders if they don't exist
        try {
            await sequelize.query("ALTER TABLE `Autoresponders` ADD COLUMN `isEmbed` TINYINT(1) DEFAULT 0;");
        } catch (e) {}
        try {
            await sequelize.query("ALTER TABLE `Autoresponders` ADD COLUMN `ignoreStaffAndBots` TINYINT(1) DEFAULT 0;");
        } catch (e) {}
        try {
            await sequelize.query("ALTER TABLE `Autoresponders` ADD COLUMN `ignoredChannels` TEXT DEFAULT '[]';");
        } catch (e) {}
        try {
            await sequelize.query("ALTER TABLE `Autoresponders` ADD COLUMN `ignoredRoles` TEXT DEFAULT '[]';");
        } catch (e) {}
        try {
            await sequelize.query("ALTER TABLE `Autoresponders` ADD COLUMN `allowedRoles` TEXT DEFAULT '[]';");
        } catch (e) {}

        console.log('Syncing database tables...');
        // Sync without alter: true to avoid SQLite backup recreation table mismatch bug
        await sequelize.sync();
        console.log('Database synced successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Error syncing database:', err);
        process.exit(1);
    }
}

syncDB();
