const os = require('os');

/**
 * 💻 Nora Host Machine Hardware & Environment Telemetry
 * Provides accurate hardware specs of the host PC running Nora
 * with GUARANTEED PRIVACY:
 * - NO user account names or user home directories
 * - NO internal/external IP addresses or MAC addresses
 * - NO absolute personal filesystem paths
 */

function formatBytes(bytes) {
    return (bytes / (1024 ** 3)).toFixed(1) + ' GB';
}

function getSanitizedSpecs() {
    const cpus = os.cpus() || [];
    const cpuModel = (cpus[0]?.model || 'Multi-Core Processor').replace(/\s+/g, ' ').trim();
    const cpuCores = cpus.length;
    const cpuSpeedGhz = cpus[0]?.speed ? (cpus[0].speed / 1000).toFixed(2) + ' GHz' : 'Dynamic';

    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = totalMemBytes - freeMemBytes;
    const memUsagePct = ((usedMemBytes / totalMemBytes) * 100).toFixed(0);

    const platform = os.platform(); // 'win32'
    const release = os.release(); // '10.0.26340'
    const arch = os.arch(); // 'x64'

    let osName = 'Windows';
    if (platform === 'win32') {
        const build = parseInt(release.split('.')[2] || '0', 10);
        osName = (build >= 22000) ? 'Windows 11 (64-bit)' : 'Windows 10 (64-bit)';
    } else if (platform === 'linux') {
        osName = 'Linux (64-bit)';
    } else if (platform === 'darwin') {
        osName = 'macOS';
    }

    const hostUptimeSec = os.uptime();
    const hostDays = Math.floor(hostUptimeSec / 86400);
    const hostHours = Math.floor((hostUptimeSec % 86400) / 3600);
    const hostMins = Math.floor((hostUptimeSec % 3600) / 60);
    const hostUptimeStr = `${hostDays}d ${hostHours}h ${hostMins}m`;

    const botUptimeSec = Math.floor(process.uptime());
    const botHours = Math.floor(botUptimeSec / 3600);
    const botMins = Math.floor((botUptimeSec % 3600) / 60);
    const botSecs = botUptimeSec % 60;
    const botUptimeStr = `${botHours}h ${botMins}m ${botSecs}s`;

    const memUsage = process.memoryUsage();
    const heapUsedMB = (memUsage.heapUsed / (1024 ** 2)).toFixed(1) + ' MB';
    const rssMB = (memUsage.rss / (1024 ** 2)).toFixed(1) + ' MB';

    return {
        cpu: {
            model: cpuModel,
            cores: cpuCores,
            threads: cpuCores,
            speed: cpuSpeedGhz
        },
        memory: {
            total: formatBytes(totalMemBytes),
            used: formatBytes(usedMemBytes),
            free: formatBytes(freeMemBytes),
            percentUsed: `${memUsagePct}%`
        },
        os: {
            name: osName,
            kernel: `NT ${release}`,
            arch: arch,
            platform: platform
        },
        uptime: {
            host: hostUptimeStr,
            bot: botUptimeStr
        },
        runtime: {
            node: process.version,
            v8: process.versions.v8,
            heapUsed: heapUsedMB,
            rss: rssMB
        }
    };
}

function getSanitizedSpecsSummary() {
    const s = getSanitizedSpecs();
    return `Host PC Hardware Specifications (Strict Privacy - No Personal Identifiers):\n` +
           `• CPU: ${s.cpu.model} (${s.cpu.cores} Threads @ ${s.cpu.speed})\n` +
           `• RAM: ${s.memory.total} DDR (${s.memory.used} in use / ${s.memory.percentUsed} utilized, ${s.memory.free} free)\n` +
           `• Operating System: ${s.os.name} [Kernel: ${s.os.kernel}, Architecture: ${s.os.arch}]\n` +
           `• Host Uptime: ${s.uptime.host} | Process Uptime: ${s.uptime.bot}\n` +
           `• Runtime: Node.js ${s.runtime.node} (V8 ${s.runtime.v8}) | Process Memory: Heap ${s.runtime.heapUsed}, RSS ${s.runtime.rss}`;
}

module.exports = {
    getSanitizedSpecs,
    getSanitizedSpecsSummary
};
