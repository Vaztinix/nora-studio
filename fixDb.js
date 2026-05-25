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

        console.log('Database fix complete.');
    } catch(e) {
        console.error('Fatal DB Error:', e);
    }
}
fixDB();
