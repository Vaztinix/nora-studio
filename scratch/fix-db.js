const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./src/database/database.sqlite');

function run(sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, (err) => {
            if (err) {
                if (err.message.includes('duplicate column name')) {
                    console.log(`[Skip] ${sql} (Column already exists)`);
                    resolve();
                } else {
                    reject(err);
                }
            } else {
                console.log(`[Success] ${sql}`);
                resolve();
            }
        });
    });
}

async function fix() {
    try {
        console.log('--- Database Surgery Starting (Vote Update) ---');
        await run('ALTER TABLE UserLevels ADD COLUMN voteCount INTEGER DEFAULT 0');
        await run('ALTER TABLE UserLevels ADD COLUMN lastVoteTimestamp DATE');
        console.log('--- Surgery Complete! ---');
    } catch (err) {
        console.error('--- Surgery Failed! ---');
        console.error(err);
    } finally {
        db.close();
    }
}

fix();
