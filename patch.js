const sequelize = require('./src/database/db');
const fs = require('fs');
const path = require('path');

// Import all models so they register with Sequelize
const modelsPath = path.join(__dirname, 'src', 'database', 'models');
fs.readdirSync(modelsPath).forEach(file => {
    if (file.endsWith('.js')) {
        require(path.join(modelsPath, file));
    }
});

async function migrateAll() {
    const queryInterface = sequelize.getQueryInterface();
    
    for (const [modelName, Model] of Object.entries(sequelize.models)) {
        const tableName = Model.tableName;
        console.log(`Checking table "${tableName}" for model "${modelName}"...`);
        
        let tableInfo;
        try {
            tableInfo = await queryInterface.describeTable(tableName);
        } catch (err) {
            console.log(`Table "${tableName}" does not exist. Creating...`);
            await Model.sync();
            continue;
        }

        const modelAttributes = Model.rawAttributes;
        for (const [colName, attr] of Object.entries(modelAttributes)) {
            if (!tableInfo[colName]) {
                console.log(`Table "${tableName}": Column "${colName}" is missing. Adding...`);
                try {
                    await queryInterface.addColumn(tableName, colName, attr);
                    console.log(`Successfully added column "${colName}" to "${tableName}"`);
                } catch (err) {
                    console.error(`Failed to add column "${colName}" to "${tableName}":`, err.message);
                }
            }
        }
    }
    console.log('All migrations completed successfully.');
    process.exit(0);
}

migrateAll().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
