const fs = require('fs');
const path = require('path');
const GuildSettings = require('../database/models/GuildSettings');
const GuildSettingsBackup = require('../database/models/GuildSettingsBackup');

const BACKUP_ROOT_DIR = path.join(__dirname, '../database/backups');
const GUILDS_BACKUP_DIR = path.join(BACKUP_ROOT_DIR, 'guilds');
const FULL_BACKUP_DIR = path.join(BACKUP_ROOT_DIR, 'full');
const MAX_SNAPSHOTS_PER_GUILD = 25;
const MAX_FULL_BACKUPS_ON_DISK = 30;
const AUTO_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // Every 6 hours

let schedulerInterval = null;
let tableReady = false;

function ensureDirectories() {
    for (const dir of [BACKUP_ROOT_DIR, GUILDS_BACKUP_DIR, FULL_BACKUP_DIR]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

async function ensureBackupTable() {
    if (tableReady) return;
    try {
        await GuildSettingsBackup.sync();
        tableReady = true;
    } catch (err) {
        console.warn('[SettingsBackup] Failed to sync GuildSettingsBackup table:', err.message);
    }
}

/**
 * Compute which keys actually changed between an existing settings object and incoming updates
 */
function computeChangedKeys(currentObj, incomingUpdates) {
    if (!currentObj || !incomingUpdates || typeof incomingUpdates !== 'object') return [];
    const ignored = new Set(['id', 'guildId', 'createdAt', 'updatedAt']);
    const changed = [];
    for (const [key, newVal] of Object.entries(incomingUpdates)) {
        if (ignored.has(key) || newVal === undefined) continue;
        const oldVal = currentObj[key];
        if (String(oldVal ?? '') !== String(newVal ?? '')) {
            changed.push(key);
        }
    }
    return changed;
}

/**
 * Create an automatic versioned backup of a single server's settings (in SQLite + on disk JSON)
 */
async function createGuildBackup(guildId, options = {}) {
    if (!guildId) return null;
    try {
        ensureDirectories();
        await ensureBackupTable();

        let currentRow = options.existingSnapshot || null;
        if (!currentRow) {
            const found = await GuildSettings.findOne({ where: { guildId: String(guildId) } });
            if (!found) return null;
            currentRow = found.toJSON ? found.toJSON() : { ...found };
        } else if (typeof currentRow.toJSON === 'function') {
            currentRow = currentRow.toJSON();
        }

        const cleanSnapshot = { ...currentRow };
        delete cleanSnapshot.id;

        const changedKeys = Array.isArray(options.changedKeys)
            ? options.changedKeys
            : computeChangedKeys(cleanSnapshot, options.incomingUpdates);

        // Skip creating redundant automatic pre-save snapshots if 0 keys actually changed (unless forced/manual)
        if (
            !options.force &&
            options.incomingUpdates &&
            changedKeys.length === 0 &&
            options.triggerSource !== 'MANUAL_BACKUP' &&
            options.triggerSource !== 'PRE_RESET' &&
            options.triggerSource !== 'PRE_RESTORE'
        ) {
            return null;
        }

        const record = await GuildSettingsBackup.create({
            guildId: String(guildId),
            snapshot: JSON.stringify(cleanSnapshot),
            changedKeys: JSON.stringify(changedKeys),
            triggerSource: options.triggerSource || 'AUTO_SNAPSHOT',
            actorId: options.actorId ? String(options.actorId) : null,
            actorName: options.actorName ? String(options.actorName) : 'System',
            note: options.note || null
        });

        // Also persist the latest snapshot + history summary on disk per guild so even if SQLite is replaced, disk backups survive
        const guildDiskPath = path.join(GUILDS_BACKUP_DIR, `${String(guildId)}.json`);
        const diskPayload = {
            guildId: String(guildId),
            lastBackupId: record.id,
            lastBackupAt: new Date().toISOString(),
            triggerSource: record.triggerSource,
            actorId: record.actorId,
            actorName: record.actorName,
            changedKeys,
            snapshot: cleanSnapshot
        };
        fs.writeFileSync(guildDiskPath, JSON.stringify(diskPayload, null, 2), 'utf8');

        // Prune older snapshots beyond MAX_SNAPSHOTS_PER_GUILD for this guild
        const allForGuild = await GuildSettingsBackup.findAll({
            where: { guildId: String(guildId) },
            attributes: ['id'],
            order: [['id', 'DESC']]
        });
        if (allForGuild.length > MAX_SNAPSHOTS_PER_GUILD) {
            const idsToDelete = allForGuild.slice(MAX_SNAPSHOTS_PER_GUILD).map(r => r.id);
            await GuildSettingsBackup.destroy({ where: { id: idsToDelete } });
        }

        return record;
    } catch (err) {
        console.warn(`[SettingsBackup] Failed to create backup for guild ${guildId}:`, err.message);
        return null;
    }
}

/**
 * Create a full backup of all GuildSettings across all communities to disk (JSON + SQLite .bak copy)
 */
async function createFullDatabaseSettingsBackup(reason = 'SCHEDULED') {
    try {
        ensureDirectories();
        await ensureBackupTable();

        const allSettings = await GuildSettings.findAll({ raw: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `guild_settings_${timestamp}_${String(reason).toLowerCase().replace(/[^a-z0-9_-]/g, '')}.json`;
        const fullFilePath = path.join(FULL_BACKUP_DIR, filename);

        const payload = {
            createdAt: new Date().toISOString(),
            reason,
            totalGuilds: allSettings.length,
            guilds: allSettings
        };

        fs.writeFileSync(fullFilePath, JSON.stringify(payload, null, 2), 'utf8');

        // Also update per-guild disk JSON files if they don't exist yet
        for (const row of allSettings) {
            if (!row.guildId) continue;
            const guildDiskPath = path.join(GUILDS_BACKUP_DIR, `${String(row.guildId)}.json`);
            if (!fs.existsSync(guildDiskPath)) {
                const clean = { ...row };
                delete clean.id;
                fs.writeFileSync(guildDiskPath, JSON.stringify({
                    guildId: String(row.guildId),
                    lastBackupAt: payload.createdAt,
                    triggerSource: reason,
                    actorName: 'System Auto-Backup',
                    changedKeys: [],
                    snapshot: clean
                }, null, 2), 'utf8');
            }
        }

        // Also safely copy database.sqlite -> database.sqlite.bak
        const dbPath = path.join(__dirname, '../database/database.sqlite');
        const bakPath = path.join(__dirname, '../database/database.sqlite.bak');
        if (fs.existsSync(dbPath)) {
            try {
                fs.copyFileSync(dbPath, bakPath);
            } catch (_) {}
        }

        // Rotate old full JSON backups beyond MAX_FULL_BACKUPS_ON_DISK
        const files = fs.readdirSync(FULL_BACKUP_DIR)
            .filter(f => f.startsWith('guild_settings_') && f.endsWith('.json'))
            .map(f => ({
                name: f,
                fullPath: path.join(FULL_BACKUP_DIR, f),
                mtime: fs.statSync(path.join(FULL_BACKUP_DIR, f)).mtimeMs
            }))
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length > MAX_FULL_BACKUPS_ON_DISK) {
            for (const oldFile of files.slice(MAX_FULL_BACKUPS_ON_DISK)) {
                try { fs.unlinkSync(oldFile.fullPath); } catch (_) {}
            }
        }

        console.log(`[SettingsBackup] Full server settings backup completed (${allSettings.length} servers -> ${filename}).`);
        return {
            filename,
            filePath: fullFilePath,
            totalGuilds: allSettings.length,
            createdAt: payload.createdAt,
            reason
        };
    } catch (err) {
        console.warn('[SettingsBackup] Full backup failed:', err.message);
        return null;
    }
}

/**
 * List versioned snapshots for a specific server
 */
async function listGuildBackups(guildId, limit = 20) {
    try {
        ensureDirectories();
        await ensureBackupTable();

        const rows = await GuildSettingsBackup.findAll({
            where: { guildId: String(guildId) },
            order: [['id', 'DESC']],
            limit: Math.min(Number(limit) || 20, 50)
        });

        const formatted = rows.map(r => {
            let parsedKeys = [];
            try { parsedKeys = JSON.parse(r.changedKeys || '[]'); } catch (_) {}
            let parsedSnapshot = {};
            try { parsedSnapshot = JSON.parse(r.snapshot || '{}'); } catch (_) {}
            return {
                id: r.id,
                guildId: r.guildId,
                triggerSource: r.triggerSource,
                actorId: r.actorId,
                actorName: r.actorName || 'System',
                note: r.note,
                changedKeys: parsedKeys,
                changedCount: parsedKeys.length,
                createdAt: r.createdAt,
                summary: {
                    autoModActive: Boolean(parsedSnapshot.autoModActive),
                    antiRaidEnabled: Boolean(parsedSnapshot.antiRaidEnabled),
                    welcomerEnabled: Boolean(parsedSnapshot.welcomerEnabled),
                    levelingEnabled: Boolean(parsedSnapshot.levelingEnabled),
                    insiteVerificationEnabled: Boolean(parsedSnapshot.insiteVerificationEnabled),
                    welcomeChannelId: parsedSnapshot.welcomeChannelId || null,
                    verifyChannelId: parsedSnapshot.verifyChannelId || null,
                    loggingChannelId: parsedSnapshot.loggingChannelId || null
                }
            };
        });

        // If no DB snapshots exist yet for this guild, seed an initial baseline snapshot from current live settings
        if (formatted.length === 0) {
            const seeded = await createGuildBackup(guildId, {
                triggerSource: 'INITIAL_BASELINE',
                actorName: 'Nora Backup Guard',
                note: 'Automatic baseline snapshot',
                force: true
            });
            if (seeded) {
                return listGuildBackups(guildId, limit);
            }
        }

        return formatted;
    } catch (err) {
        console.warn(`[SettingsBackup] Failed to list backups for guild ${guildId}:`, err.message);
        return [];
    }
}

/**
 * Restore a server's settings from a specific backup ID (or latest disk backup if backupId === 'disk')
 */
async function restoreGuildBackup(guildId, backupId, actorInfo = {}) {
    await ensureBackupTable();
    let targetSnapshot = null;
    let sourceLabel = `Backup #${backupId}`;

    if (String(backupId) === 'disk' || String(backupId) === 'latest') {
        const latestRow = await GuildSettingsBackup.findOne({
            where: { guildId: String(guildId) },
            order: [['id', 'DESC']]
        });
        if (latestRow) {
            targetSnapshot = JSON.parse(latestRow.snapshot);
            sourceLabel = `Snapshot #${latestRow.id} (${new Date(latestRow.createdAt).toLocaleString()})`;
        } else {
            const guildDiskPath = path.join(GUILDS_BACKUP_DIR, `${String(guildId)}.json`);
            if (fs.existsSync(guildDiskPath)) {
                const diskData = JSON.parse(fs.readFileSync(guildDiskPath, 'utf8'));
                targetSnapshot = diskData.snapshot;
                sourceLabel = `Disk Backup (${diskData.lastBackupAt})`;
            }
        }
    } else {
        const row = await GuildSettingsBackup.findOne({
            where: { id: Number(backupId), guildId: String(guildId) }
        });
        if (!row) {
            throw new Error(`Backup snapshot #${backupId} not found for server ${guildId}.`);
        }
        targetSnapshot = JSON.parse(row.snapshot);
        sourceLabel = `Snapshot #${row.id} (${new Date(row.createdAt).toLocaleString()})`;
    }

    if (!targetSnapshot || typeof targetSnapshot !== 'object') {
        throw new Error('Backup snapshot payload is empty or invalid.');
    }

    // 1. Always take a safety snapshot of current settings before restoring
    await createGuildBackup(guildId, {
        triggerSource: 'PRE_RESTORE',
        actorId: actorInfo.actorId || null,
        actorName: actorInfo.actorName || 'Server Admin',
        note: `Automatic safety snapshot before restoring ${sourceLabel}`,
        force: true
    });

    // 2. Apply valid columns to GuildSettings
    const validAttrs = Object.keys(GuildSettings.rawAttributes || {});
    const cleanRestorePayload = {};
    const disallowed = new Set(['id', 'guildId', 'createdAt', 'updatedAt']);

    for (const key of Object.keys(targetSnapshot)) {
        if (disallowed.has(key)) continue;
        if (validAttrs.length === 0 || validAttrs.includes(key)) {
            cleanRestorePayload[key] = targetSnapshot[key];
        }
    }

    let [settings] = await GuildSettings.findOrCreate({ where: { guildId: String(guildId) } });
    await settings.update(cleanRestorePayload);

    // 3. Invalidate settingsCache immediately
    try {
        const settingsCache = require('./settingsCache');
        settingsCache.invalidate(String(guildId));
    } catch (_) {}

    return {
        restoredFrom: sourceLabel,
        guildId: String(guildId),
        settings: settings.toJSON ? settings.toJSON() : settings
    };
}

/**
 * List full database backups & recent per-guild backups for Owner Operations (/owner)
 */
async function getAdminBackupOverview() {
    ensureDirectories();
    await ensureBackupTable();

    const fullFiles = fs.existsSync(FULL_BACKUP_DIR)
        ? fs.readdirSync(FULL_BACKUP_DIR)
            .filter(f => f.startsWith('guild_settings_') && f.endsWith('.json'))
            .map(f => {
                const stat = fs.statSync(path.join(FULL_BACKUP_DIR, f));
                return {
                    filename: f,
                    sizeBytes: stat.size,
                    createdAt: new Date(stat.mtimeMs).toISOString()
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 20)
        : [];

    const recentSnapshots = await GuildSettingsBackup.findAll({
        attributes: ['id', 'guildId', 'triggerSource', 'actorId', 'actorName', 'changedKeys', 'note', 'createdAt'],
        order: [['id', 'DESC']],
        limit: 40
    });

    const totalSnapshots = await GuildSettingsBackup.count();

    return {
        totalSnapshots,
        fullBackupsCount: fullFiles.length,
        fullBackups: fullFiles,
        recentGuildSnapshots: recentSnapshots.map(r => {
            let keys = [];
            try { keys = JSON.parse(r.changedKeys || '[]'); } catch (_) {}
            return {
                id: r.id,
                guildId: r.guildId,
                triggerSource: r.triggerSource,
                actorId: r.actorId,
                actorName: r.actorName || 'System',
                changedKeys: keys,
                note: r.note,
                createdAt: r.createdAt
            };
        })
    };
}

/**
 * Start the automatic periodic full backup scheduler (runs on startup + every 6 hours)
 */
function startAutoBackupScheduler() {
    if (schedulerInterval) return;
    // Run initial startup snapshot asynchronously
    setTimeout(() => {
        createFullDatabaseSettingsBackup('STARTUP').catch(() => {});
    }, 5000);

    schedulerInterval = setInterval(() => {
        createFullDatabaseSettingsBackup('SCHEDULED_6H').catch(() => {});
    }, AUTO_BACKUP_INTERVAL_MS);

    if (schedulerInterval.unref) schedulerInterval.unref();
    console.log('[SettingsBackup] Automatic server settings backup scheduler active (6h interval + pre-write snapshots).');
}

module.exports = {
    createGuildBackup,
    createFullDatabaseSettingsBackup,
    listGuildBackups,
    restoreGuildBackup,
    getAdminBackupOverview,
    startAutoBackupScheduler
};

