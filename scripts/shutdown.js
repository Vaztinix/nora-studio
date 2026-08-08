const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PID_FILE = path.join(__dirname, '../.nora.pid');
const WATCHER_PID_FILE = path.join(__dirname, '../.nora_watcher.pid');

console.log('[Status Shark] Initiating graceful shutdown sequence...');

const LAST_SHUTDOWN_FILE = path.join(__dirname, '../.nora_last_shutdown.json');

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
    try {
        fs.writeFileSync(LAST_SHUTDOWN_FILE, JSON.stringify({
            shutdownAt: Date.now(),
            reason: 'Software Update / System Restart',
            isUpdate: true
        }));
    } catch (e) {}

    stopPid(PID_FILE, 'Nora Bot Core');
    stopPid(WATCHER_PID_FILE, 'Status Shark Watcher');
    stopPid(path.join(__dirname, '../.nora_tunnel.pid'), 'Cloudflare Tunnel Process');

    try {
        if (process.platform === 'win32') {
            execSync('wmic process where "name=\'cloudflared.exe\' and SessionId!=0" delete 2>nul', { stdio: 'ignore' });
        }
    } catch (e) {}

    console.log('✅ Graceful shutdown completed.');
}

shutdownAll();
