const sequelize = require('./src/database/db');
const { QueryInterface } = sequelize;

async function migrate() {
    const queryInterface = sequelize.getQueryInterface();
    const table = 'GuildSettings';

    const columns = await queryInterface.describeTable(table);

    if (!columns.antiRaidAction) {
        await queryInterface.addColumn(table, 'antiRaidAction', {
            type: require('sequelize').DataTypes.STRING,
            defaultValue: 'notify'
        });
        console.log('Added antiRaidAction');
    }

    if (!columns.lockdownMode) {
        await queryInterface.addColumn(table, 'lockdownMode', {
            type: require('sequelize').DataTypes.BOOLEAN,
            defaultValue: false
        });
        console.log('Added lockdownMode');
    }

    if (!columns.requirePFP) {
        await queryInterface.addColumn(table, 'requirePFP', {
            type: require('sequelize').DataTypes.BOOLEAN,
            defaultValue: false
        });
        console.log('Added requirePFP');
    }

    if (!columns.nicknameRaidFilter) {
        await queryInterface.addColumn(table, 'nicknameRaidFilter', {
            type: require('sequelize').DataTypes.BOOLEAN,
            defaultValue: false
        });
        console.log('Added nicknameRaidFilter');
    }

    console.log('Migration complete!');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
