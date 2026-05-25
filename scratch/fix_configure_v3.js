const fs = require('fs');
const path = 'src/commands/setup/configure.js';
let content = fs.readFileSync(path, 'utf8');

// Round 3 - Aggressive Statement Splitting
// Match a closing brace/paren/bracket followed by space and then a keyword that starts a new statement
content = content.replace(/([})\]])\s*(if|const|let|var|await|return|async|try|catch|let|rewardDesc|const rewards|let slotCount)/g, "$1;\n                        $2");

// Fix specific artifacts from the corrupted replacement-of-replaced-text
content = content.replace(/};/g, "}"); // Clean up double semis if created
content = content.replace(/};;/g, "}"); 
content = content.replace(/;;\n/g, ";\n");

// Fix common merging in embeds
content = content.replace(/`\s+const/g, "`);\n                        const");
content = content.replace(/;\s+const/g, ";\n                        const");

// Specific fix for action_antiraid handler since I was just editing it
content = content.replace(/settings.requirePFP = !settings.requirePFP;\s+if/g, "settings.requirePFP = !settings.requirePFP;\n                    if");

// Fix building dashboard footer
content = content.replace(/ephemeral: true }\s+const collector/g, "ephemeral: true });\n        const collector");

fs.writeFileSync(path, content);
console.log('Round 3 of fixes applied.');
