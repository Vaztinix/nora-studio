const sequelize = require('./src/database/db');
async function scan() {
    try {
        console.log('Database Config:', sequelize.options.storage);
        
        const checkTable = async (tableName, modelPath) => {
            console.log(`\n--- Checking ${tableName} ---`);
            const [results] = await sequelize.query(`PRAGMA table_info(${tableName});`);
            const columns = results.map(r => r.name);
            console.log('Current Columns:', JSON.stringify(columns, null, 2));
            
            const Model = require(modelPath);
            const modelAttributes = Object.keys(Model.rawAttributes);
            console.log('Model Attributes:', JSON.stringify(modelAttributes, null, 2));
            
            const missing = modelAttributes.filter(attr => !columns.includes(attr));
            console.log('Missing Columns:', JSON.stringify(missing, null, 2));
        };

        await checkTable('GuildSettings', './src/database/models/GuildSettings');
        await checkTable('UserPrefs', './src/database/models/UserPrefs');
        await checkTable('UserLevels', './src/database/models/UserLevel');
        await checkTable('UserMemories', './src/database/models/UserMemory');

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
scan();
