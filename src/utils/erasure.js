const fs = require('fs').promises;
const path = require('path');
const GuildSettings = require('../database/models/GuildSettings');
const UserLevel = require('../database/models/UserLevel');
const Warning = require('../database/models/Warning');
const Giveaway = require('../database/models/Giveaway');
const CustomCommand = require('../database/models/CustomCommand');
const TopggConnection = require('../database/models/TopggConnection');
const ActiveTicket = require('../database/models/ActiveTicket');
const settingsCache = require('./settingsCache');

/**
 * Performs absolute cascading erasure of all data records and configurations
 * associated with a specific Guild ID from physical storage disks.
 */
async function performCascadingErasure(guildId) {
    if (!guildId) return false;
    console.log(`[Cascading Erasure] Initiating absolute erasure sequence for guild ${guildId}...`);

    try {
        // 1. Delete all configuration indices and invalidate cache
        await GuildSettings.destroy({ where: { guildId } });
        settingsCache.invalidate(guildId);

        // 2. Delete all user leveling, message count, and voice states
        await UserLevel.destroy({ where: { guildId } });

        // 3. Wipe all warning logs
        await Warning.destroy({ where: { guildId } });

        // 4. Delete all active or archived giveaways
        await Giveaway.destroy({ where: { guildId } });

        // 5. Delete all custom command triggers
        await CustomCommand.destroy({ where: { guildId } });

        // 6. Delete all Top.gg connections
        await TopggConnection.destroy({ where: { guildId } });

        // 7. Delete all support ticketing records
        await ActiveTicket.destroy({ where: { guildId } });

        // 8. Wipe from the counting JSON database file
        const dataPath = path.join(__dirname, '..', '..', 'countingData.json');
        try {
            const data = await fs.readFile(dataPath, 'utf8');
            const countingData = JSON.parse(data);
            if (countingData[guildId]) {
                delete countingData[guildId];
                await fs.writeFile(dataPath, JSON.stringify(countingData, null, 2), 'utf8');
                console.log(`[Cascading Erasure] Erased counting logs for guild ${guildId} from countingData.json`);
            }
        } catch (e) {
            // File does not exist or is empty, skip
        }

        console.log(`[Cascading Erasure] Absolute cascading erasure completed successfully for guild ${guildId}.`);
        return true;
    } catch (error) {
        console.error(`[Cascading Erasure Error] Failed during erasure sequence for guild ${guildId}:`, error);
        throw error;
    }
}

module.exports = {
    performCascadingErasure
};
