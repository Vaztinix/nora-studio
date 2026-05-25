const fs = require('fs');
const path = require('path');

const commandsPath = path.join(__dirname, 'src', 'commands');
const summary = [];

function readDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            readDir(fullPath);
        } else if (file.endsWith('.js')) {
            try {
                const cmd = require(fullPath);
                if (cmd.data && typeof cmd.data.toJSON === 'function') {
                    summary.push(cmd.data.toJSON());
                } else if (cmd.data) {
                    summary.push({ name: cmd.data.name, description: cmd.data.description, options: cmd.data.options });
                }
            } catch (e) {
                console.error(`Error reading ${file}:`, e.message);
            }
        }
    }
}

readDir(commandsPath);
fs.writeFileSync(path.join(__dirname, 'commands_summary.json'), JSON.stringify(summary, null, 2));
console.log('Done!');
