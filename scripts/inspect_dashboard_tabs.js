const fs = require('fs');
const html = fs.readFileSync('./src/web/dashboard.html', 'utf-8');
const navMatches = html.match(/data-tab="[^"]+"/g) || [];
console.log('Tabs:', Array.from(new Set(navMatches)));
