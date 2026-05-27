const fs = require('fs');
const path = require('path');

const root = __dirname;
const srcWeb = path.join(root, 'src', 'web');
const distDir = path.join(root, 'dist');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

fs.cpSync(srcWeb, distDir, { recursive: true });

console.log(`Build complete: ${distDir}`);
