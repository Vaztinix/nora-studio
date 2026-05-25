const fs = require('fs');
const path = 'src/commands/setup/configure.js';
let content = fs.readFileSync(path, 'utf8');

// Round 2 of fixes
content = content.replace(/await collector\.stop\(\s+return/g, "await collector.stop();\n                        return");
content = content.replace(/JSON\.parse\(settings\.roleRewards \|\| '\{\}'/g, "JSON.parse(settings.roleRewards || '{}')");
content = content.replace(/`${rewardDesc}`\s+const/g, "`${rewardDesc}`);\n                        const");
content = content.replace(/new ActionRowBuilder\(\)\.addComponents\(select\)\s+}/g, "new ActionRowBuilder().addComponents(select));\n                        }");
content = content.replace(/value: g\.id\s+}\)\)\)/g, "value: g.id\n                                })));");
content = content.replace(/backRow = new ActionRowBuilder\(\)\.addComponents\(new ButtonBuilder\(\)\.setCustomId\('go_back'\)\.setLabel\('Back to Dashboard'\)\.setStyle\(ButtonStyle\.Secondary\)\s+await i\.update\({ embeds: \[embed\], components: \[row, backRow\] }/g, "backRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('go_back').setLabel('Back to Dashboard').setStyle(ButtonStyle.Secondary));\n                        await i.update({ embeds: [embed], components: [row, backRow] });");
content = content.replace(/STYLE_DANGER\)\s+const rowB =/g, "STYLE_DANGER());\n                        const rowB =");
content = content.replace(/isPremium\(i\s+const/g, "isPremium(i);\n                        const");
content = content.replace(/`\n\s+const rowA =/g, "`);\n\n                        const rowA =");
content = content.replace(/ButtonStyle\.Success\)\s+const rowB =/g, "ButtonStyle.Success);\n                        const rowB =");
content = content.replace(/ButtonStyle\.Secondary\)\s+await i\.update\({ embeds: \[embed\], components: \[rowC, rowR, rowB\] }/g, "ButtonStyle.Secondary));\n                    await i.update({ embeds: [embed], components: [rowC, rowR, rowB] });");
content = content.replace(/await i\.update\(buildDashboard\(\s+}/g, "await i.update(buildDashboard());\n                }");
content = content.replace(/await i\.deferUpdate\(\s+const type/g, "await i.deferUpdate();\n                    const type");
content = content.replace(/await i\.deferUpdate\(\s+const { syncAutoModRule }/g, "await i.deferUpdate();\n                    const { syncAutoModRule }");
content = content.replace(/description: 'Track Top\.gg votes in real-time', value: 'view_votetracker' }            }/g, "description: 'Track Top.gg votes in real-time', value: 'view_votetracker' })            }");

// Close some orphaned delimiters
content = content.replace(/inline: true }/g, "inline: true }"); // This looks okay
content = content.replace(/ButtonStyle\.Secondary\)\s+await i\.update\({ embeds: \[embed\], components: components }/g, "ButtonStyle.Secondary));\n                    await i.update({ embeds: [embed], components: components });");

fs.writeFileSync(path, content);
console.log('Round 2 of fixes applied.');
