const { Sequelize } = require('sequelize');
const path = require('path');

async function migrate() {
    const sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: path.join(__dirname, 'src', 'database', 'database.sqlite'),
        logging: false
    });

    const queryInterface = sequelize.getQueryInterface();
    
    try {
        console.log('Adding automodImmuneRoles column to GuildSettings...');
        await queryInterface.addColumn('GuildSettings', 'automodImmuneRoles', {
            type: Sequelize.TEXT,
            defaultValue: '[]'
        });
        console.log('Successfully added automodImmuneRoles column.');
    } catch (err) {
        console.log('Column already exists or migration failed:', err.message);
    }

    await sequelize.close();
}

migrate();
