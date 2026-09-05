const fs = require('fs');
const path = require('path');
const sequelize = require('./db');

async function autoMigrateDatabase() {
    try {
        // 1. Ensure all models are loaded
        const modelsDir = path.join(__dirname, 'models');
        if (fs.existsSync(modelsDir)) {
            const files = fs.readdirSync(modelsDir);
            for (const file of files) {
                if (file.endsWith('.js') && !file.startsWith('migrate_')) {
                    try {
                        require(path.join(modelsDir, file));
                    } catch (e) {
                        console.error(`[DB Auto-Migrate] Error loading model ${file}:`, e.message);
                    }
                }
            }
        }

        // 2. Iterate through all registered models in Sequelize
        const models = sequelize.models;
        for (const [modelName, model] of Object.entries(models)) {
            const tableName = model.getTableName();
            
            // Check if table exists
            const [tables] = await sequelize.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}';`);
            if (!tables || tables.length === 0) {
                // Table doesn't exist yet, sync will create it
                continue;
            }

            // Get existing columns in SQLite table
            const [columnsInfo] = await sequelize.query(`PRAGMA table_info(\`${tableName}\`);`);
            const existingColumns = new Set(columnsInfo.map(col => col.name.toLowerCase()));

            // Get defined attributes in model
            const attributes = model.rawAttributes;
            for (const [attrName, attr] of Object.entries(attributes)) {
                const colName = (attr.field || attrName);
                if (!existingColumns.has(colName.toLowerCase())) {
                    // Column is missing! Build ALTER TABLE query
                    let colType = 'TEXT';
                    let defaultClause = '';

                    const typeKey = attr.type ? (attr.type.key || attr.type.constructor.name) : 'STRING';
                    
                    if (['BOOLEAN', 'TINYINT'].includes(typeKey)) {
                        colType = 'TINYINT(1)';
                        if (attr.defaultValue !== undefined && attr.defaultValue !== null) {
                            defaultClause = `DEFAULT ${attr.defaultValue ? 1 : 0}`;
                        } else {
                            defaultClause = 'DEFAULT 0';
                        }
                    } else if (['INTEGER', 'BIGINT', 'SMALLINT', 'MEDIUMINT'].includes(typeKey)) {
                        colType = 'INTEGER';
                        if (attr.defaultValue !== undefined && attr.defaultValue !== null) {
                            defaultClause = `DEFAULT ${attr.defaultValue}`;
                        }
                    } else if (['FLOAT', 'DOUBLE', 'REAL', 'DECIMAL'].includes(typeKey)) {
                        colType = 'REAL';
                        if (attr.defaultValue !== undefined && attr.defaultValue !== null) {
                            defaultClause = `DEFAULT ${attr.defaultValue}`;
                        }
                    } else if (['DATE', 'DATEONLY'].includes(typeKey)) {
                        colType = 'DATETIME';
                        if (attr.defaultValue === null) {
                            defaultClause = 'DEFAULT NULL';
                        }
                    } else {
                        // VARCHAR, TEXT, JSON, etc.
                        colType = 'TEXT';
                        if (typeof attr.defaultValue === 'string') {
                            defaultClause = `DEFAULT '${attr.defaultValue.replace(/'/g, "''")}'`;
                        } else if (attr.defaultValue === null) {
                            defaultClause = 'DEFAULT NULL';
                        } else if (attr.defaultValue !== undefined) {
                            defaultClause = `DEFAULT '${JSON.stringify(attr.defaultValue).replace(/'/g, "''")}'`;
                        }
                    }

                    const alterSql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${colName}\` ${colType} ${defaultClause};`.trim();
                    try {
                        await sequelize.query(alterSql);
                        console.log(`[DB Auto-Migrate] Added missing column: ${tableName}.${colName}`);
                    } catch (alterErr) {
                        if (!alterErr.message.includes('duplicate column name') && !alterErr.message.includes('already exists')) {
                            console.warn(`[DB Auto-Migrate] Failed to add column ${tableName}.${colName}:`, alterErr.message);
                        }
                    }
                }
            }
        }
        
        console.log('[DB Auto-Migrate] Schema verification and migration complete.');
    } catch (err) {
        console.error('[DB Auto-Migrate] Migration failed:', err.message);
    }
}

module.exports = { autoMigrateDatabase };
