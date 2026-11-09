const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync } = require('child_process');

const PID_FILE = path.join(__dirname, '../../.nora.pid');
const LOCK_PORT = parseInt(process.env.NORA_LOCK_PORT || '48291', 10);
const INSTANCE_START_TIME = Date.now();

let lockServer = null;
let watchdogTimer = null;

function parsePidFile() {
    try {
        if (!fs.existsSync(PID_FILE)) return null;
        const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
        if (!raw) return null;
        if (raw.startsWith('{')) {
            const parsed = JSON.parse(raw);
            return {
                pid: parseInt(parsed.pid, 10),
                startedAt: parseInt(parsed.startedAt || '0', 10)
            };
        }
        return {
            pid: parseInt(raw, 10),
            startedAt: 0
        };
    } catch (_) {
        return null;
    }
}

function writePidFile() {
    try {
        fs.writeFileSync(PID_FILE, JSON.stringify({
            pid: process.pid,
            startedAt: INSTANCE_START_TIME
        }));
    } catch (_) {}
}

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
                execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', timeout: 3000 });
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
                timeout: 4500
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
    // 1. Write our own PID & start timestamp immediately so any older instance's watchdog yields to us
    const existing = parsePidFile();
    writePidFile();

    if (existing && !isNaN(existing.pid) && existing.pid > 0 && existing.pid !== process.pid) {
        if (isPidAlive(existing.pid)) {
            killPid(existing.pid, `Terminating previous PID from .nora.pid (${existing.pid})`);
        }
    }

    // 2. Also check port 3000 & LOCK_PORT owners
    for (const p of [LOCK_PORT, 3000]) {
        const portOwner = findPidByPort(p);
        if (portOwner && portOwner !== process.pid) {
            killPid(portOwner, `Terminating stale process occupying port ${p} (${portOwner})`);
        }
    }

    // 3. Scan OS process table for duplicate node instances running src/index.js
    const duplicatePids = findDuplicateProcessPids();
    for (const dupPid of duplicatePids) {
        killPid(dupPid, `Terminating detected duplicate Nora bot instance (${dupPid})`);
    }

    writePidFile();
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
                    socket.write(JSON.stringify({ type: 'PONG', pid: process.pid, startedAt: INSTANCE_START_TIME }) + '\n');
                } else if (msg && msg.type === 'SHUTDOWN_DUPLICATE') {
                    console.log(`[Instance Lock] Received shutdown request from newer instance (PID ${msg.pid}). Exiting cleanly...`);
                    process.exit(0);
                }
            } catch (_) {}
        });
    });

    lockServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
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
        lockServer.listen(LOCK_PORT, '127.0.0.1');
        lockServer.unref();
    } catch (_) {}
}

/**
 * Initializes continuous double-instance detection watchdog.
 * Ensures an older process always yields to a newer process, preventing startup race kills.
 */
function startDoubleInstanceWatchdog() {
    if (watchdogTimer) clearInterval(watchdogTimer);

    watchdogTimer = setInterval(() => {
        try {
            const fileInfo = parsePidFile();
            if (fileInfo && !isNaN(fileInfo.pid) && fileInfo.pid !== process.pid && isPidAlive(fileInfo.pid)) {
                if (fileInfo.startedAt >= INSTANCE_START_TIME) {
                    // A newer instance took over! Yield gracefully instead of killing the newer instance.
                    console.log(`[Instance Watchdog] Newer Nora instance detected (PID ${fileInfo.pid}). Yielding and exiting cleanly...`);
                    process.exit(0);
                } else {
                    killPid(fileInfo.pid, `Watchdog terminating older duplicate instance (${fileInfo.pid})`);
                    writePidFile();
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
    sweepDuplicateInstances();
    bindLockSocket();
    startDoubleInstanceWatchdog();

    const cleanup = () => {
        try {
            if (watchdogTimer) clearInterval(watchdogTimer);
            if (lockServer) lockServer.close();
            const current = parsePidFile();
            if (current && current.pid === process.pid) {
                fs.unlinkSync(PID_FILE);
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
