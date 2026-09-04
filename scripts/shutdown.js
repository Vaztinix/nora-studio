const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PID_FILE = path.join(__dirname, '../.nora.pid');
const TUNNEL_PID_FILE = path.join(__dirname, '../.nora_tunnel.pid');

console.log('[System] Initiating graceful shutdown sequence...');

function stopPid(pidFile, label) {
    try {
        if (fs.existsSync(pidFile)) {
            const pidStr = fs.readFileSync(pidFile, 'utf8').trim();
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
                console.log(`[System] Sending graceful SIGINT signal to ${label} (PID ${pid})...`);
                try {
                    process.kill(pid, 'SIGINT');
                } catch (e) {}

                // Wait up to 1 second for graceful exit
                let isAlive = false;
                const start = Date.now();
                while (Date.now() - start < 1000) {
                    try {
                        process.kill(pid, 0);
                        isAlive = true;
                    } catch (e) {
                        isAlive = false;
                        break;
                    }
                }

                if (isAlive) {
                    console.log(`[System] Force killing ${label} (PID ${pid})...`);
                    try {
                        process.kill(pid, 'SIGKILL');
                    } catch (e) {}
                    if (process.platform === 'win32') {
                        try {
                            execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore' });
                        } catch (e) {}
                    }
                }
            }
            try { fs.unlinkSync(pidFile); } catch (e) {}
        }
    } catch (e) {}
}

function cleanupOrphanedProcesses() {
    if (process.platform === 'win32') {
        try {
            console.log('[System] Sweeping for any orphaned Nora bot or cloudflared instances...');
            const psScript = `Get-CimInstance Win32_Process -Filter "Name = 'node.exe' or Name = 'cloudflared.exe'" | Where-Object { ($_.CommandLine -like '*src/index.js*' -or $_.CommandLine -like '*src\\\\index.js*' -or $_.CommandLine -like '*cloudflared tunnel*') -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
            execSync(`powershell -NoProfile -NonInteractive -Command "${psScript}"`, { stdio: 'ignore' });
        } catch (e) {}
    }
}

async function shutdownAll() {
    stopPid(PID_FILE, 'Nora Bot Core & API Server');
    stopPid(TUNNEL_PID_FILE, 'Cloudflare Tunnel Connector');
    cleanupOrphanedProcesses();
    
    if (process.platform === 'win32') {
        const start = Date.now();
        while (Date.now() - start < 300) {}
    }

    console.log('✅ Graceful shutdown completed.');
}

shutdownAll();
