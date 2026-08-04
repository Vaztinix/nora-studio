const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PID_FILE = path.join(__dirname, '../.nora.pid');
const WATCHER_PID_FILE = path.join(__dirname, '../.nora_watcher.pid');

console.log('[Status Shark] Initiating graceful shutdown sequence...');

function stopPid(pidFile, label) {
    try {
        if (fs.existsSync(pidFile)) {
            const pidStr = fs.readFileSync(pidFile, 'utf8').trim();
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid) && pid > 0) {
                console.log(`[Status Shark] Sending graceful SIGINT signal to ${label} (PID ${pid})...`);
                try {
                    process.kill(pid, 'SIGINT');
                } catch (e) {}
            }
            try { fs.unlinkSync(pidFile); } catch (e) {}
        }
    } catch (e) {}
}

async function shutdownAll() {
    stopPid(PID_FILE, 'Nora Bot Core');
    stopPid(WATCHER_PID_FILE, 'Status Shark Watcher');

    // Give 1.5s for async webhook delivery before closing remaining tasks
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
        execSync('taskkill /f /im node.exe 2>nul || exit 0', { stdio: 'ignore' });
    } catch (e) {}
    console.log('✅ Graceful shutdown completed.');
}

shutdownAll();
