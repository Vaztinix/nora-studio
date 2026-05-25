const fs = require('fs');
const path = require('path');

module.exports = (client) => {
    const eventsPath = path.join(__dirname, '..', 'events');
    console.log(`[Events] Looking for events in: ${eventsPath}`);
    if (!fs.existsSync(eventsPath)) {
        console.log(`[Events] Directory MISSING! creating one...`);
        fs.mkdirSync(eventsPath);
    }

    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    let registeredCount = 0;

    for (const file of eventFiles) {
        try {
            const filePath = path.join(eventsPath, file);
            const event = require(filePath);
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
            registeredCount++;
        } catch (e) {
            console.error(`[Events] Failed to load event ${file}:`, e.message);
        }
    }
    console.log(`[Events] Successfully physically registered ${registeredCount} system events.`);
};
