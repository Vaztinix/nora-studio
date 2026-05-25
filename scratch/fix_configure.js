const fs = require('fs');
const path = 'src/commands/setup/configure.js';
let content = fs.readFileSync(path, 'utf8');

// Fix common merged lines
content = content.replace(/require\('([^']+)'const/g, "require('$1');\nconst");
content = content.replace(/interaction.guildId } }                settings/g, "interaction.guildId } });\n                settings");
content = content.replace(/interaction.guildId } }            }/g, "interaction.guildId } });\n            }");
content = content.replace(/require\('\.\.\/\.\.\/utils\/automodSync'        const/g, "require('../../utils/automodSync');\n        const");
content = content.replace(/require\('\.\.\/\.\.\/utils\/embeds'\)\.getRoleColor\(interaction\)/g, "require('../../utils/embeds').getRoleColor(interaction);");
content = content.replace(/Vote Tracker', description: 'Track Top.gg votes in real-time', value: 'view_votetracker' }            }/g, "Vote Tracker', description: 'Track Top.gg votes in real-time', value: 'view_votetracker' });\n            }");
content = content.replace(/Exit setup', value: 'exit' }/g, "Exit setup', value: 'exit' }\n            ];");
content = content.replace(/\.addOptions\(mainOptions\)\s+return {/g, ".addOptions(mainOptions)\n            );\n\n            return {");

// This is going to be very hard to do perfectly.
// I'll try to use a more general approach for some patterns.
content = content.replace(/ephemeral: true }        const/g, "ephemeral: true });\n        const");
content = content.replace(/time: 300000 }/g, "time: 300000 });");
content = content.replace(/ephemeral: true }                if \(i.customId/g, "ephemeral: true });\n                if (i.customId");

fs.writeFileSync(path, content);
console.log('Partial fix applied.');
