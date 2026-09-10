const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync } = require('child_process');

const PID_FILE = path.join(__dirname, '../../.nora.pid');
const LOCK_PORT = parseInt(process.env.NORA_LOCK_PORT || '48291', 10);

let lockServer = null;
let watchdogTimer = null;

/**
 * Checks whether a given PID is currently active on the OS.
 */
function isPidAlive(pid) {
    if (!pid || isNaN(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Force terminates a process by PID across Windows and Unix platforms.
 */
function killPid(pid, reason = 'Duplicate instance termination') {
    if (!pid || isNaN(pid) || pid === process.pid) return;

    try {
        console.log(`[Instance Lock] ${reason}: Terminating PID ${pid}...`);
        try {
            process.kill(pid, 'SIGKILL');
        } catch (_) {}

        if (process.platform === 'win32') {
            try {
                execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore' });
            } catch (_) {}
        }
    } catch (err) {
        console.warn(`[Instance Lock] Warning terminating PID ${pid}:`, err.message);
    }
}

/**
 * Scans the OS process table for any duplicate Nora instances (node running src/index.js).
 * Returns an array of duplicate PIDs.
 */
function findDuplicateProcessPids() {
    const duplicates = [];

    if (process.platform === 'win32') {
        try {
            const psScript = `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { ($_.CommandLine -like '*src/index.js*' -or $_.CommandLine -like '*src\\\\index.js*') -and $_.ProcessId -ne ${process.pid} } | Select-Object -ExpandProperty ProcessId`;
            const output = execSync(`powershell -NoProfile -NonInteractive -Command "${psScript}"`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 3000
            }).trim();

            if (output) {
                output.split(/\r?\n/).forEach(line => {
                    const pid = parseInt(line.trim(), 10);
                    if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
                        duplicates.push(pid);
                    }
                });
            }
        } catch (_) {}
    } else {
        try {
            const output = execSync(`pgrep -f "node.*src/index.js"`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 2000
            }).trim();

            if (output) {
                output.split(/\s+/).forEach(line => {
                    const pid = parseInt(line.trim(), 10);
                    if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
                        duplicates.push(pid);
                    }
                });
            }
        } catch (_) {}
    }

    return duplicates;
}

/**
 * Finds which PID is currently listening on a specific TCP port (e.g. port 3000 or lock port).
 */
function findPidByPort(port) {
    if (process.platform === 'win32') {
        try {
            const output = execSync(`netstat -ano | findstr :${port}`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 2000
            }).trim();

            if (output) {
                const lines = output.split(/\r?\n/);
                for (const line of lines) {
                    if (line.includes('LISTENING')) {
                        const parts = line.trim().split(/\s+/);
                        const pid = parseInt(parts[parts.length - 1], 10);
                        if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
                            return pid;
                        }
                    }
                }
            }
        } catch (_) {}
    }
    return null;
}

/**
 * Sweeps and shuts down any other duplicate instances.
 */
function sweepDuplicateInstances() {
    // 1. Check PID file
    try {
        if (fs.existsSync(PID_FILE)) {
            const oldPidStr = fs.readFileSync(PID_FILE, 'utf8').trim();
            const oldPid = parseInt(oldPidStr, 10);
            if (!isNaN(oldPid) && oldPid > 0 && oldPid !== process.pid) {
                if (isPidAlive(oldPid)) {
                    killPid(oldPid, `Terminating stale PID from .nora.pid (${oldPid})`);
                }
            }
        }
    } catch (_) {}

    // 2. Scan OS process table for duplicate node instances running src/index.js
    const duplicatePids = findDuplicateProcessPids();
    for (const dupPid of duplicatePids) {
        killPid(dupPid, `Terminating detected duplicate Nora bot instance (${dupPid})`);
    }

    // 3. Update PID file with current process PID
    try {
        fs.writeFileSync(PID_FILE, process.pid.toString());
    } catch (_) {}
}

/**
 * Binds a local TCP mutex server to guarantee only 1 instance can run.
 */
