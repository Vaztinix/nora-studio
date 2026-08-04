const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const WEBHOOK_URL = process.env.SHUTDOWN_WEBHOOK_URL || 'https://discord.com/api/webhooks/1533295606590734456/NvUr7PcEGXp_hf7zGYtbRTm-hKl9r1AcQ3DzeVdPTVIwR5xAmTNTkNehc6GYLkon_F3p';
const PID_FILE = path.join(__dirname, '../.nora.pid');
const WATCHER_PID_FILE = path.join(__dirname, '../.nora_watcher.pid');

// Save Watcher PID
try {
    fs.writeFileSync(WATCHER_PID_FILE, process.pid.toString());
} catch (e) {}

let currentState = 'STARTING'; // 'ONLINE' | 'OFFLINE' | 'STARTING'
let downTimestamp = null;
let currentMonitoredPid = null;

function isPidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

function getMonitoredPid() {
    try {
        if (fs.existsSync(PID_FILE)) {
            const content = fs.readFileSync(PID_FILE, 'utf8').trim();
            const pid = parseInt(content, 10);
            if (!isNaN(pid) && pid > 0) return pid;
        }
    } catch (e) {}
    return null;
}

function formatDuration(ms) {
    if (!ms || ms < 0) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
}

const { spawnSync } = require('child_process');

async function sendWebhook(embed) {
    if (!WEBHOOK_URL) return;

    // Fast Sync Delivery via curl.exe (Ensures packets leave before OS power off)
    try {
        const payload = JSON.stringify({
            username: 'Status Shark',
            avatar_url: 'https://nora.vaztinix.com/nora.png',
            embeds: [embed]
        });
        const res = spawnSync('curl.exe', [
            '-s', '-X', 'POST',
            '-H', 'Content-Type: application/json',
            '-d', payload,
            '--max-time', '4',
            WEBHOOK_URL
        ], { encoding: 'utf8', timeout: 5000 });
        if (res.status === 0) {
            console.log(`[Status Shark Watcher] Fast sync webhook delivered: "${embed.title}"`);
            return;
        }
    } catch (e) {}

    // Async Fallback
    try {
        await axios.post(WEBHOOK_URL, {
            username: 'Status Shark',
            avatar_url: 'https://nora.vaztinix.com/nora.png',
            embeds: [embed]
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });
        console.log(`[Status Shark Watcher] Webhook delivered via axios: "${embed.title}"`);
    } catch (e) {
        console.error('[Status Shark Watcher] Failed to post webhook:', e.response?.data || e.message);
    }
}

async function poll() {
    const activePid = getMonitoredPid();
    const pidAlive = activePid ? isPidAlive(activePid) : false;

    if (currentState === 'STARTING') {
        if (pidAlive) {
            currentState = 'ONLINE';
            currentMonitoredPid = activePid;
            console.log(`[Status Shark Watcher] Attached to active Nora PID ${activePid}. System ONLINE.`);
        }
        return;
    }

    if (currentState === 'ONLINE') {
        if (!pidAlive) {
            currentState = 'OFFLINE';
            downTimestamp = Date.now();
            console.log(`[Status Shark Watcher] Target PID ${currentMonitoredPid} died.`);
            currentMonitoredPid = null;
        }
    } else if (currentState === 'OFFLINE') {
        if (pidAlive && activePid !== currentMonitoredPid) {
            currentState = 'ONLINE';
            currentMonitoredPid = activePid;
            console.log(`[Status Shark Watcher] Nora back online under new PID ${activePid}!`);
            downTimestamp = null;
        }
    }
}

console.log('[Status Shark Watcher] Independent Monitor Engine active. Polling every 2s...');
setInterval(poll, 2000);
