const fs = require('fs');
const html = fs.readFileSync('./src/web/dashboard.html', 'utf-8');
const lines = html.split('\n');
lines.forEach((l, idx) => {
  if (l.includes('<div id="tab-')) {
    console.log((idx + 1) + ': ' + l.trim().slice(0, 50));
  }
});
