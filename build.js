const fs = require('fs');
const path = require('path');

const root = __dirname;
const srcWeb = path.join(root, 'src', 'web');
const distDir = path.join(root, 'dist');
const distWeb = path.join(distDir, 'web');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distWeb, { recursive: true });

fs.cpSync(srcWeb, distWeb, { recursive: true });

console.log(`Build complete: ${distWeb}`);