function bindLockSocket() {
    if (lockServer) return;

    lockServer = net.createServer((socket) => {
        socket.on('data', (data) => {
            try {
                const msg = JSON.parse(data.toString().trim());
                if (msg && msg.type === 'PING') {
                    socket.write(JSON.stringify({ type: 'PONG', pid: process.pid }) + '\n');
                } else if (msg && msg.type === 'SHUTDOWN_DUPLICATE') {
                    console.log(`[Instance Lock] Received shutdown request from newer instance (PID ${msg.pid}). Exiting cleanly...`);
                    process.exit(0);
                }
            } catch (_) {}
        });
    });

    lockServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`[Instance Lock] Port ${LOCK_PORT} is in use. Resolving conflicting instance...`);
            const conflictingPid = findPidByPort(LOCK_PORT);
            if (conflictingPid && conflictingPid !== process.pid) {
                killPid(conflictingPid, `Terminating process occupying lock port ${LOCK_PORT} (${conflictingPid})`);
                setTimeout(() => {
                    try {
                        lockServer.close();
                        lockServer.listen(LOCK_PORT, '127.0.0.1');
                    } catch (_) {}
                }, 500);
            }
        }
    });

    try {
        lockServer.listen(LOCK_PORT, '127.0.0.1', () => {
            // Socket listening
        });
        lockServer.unref(); // Don't prevent process from exiting normally
    } catch (_) {}
}

/**
 * Initializes continuous double-instance detection watchdog.
 * Runs every 8 seconds to ensure no duplicate instances start later.
 */
function startDoubleInstanceWatchdog() {
    if (watchdogTimer) clearInterval(watchdogTimer);

    watchdogTimer = setInterval(() => {
        try {
            // Check if another process overwrote the PID file
            if (fs.existsSync(PID_FILE)) {
                const currentFilePid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
                if (!isNaN(currentFilePid) && currentFilePid !== process.pid && isPidAlive(currentFilePid)) {
                    console.warn(`[Instance Watchdog] Duplicate instance detected via PID file (${currentFilePid}). Shutting down duplicate instance.`);
                    killPid(currentFilePid, `Watchdog terminating rogue duplicate instance (${currentFilePid})`);
                    fs.writeFileSync(PID_FILE, process.pid.toString());
                }
            }

            // Quick process sweep
            const duplicates = findDuplicateProcessPids();
            if (duplicates.length > 0) {
                console.warn(`[Instance Watchdog] Detected ${duplicates.length} duplicate Nora process(es): ${duplicates.join(', ')}. Shutting them down.`);
                for (const dupPid of duplicates) {
                    killPid(dupPid, `Watchdog terminating duplicate process (${dupPid})`);
                }
            }
        } catch (_) {}
    }, 8000);

    watchdogTimer.unref();
}

/**
 * Main entry point: Ensures strict single instance on startup and arms the watchdog.
 */
function ensureSingleInstance() {
    console.log(`[System Lock] Initializing single instance protection for PID ${process.pid}...`);

    // 1. Terminate any existing/duplicate instances on startup
    sweepDuplicateInstances();

    // 2. Bind mutex socket
    bindLockSocket();

    // 3. Arm continuous runtime watchdog
    startDoubleInstanceWatchdog();

    // 4. Register graceful exit cleanups
    const cleanup = () => {
        try {
            if (watchdogTimer) clearInterval(watchdogTimer);
            if (lockServer) lockServer.close();
            if (fs.existsSync(PID_FILE)) {
                const currentPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
                if (currentPid === process.pid) {
                    fs.unlinkSync(PID_FILE);
                }
            }
        } catch (_) {}
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });

    console.log(`[System Lock] Single instance protection active. Running under PID ${process.pid}. Continuous watchdog engaged.`);
}

module.exports = {
    ensureSingleInstance,
    sweepDuplicateInstances,
    killPid,
    findDuplicateProcessPids,
    findPidByPort
};
