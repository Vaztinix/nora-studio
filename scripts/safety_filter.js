const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SRC_WEB_DIR = path.join(ROOT_DIR, 'src', 'web');

// Patterns to scan for
const SENSITIVE_PATTERNS = [
    /MT[A-Za-z0-9_\-\.]{22,}\.[A-Za-z0-9_\-\.]{6,}\.[A-Za-z0-9_\-\.]{27,}/, // Discord token pattern
    /https:\/\/discord(app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_\-]+/, // Webhook URLs
    /xox[pbo]-[0-9]{12}-[0-9]{12}-[0-9]{12}-[a-z0-9]{32}/i, // Slack token pattern
    /AIzaSy[A-Za-z0-9_\-]{33}/ // Google API Key
];

// Files to strictly ignore/quarantine (should never be in dist)
const BLOCKED_FILES_OR_DIRS = [
    '.env',
    '.git',
    'node_modules',
    'database.sqlite',
    'config.json'
];

function scanFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        for (const pattern of SENSITIVE_PATTERNS) {
            if (pattern.test(content)) {
                console.error(`\x1b[31m[SAFETY TRIGGERED] Exposed credential matching pattern ${pattern} found in: ${filePath}\x1b[0m`);
                return false;
            }
        }
    } catch (e) {
        // Skip binary files or unreadable files gracefully
    }
    return true;
}

function quarantineAndScan(directory) {
    if (!fs.existsSync(directory)) return true;
    
    let safe = true;
    const items = fs.readdirSync(directory);
    
    for (const item of items) {
        const fullPath = path.join(directory, item);
        const relativePath = path.relative(ROOT_DIR, fullPath);
        
        // 1. Quarantine check
        if (BLOCKED_FILES_OR_DIRS.includes(item) || BLOCKED_FILES_OR_DIRS.some(p => relativePath.includes(p))) {
            console.warn(`\x1b[33m[QUARANTINED] Removing blocked sensitive file/folder from deployment space: ${relativePath}\x1b[0m`);
            fs.rmSync(fullPath, { recursive: true, force: true });
            continue;
        }
        
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (!quarantineAndScan(fullPath)) {
                safe = false;
            }
        } else if (stat.isFile()) {
            // 2. Scan check
            if (!scanFile(fullPath)) {
                safe = false;
            }
        }
    }
    return safe;
}

console.log("Running Nora Build Safety Filter Scan...");
const isSafe = quarantineAndScan(DIST_DIR);

if (!isSafe) {
    console.error("\x1b[41m\x1b[37m[FATAL] Build aborted due to detected credentials in distribution files!\x1b[0m");
    process.exit(1);
} else {
    console.log("\x1b[32m[SUCCESS] Nora Build Safety Scan completed successfully with no leaks.\x1b[0m");
    process.exit(0);
}
