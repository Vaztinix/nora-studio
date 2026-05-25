const fs = require('fs');
const path = 'src/commands/setup/configure.js';
let content = fs.readFileSync(path, 'utf8');

// Fix addOptions([ ... ]); -> addOptions([ ... ]));
content = content.replace(/(\.addOptions\(\[\s+[\s\S]+?\])\);/g, "$1));");

// Fix addComponents( ... ); -> addComponents( ... ));
content = content.replace(/(\.addComponents\([\s\S]+?)\);\s+const/g, "$1));\n                        const");

// Fix addFields( ... const -> addFields( ... ); const
content = content.replace(/(\.addFields\([\s\S]+?)\s+const/g, "$1);\n                        const");

// Fix i.reply({ ... } return -> i.reply({ ... }); return
content = content.replace(/(\.reply\(\{[\s\S]+?\} )\s+return/g, "$1);\n                        return");

fs.writeFileSync(path, content);
console.log('Round 4 of fixes applied.');
