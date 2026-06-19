const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = __dirname;
const srcWeb = path.join(root, 'src', 'web');
const distDir = path.join(root, 'dist');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

fs.cpSync(srcWeb, distDir, { recursive: true });

console.log(`Build files copied to: ${distDir}`);

try {
    execSync('node scripts/safety_filter.js', { stdio: 'inherit' });
    console.log(`Build complete: ${distDir}`);
} catch (e) {
    console.error("Build failed validation.");
    process.exit(1);
}

