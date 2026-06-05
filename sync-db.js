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
