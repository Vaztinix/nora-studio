const sequelize = require('./src/database/db');

async function fixDB() {
    try {
        const columns = [
            'logChannelCreates', 'logChannelEdits', 'logChannelDeletes', 
            'logVoiceJoins', 'logVoiceLeaves', 'logVoiceMoves'
        ];
        
        for (const col of columns) {
            try {
                await sequelize.query(`ALTER TABLE GuildSettings ADD COLUMN ${col} BOOLEAN DEFAULT false;`);
                console.log(`Added column ${col}`);
            } catch (e) {
                console.log(`Column ${col} might already exist or error:`, e.message);
            }
        }
        
        // Let's also check UserMemory lastImageUpload
        try {
            await sequelize.query(`ALTER TABLE UserMemories ADD COLUMN lastImageUpload DATETIME;`);
            console.log("Added lastImageUpload to UserMemories");
        } catch(e) {
            console.log("UserMemories error:", e.message);
        }

        // UserPrefs additions
        const userPrefsColumns = [
            { name: 'isPremium', type: 'BOOLEAN DEFAULT false' },
            { name: 'isManualPremium', type: 'BOOLEAN DEFAULT false' },
            { name: 'aiProfile', type: 'TEXT DEFAULT \'{}\'' }
        ];

        for (const col of userPrefsColumns) {
            try {
                await sequelize.query(`ALTER TABLE UserPrefs ADD COLUMN ${col.name} ${col.type};`);
                console.log(`Added column ${col.name} to UserPrefs`);
            } catch (e) {
                console.log(`Column ${col.name} on UserPrefs might already exist or error:`, e.message);
            }
        }

        // Add Premium columns to GuildSettings
        const guildPremiumColumns = [
            { name: 'paidExpiresAt', type: 'DATETIME DEFAULT NULL' },
            { name: 'expandedTimeMs', type: 'BIGINT DEFAULT 0' },
            { name: 'premiumExpiresAt', type: 'DATETIME DEFAULT NULL' },
            { name: 'customModResponses', type: 'TEXT DEFAULT \'{}\'' }
        ];

        for (const col of guildPremiumColumns) {
            try {
                await sequelize.query(`ALTER TABLE GuildSettings ADD COLUMN ${col.name} ${col.type};`);
                console.log(`Added column ${col.name} to GuildSettings`);
            } catch (e) {
                console.log(`Column ${col.name} on GuildSettings might already exist or error:`, e.message);
            }
        }

        // Add Premium columns to UserPrefs
        const userPrefsPremiumColumns = [
            { name: 'paidExpiresAt', type: 'DATETIME DEFAULT NULL' },
            { name: 'expandedTimeMs', type: 'BIGINT DEFAULT 0' },
            { name: 'premiumExpiresAt', type: 'DATETIME DEFAULT NULL' }
        ];

        for (const col of userPrefsPremiumColumns) {
            try {
                await sequelize.query(`ALTER TABLE UserPrefs ADD COLUMN ${col.name} ${col.type};`);
                console.log(`Added column ${col.name} to UserPrefs`);
            } catch (e) {
                console.log(`Column ${col.name} on UserPrefs might already exist or error:`, e.message);
            }
        }

        console.log('Database fix complete.');
    } catch(e) {
        console.error('Fatal DB Error:', e);
    }
}
fixDB();
