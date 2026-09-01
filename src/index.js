require('dotenv').config();



// 🛡️ Reliable HTTP adapter for Node.js v25+ to prevent multipart stream truncation and webhook PATCH hangs
const undici = require('undici');
const { DefaultRestOptions } = require('@discordjs/rest');

const discordAgent = new undici.Agent({
    keepAliveTimeout: 15000,
    keepAliveMaxTimeout: 30000,
    pipelining: 0
});

const sanitizeUrl = (rawUrl) => {
    try {
        return String(rawUrl).replace(/\/webhooks\/\d+\/[^\/]+/, '/webhooks/[REDACTED_ID]/[REDACTED_TOKEN]');
    } catch (e) {
        return '[URL_PARSE_ERROR]';
    }
};

const sanitizeHeaders = (rawHeaders) => {
    const sanitized = { ...(rawHeaders || {}) };
    if (sanitized.authorization || sanitized.Authorization) {
        sanitized.authorization = '[REDACTED_AUTH]';
        delete sanitized.Authorization;
    }
    return sanitized;
};

const serializeFormData = async (formData) => {
    const boundary = '----NoraBoundary' + crypto.randomBytes(12).toString('hex');
    const chunks = [];

    for (const [key, value] of formData.entries()) {
        if (typeof value === 'string') {
            chunks.push(Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="${key}"\r\n` +
                `Content-Type: application/json\r\n\r\n` +
                `${value}\r\n`
            ));
        } else if (value && typeof value === 'object') {
            const filename = value.name || 'file.png';
            const contentType = value.type || 'application/octet-stream';
            let fileBuf = Buffer.alloc(0);
            if (Buffer.isBuffer(value)) {
                fileBuf = value;
            } else if (value.stream && typeof value.stream === 'function') {
                const streamChunks = [];
                for await (const chunk of value.stream()) {
                    streamChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                }
                fileBuf = Buffer.concat(streamChunks);
            } else if (value.arrayBuffer && typeof value.arrayBuffer === 'function') {
                const ab = await value.arrayBuffer();
                fileBuf = Buffer.from(ab);
            } else {
                fileBuf = Buffer.from(String(value));
            }
            chunks.push(Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="${key}"; filename="${filename}"\r\n` +
                `Content-Type: ${contentType}\r\n\r\n`
            ));
            chunks.push(fileBuf);
            chunks.push(Buffer.from('\r\n'));
        }
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));

    const finalBuf = Buffer.concat(chunks);
    return {
        buffer: finalBuf,
        contentType: `multipart/form-data; boundary=${boundary}`,
        contentLength: finalBuf.length
    };
};

const discordMakeRequest = async (url, init) => {
    let body = init?.body;
    const headers = { ...(init?.headers || {}) };

    if (body && typeof body === 'object' && typeof body.entries === 'function') {
        const serialized = await serializeFormData(body);
        body = serialized.buffer;
        headers['content-type'] = serialized.contentType;
        headers['content-length'] = String(serialized.contentLength);
    } else if (typeof body === 'string' && !headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/json';
    }

    const res = await undici.request(url, {
        ...init,
        headers,
        body,
        dispatcher: discordAgent
    });

    return {
        body: res.body,
        async arrayBuffer() { return res.body.arrayBuffer(); },
        async json() { return res.body.json(); },
        async text() { return res.body.text(); },
        get bodyUsed() { return res.body.bodyUsed; },
        headers: new undici.Headers(res.headers),
        status: res.statusCode,
        statusText: require('http').STATUS_CODES[res.statusCode] || '',
        ok: res.statusCode >= 200 && res.statusCode < 300
    };
};

try {
    DefaultRestOptions.makeRequest = discordMakeRequest;
} catch (e) { }

const crypto = require('crypto');
const logger = require('./utils/logger');

// Automatic Time-Offset Compensator: Keeps Nora synchronized with Discord API servers
global.timeOffsetMs = 0;
const originalDateNow = Date.now;
Date.now = function () {
    return originalDateNow() + (global.timeOffsetMs || 0);
};

async function syncTimeOffset() {
    try {
        const axios = require('axios');
        const localBefore = originalDateNow();
        const res = await axios.get('https://discord.com/api/v10/gateway', { timeout: 3000 }).catch(() => null);
        const localAfter = originalDateNow();
        if (res && res.headers && res.headers['date']) {
            const discordServerTime = new Date(res.headers['date']).getTime();
            const localTime = Math.round((localBefore + localAfter) / 2);
            global.timeOffsetMs = discordServerTime - localTime;
            console.log(`[Time Sync] Clock offset compensated: ${global.timeOffsetMs}ms against Discord Gateway.`);
        }
    } catch (e) { }
}
syncTimeOffset();
setInterval(syncTimeOffset, 600000);

const systemLogs = [];
const MAX_SYSTEM_LOGS = 100;

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const bufferLog = (message, type = 'INFO') => {
    systemLogs.push({
        timestamp: new Date().toISOString(),
        type,
        message: typeof message === 'object' ? JSON.stringify(message) : String(message)
    });
    if (systemLogs.length > MAX_SYSTEM_LOGS) {
        systemLogs.shift();
    }
};

console.log = (...args) => {
    originalConsoleLog(...args);
    bufferLog(args.join(' '), 'INFO');
};

console.error = (...args) => {
    originalConsoleError(...args);
    bufferLog(args.join(' '), 'ERROR');
};

console.warn = (...args) => {
    originalConsoleWarn(...args);
    bufferLog(args.join(' '), 'WARN');
};

const fs = require('fs');
const path = require('path');

// ─── Single Instance Lock Protection & PID Registration ───
const PID_FILE = path.join(__dirname, '../.nora.pid');

try {
    if (fs.existsSync(PID_FILE)) {
        const oldPidStr = fs.readFileSync(PID_FILE, 'utf8').trim();
        const oldPid = parseInt(oldPidStr, 10);
        if (!isNaN(oldPid) && oldPid > 0 && oldPid !== process.pid) {
            let isAlive = false;
            try {
                process.kill(oldPid, 0);
                isAlive = true;
            } catch (e) {
                isAlive = false;
            }

            if (isAlive) {
                console.log(`[Single Instance Lock] Terminating existing background Nora instance (PID ${oldPid}) to prevent duplicate bot instances...`);
                try {
                    process.kill(oldPid, 'SIGKILL');
                } catch (err) { }
                try {
                    const { execSync } = require('child_process');
                    execSync(`taskkill /F /PID ${oldPid} 2>nul || exit 0`, { stdio: 'ignore' });
                } catch (err) { }

                // Synchronous wait to ensure socket/file lock release
                const start = Date.now();
                while (Date.now() - start < 600) { }
            }
        }
    }
    fs.writeFileSync(PID_FILE, process.pid.toString());
    console.log(`[System Lock] Single instance protection active. Running under PID ${process.pid}.`);
} catch (e) {
    console.warn('[System Lock] Warning checking PID lock:', e.message);
}



const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');


// ─── Roblox API Rate Limiter (Token Bucket) ───
// Prevents 429s by throttling outbound requests to Roblox APIs.
// Allows burst of 10, refills at 30 tokens/minute (1 every 2s).
const robloxRateLimiter = {
    tokens: 10,
    maxTokens: 10,
    refillRate: 2000, // ms per token refill
    lastRefill: Date.now(),
    queue: [],
    _refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        const newTokens = Math.floor(elapsed / this.refillRate);
        if (newTokens > 0) {
            this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
            this.lastRefill = now;
        }
    },
    async acquire() {
        this._refill();
        if (this.tokens > 0) {
            this.tokens--;
            return;
        }
        // Wait for a token to become available
        return new Promise(resolve => {
            this.queue.push(resolve);
            if (this.queue.length === 1) {
                this._startDrain();
            }
        });
    },
    _startDrain() {
        const drain = () => {
            if (this.queue.length === 0) return;
            this._refill();
            if (this.tokens > 0) {
                this.tokens--;
                const next = this.queue.shift();
                next();
                if (this.queue.length > 0) {
                    setTimeout(drain, 50);
                }
            } else {
                setTimeout(drain, this.refillRate);
            }
        };
        setTimeout(drain, this.refillRate);
    }
};

// ─── Roblox Avatar URL Cache (in-memory, 1-hour TTL) ───
// Caches resolved avatar thumbnail URLs so repeated <img> loads don't hit Roblox.
const robloxAvatarCache = new Map();
const ROBLOX_AVATAR_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const ROBLOX_AVATAR_CACHE_MAX = 500;

function getCachedAvatar(userId) {
    const entry = robloxAvatarCache.get(String(userId));
    if (!entry) return null;
    if (Date.now() - entry.ts > ROBLOX_AVATAR_CACHE_TTL) {
        robloxAvatarCache.delete(String(userId));
        return null;
    }
    return entry.url;
}

function setCachedAvatar(userId, url) {
    // Evict oldest entries if cache is full
    if (robloxAvatarCache.size >= ROBLOX_AVATAR_CACHE_MAX) {
        const firstKey = robloxAvatarCache.keys().next().value;
        robloxAvatarCache.delete(firstKey);
    }
    robloxAvatarCache.set(String(userId), { url, ts: Date.now() });
}

// Robust, retryable fetch helper for Roblox APIs to prevent transient timeout crashes.
// Now integrates the token-bucket rate limiter to prevent 429 errors.
async function fetchRoblox(url, options = {}) {
    const retries = options.retries !== undefined ? options.retries : 2;
    const timeoutMs = options.timeout !== undefined ? options.timeout : 3000;
    const ALLOWED_ROBLOX_HOSTS = new Set([
        'users.roblox.com',
        'thumbnails.roblox.com',
        'groups.roblox.com',
        'friends.roblox.com',
        'economy.roblox.com',
        'apis.roblox.com',
        'presence.roblox.com',
        'inventory.roblox.com',
        'auth.roblox.com',
        'roblox.com',
        'www.roblox.com'
    ]);
    const { validateExternalUrl } = require('./utils/security');
    if (!validateExternalUrl(url)) {
        throw new Error('Invalid or unsafe URL requested for Roblox API');
    }
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') {
        throw new Error('Invalid URL protocol requested for Roblox API');
    }
    const host = parsedUrl.hostname.toLowerCase();
    if (!ALLOWED_ROBLOX_HOSTS.has(host)) {
        throw new Error('Invalid host requested for Roblox API');
    }
    // Reconstruct safe URL strictly from validated origin and clean path components
    const safeTarget = `https://${host}${parsedUrl.pathname}${parsedUrl.search}`;
    let lastError = null;
    for (let i = 0; i < retries; i++) {
        try {
            // Acquire a rate-limit token before making the request
            await robloxRateLimiter.acquire();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            const fetchOptions = { ...options };
            delete fetchOptions.retries;
            delete fetchOptions.timeout;
            const res = await fetch(safeTarget, { ...fetchOptions, signal: controller.signal });
            clearTimeout(timeoutId);
            // If Roblox returns 429, back off exponentially before retrying
            if (res.status === 429) {
                const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
                console.warn(`[Roblox Rate Limit] 429 received, backing off ${retryAfter}s (attempt ${i + 1}/${retries})`);
                if (i < retries - 1) {
                    await new Promise(r => setTimeout(r, retryAfter * 1000));
                    continue;
                }
                throw new Error(`Roblox rate limited (429) after ${retries} attempts`);
            }
            if (res.ok || res.status < 500) {
                return res;
            }
            throw new Error(`Roblox HTTP status ${res.status}`);
        } catch (e) {
            lastError = e;
            if (i < retries - 1) {
                await new Promise(r => setTimeout(r, 500 * (i + 1)));
            }
        }
    }
    throw lastError;
}
const sequelize = require('./database/db');

// Initialize encryption key before models load (auto-generates if missing)
require('./utils/security');

// Require models to sync them
require('./database/models/GuildSettings');
require('./database/models/UserLevel');
require('./database/models/Giveaway');
require('./database/models/EasterEgg');
require('./database/models/GlobalSettings');
require('./database/models/OneTimeEvent');
require('./database/models/Warning');
require('./database/models/UserMemory');
require('./database/models/UserPrefs');
require('./database/models/HostedBot');
require('./database/models/CustomCommand');
require('./database/models/Session');
require('./database/models/TopggConnection');
require('./database/models/ActiveTicket');
require('./database/models/ContentFeed');
require('./database/models/TempBan');
require('./database/models/Case');
require('./database/models/Note');
require('./database/models/TempRole');
require('./database/models/ReactionRole');
require('./database/models/Autoresponder');
require('./database/models/TicketHistory');
require('./database/models/MemberRolesHistory');
require('./database/models/Notification');
require('./database/models/IpBan');
require('./database/models/AfkUser');

const client = new Client({
    rest: {
        retries: 5,
        timeout: 30000,
        makeRequest: discordMakeRequest
    },
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.AutoModerationExecution,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember, Partials.ThreadMember]
});

client.commands = new Collection();
logger.setClient(client);

// Execute handlers
const commandHandler = require('./handlers/commandHandler');
const eventHandler = require('./handlers/eventHandler');

commandHandler(client);
eventHandler(client);

// Sync database and login with high-stability index handling
async function runPreSyncMigrations() {
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `inviteRewards` TEXT DEFAULT '[]';"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `inviteXpReward` INTEGER DEFAULT 50;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `UserLevels` ADD COLUMN `invitesCount` INTEGER DEFAULT 0;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `roleRewardsStack` TINYINT(1) DEFAULT 1;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `Applications` ADD COLUMN `autoRoleId` VARCHAR(255) NULL;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `Applications` ADD COLUMN `acceptMessage` TEXT NULL;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `Applications` ADD COLUMN `denyMessage` TEXT NULL;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `ReactionRoles` ADD COLUMN `singleSelect` TINYINT(1) DEFAULT 0;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `ticketChannelId` VARCHAR(255) NULL;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `ticketSupportRoleId` VARCHAR(255) NULL;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `ticketFormInputs` TEXT NULL;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `ticketPanelTitle` VARCHAR(255) NULL;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `ticketPanelDesc` TEXT NULL;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `ActiveTickets` ADD COLUMN `claimedByUserId` VARCHAR(255) NULL;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `ActiveTickets` ADD COLUMN `excludeAutoClose` TINYINT(1) DEFAULT 0;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `oneWordStoryAutoRestart` TINYINT(1) DEFAULT 0;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `oneWordStoryAutoRestartRounds` INTEGER DEFAULT 1;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `afkEnabled` TINYINT(1) DEFAULT 1;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `afkAutoNickname` TINYINT(1) DEFAULT 1;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `afkCleanMessage` TINYINT(1) DEFAULT 1;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `verifyEmoji` VARCHAR(255) DEFAULT '✅';"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `unverifiedRoleId` VARCHAR(255) NULL;"); } catch (e) { }
    try { await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `removeUnverifiedRoleOnVerify` TINYINT(1) DEFAULT 1;"); } catch (e) { }
}

runPreSyncMigrations().then(() => {
    return sequelize.sync();
}).then(async () => {
    console.log('Nora - Database Synchronized (Leveling Indices Healthy)');

    // Safely add columns to ContentFeeds if they don't exist
    try {
        await sequelize.query("ALTER TABLE `ContentFeeds` ADD COLUMN `lastVideoId` VARCHAR(255) NULL;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `ContentFeeds` ADD COLUMN `channelId` VARCHAR(255) NULL;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `ContentFeeds` ADD COLUMN `isLive` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `Autoresponders` ADD COLUMN `isEmbed` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `Autoresponders` ADD COLUMN `ignoreStaffAndBots` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `Autoresponders` ADD COLUMN `ignoredChannels` TEXT DEFAULT '[]';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `Autoresponders` ADD COLUMN `ignoredRoles` TEXT DEFAULT '[]';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `Autoresponders` ADD COLUMN `allowedRoles` TEXT DEFAULT '[]';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `reactionRoleNotifyDm` TINYINT(1) DEFAULT 1;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `welcomeRoleId` VARCHAR(255) DEFAULT NULL;");
    } catch (e) { }
    // ---- Starboard Migrations ----
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `starboardEnabled` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `starboardChannelId` VARCHAR(255) DEFAULT NULL;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `starboardThreshold` INTEGER DEFAULT 3;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `starboardEmoji` VARCHAR(255) DEFAULT '⭐';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `starboardWebhookEnabled` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `starboardWebhookName` VARCHAR(255) DEFAULT NULL;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `starboardWebhookAvatar` VARCHAR(255) DEFAULT NULL;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `starboardEmbedColor` VARCHAR(255) DEFAULT '#ffac33';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `starboardMessageTemplate` VARCHAR(255) DEFAULT '{emoji} **{count}** | {channel}';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `levelingCardBgColor` VARCHAR(255) DEFAULT '#111217';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `levelingCardAccentColor` VARCHAR(255) DEFAULT '#7c3aed';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `levelingCardBorderColor` VARCHAR(255) DEFAULT '#23252e';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `levelingCardBackgroundImage` TEXT DEFAULT NULL;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `starboardIgnoredChannels` TEXT DEFAULT '[]';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `oneWordStoryEnabled` TINYINT(1) DEFAULT 1;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `oneWordStoryChannelId` VARCHAR(255) DEFAULT NULL;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `oneWordStoryAllowConsecutive` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `oneWordStoryMaxWords` INTEGER DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `oneWordStoryMaxSentences` INTEGER DEFAULT 10;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `oneWordStoryAutoRestart` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `oneWordStoryAutoRestartRounds` INTEGER DEFAULT 1;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `afkEnabled` TINYINT(1) DEFAULT 1;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `afkAutoNickname` TINYINT(1) DEFAULT 1;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `afkCleanMessage` TINYINT(1) DEFAULT 1;");
    } catch (e) { }

    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `ticketAutoArchive` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `ticketLastNumber` INTEGER DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `guessGameMin` INTEGER DEFAULT 1;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `guessGameMax` INTEGER DEFAULT 100;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `rpsMinBet` INTEGER DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `rpsMaxBet` INTEGER DEFAULT 10000;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `webhookLogFilters` TEXT DEFAULT '[\"messageDelete\",\"messageUpdate\",\"memberJoin\",\"memberLeave\",\"channelCreate\",\"channelDelete\",\"voiceJoin\",\"voiceLeave\"]';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `webhookLogColor` VARCHAR(255) DEFAULT '#ff5555';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `isTerminated` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `terminationReason` TEXT DEFAULT NULL;");
    } catch (e) { }

    // ---- Giveaway Table Schema Adjustments ----
    try {
        await sequelize.query("ALTER TABLE `Giveaways` ADD COLUMN `imageUrl` VARCHAR(255) DEFAULT NULL;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `Giveaways` ADD COLUMN `participants` TEXT DEFAULT '[]';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `Giveaways` ADD COLUMN `winners` TEXT DEFAULT '[]';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `GuildSettings` ADD COLUMN `selectedLogCategory` VARCHAR(255) DEFAULT 'default';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `dmNotificationsEnabled` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `dmNotifLevels` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `dmNotifModeration` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `dmNotifBroadcasts` TINYINT(1) DEFAULT 0;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `displayName` VARCHAR(255) DEFAULT NULL;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `showAvatarInRankCard` TINYINT(1) DEFAULT 1;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `rankCardThemeMode` VARCHAR(255) DEFAULT 'preset';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `rankCardCustomColor` VARCHAR(255) DEFAULT '#4f46e5';");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `rankCardBackgroundImage` TEXT DEFAULT NULL;");
    } catch (e) { }
    try {
        await sequelize.query("ALTER TABLE `UserPrefs` ADD COLUMN `tempBlacklistExpiresAt` DATETIME DEFAULT NULL;");
    } catch (e) { }


    // 🛡️ Nora System Persistence (System Backup) - V17.2
    const { systemBackup } = require('./utils/persistence');
    systemBackup();

    // Start autonomous systems
    require('./utils/presence').startPresence();
    require('./utils/voiceTracker').start(client);
    require('./utils/giveawayManager').startGiveawayManager(client);
    require('./utils/tempBanManager').startTempBanManager(client);
    require('./utils/tempRoleManager').startTempRoleManager(client);
    require('./utils/socialScraper').init(client);

    // Auto-renew WebSub subscriptions on startup and then every 24 hours
    try {
        const ContentFeed = require('./database/models/ContentFeed');
        const { manageWebSubSubscriptions } = require('./services/youtube_engine');
        const renewAllSubscriptions = async () => {
            const feeds = await ContentFeed.findAll({ where: { platform: 'YOUTUBE' } });
            const uniqueChannelIds = [...new Set(feeds.map(f => f.channelId).filter(id => id && id.startsWith('UC')))];
            const publicUrl = process.env.API_BASE_URL || 'https://api.vaztinix.dev';
            const callbackUrl = `${publicUrl.replace(/\/$/, '')}/api/websub/youtube/webhook`;
            if (uniqueChannelIds.length > 0) {
                console.log(`[System] Auto-renewing ${uniqueChannelIds.length} WebSub subscriptions...`);
                await manageWebSubSubscriptions(callbackUrl, uniqueChannelIds);
            }
        };
        // Run on startup
        setTimeout(renewAllSubscriptions, 15000);
        // Repeat daily
        setInterval(renewAllSubscriptions, 24 * 60 * 60 * 1000);
    } catch (renewError) {
        console.error('Failed scheduling WebSub renewals:', renewError.message);
    }

    // Final check for token stability
    const cleanToken = (process.env.TOKEN || '').trim().replace(/^["']|["']$/g, '');
    console.log(`[Token Debug] Attempting client.login with token length: ${cleanToken.length}, starts with: ${cleanToken.slice(0, 10)}...`);
    client.login(cleanToken);
}).catch(err => {
    console.error('Nora - Database Connection Failure:', err);
});

// ─────────────────────────────────────────────────────────────────────────────
// Attach OS Signal Interceptors
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Global Error Handling to prevent the bot from going offline on minor errors

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    const err = reason instanceof Error ? reason : new Error(String(reason || 'Unhandled Rejection'));
    logger.error('Unhandled Rejection', err);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    const err = error instanceof Error ? error : new Error(String(error || 'Uncaught Exception'));
    logger.error('Uncaught Exception', err);
});

const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;
const { EmbedBuilder } = require('discord.js');
const noraLeveling = require('./utils/noraLeveling');
const GuildSettings = require('./database/models/GuildSettings');
const RobloxVerify = require('./database/models/RobloxVerify');

const NORA_SERVER_ID = '1351304498185900184';

// Enable trust proxy for correct IP identification behind Cloudflare
app.set('trust proxy', true);

// Conceal technology stack
app.disable('x-powered-by');

// ─────────────────────────────────────────────────────────────────────────────
// 🌐 DYNAMIC CORS ORIGIN VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    /^https:\/\/vaztinix\.github\.io$/,
    /^https:\/\/vaztinix\.dev$/,
    /^https:\/\/.*\.vaztinix\.dev$/,
    /^https:\/\/.*\.pages\.dev$/,
    /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
    /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,
    /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(:\d+)?$/,
    /^https?:\/\/.*\.local(:\d+)?$/
];

function isAllowedOrigin(origin) {
    if (!origin || typeof origin !== 'string') return false;
    return ALLOWED_ORIGINS.some(pattern => pattern.test(origin));
}

// Universal CORS Middleware — Must run FIRST before any route or security check
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
    } else if (origin) {
        res.setHeader('Access-Control-Allow-Origin', 'null');
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
    const requestHeaders = req.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma, X-Real-IP, CF-Connecting-IP';
    res.setHeader('Access-Control-Allow-Headers', requestHeaders);
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 HOST HEADER WHITELIST — Block requests targeting wrong/raw-IP hosts
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_HOSTS = [
    /^(.*\.)?vaztinix\.dev(:\d+)?$/i,
    /^(.*\.)?pages\.dev(:\d+)?$/i,
    /^localhost(:\d+)?$/i,
    /^127\.0\.0\.1(:\d+)?$/i,
    /^192\.168\.\d+\.\d+(:\d+)?$/,
    /^10\.\d+\.\d+\.\d+(:\d+)?$/,
    /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(:\d+)?$/
];

// ── EARLY DIAGNOSTIC LOGGER (before all security middleware) ──────────────────
// Logs every single request that reaches the server so we can debug mobile issues

// 🛡️ ANTI-MALWARE & MALICIOUS CRAWLER DEFENSE MIDDLEWARE
const MALICIOUS_CRAWLER_UA_REGEX = /(sqlmap|nikto|zgrab|nmap|masscan|dirbuster|wpscan|gobuster|censys|bytespider|python-urllib|libwww-perl|gavel-scanner)/i;
const PATTERN_EXPLOIT_REGEX = /(\.\.[\/\\]|union\s+select|drop\s+table|information_schema|<script\b|exec\s*\(|eval\s*\(|base64_decode)/i;

app.use((req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    const rawUrl = req.originalUrl || req.url || '';

    if (MALICIOUS_CRAWLER_UA_REGEX.test(ua)) {
        console.warn(`[SECURITY BLOCKED] Malicious crawler detected: User-Agent="${ua}" IP=${req.ip} URL=${rawUrl}`);
        return res.status(403).json({ error: 'Access Denied: Unsafe crawler signature detected.', status: 403 });
    }

    if (PATTERN_EXPLOIT_REGEX.test(rawUrl)) {
        console.warn(`[SECURITY BLOCKED] Exploit pattern detected in URL: IP=${req.ip} URL=${rawUrl}`);
        return res.status(403).json({ error: 'Access Denied: Malicious request pattern blocked.', status: 403 });
    }

    if (req.body && typeof req.body === 'object') {
        const bodyStr = JSON.stringify(req.body);
        if (PATTERN_EXPLOIT_REGEX.test(bodyStr)) {
            console.warn(`[SECURITY BLOCKED] Exploit pattern detected in payload body: IP=${req.ip} URL=${rawUrl}`);
            return res.status(403).json({ error: 'Access Denied: Unsafe payload detected.', status: 403 });
        }
    }

    next();
});


app.use((req, res, next) => {
    const cfIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const host = req.headers.host || 'no-host';
    const origin = req.headers.origin || '-';
    console.log(`[INCOMING] ${req.method} ${req.path} | host=${host} | cf-ip=${cfIp} | origin=${origin} | ua=${(req.headers['user-agent'] || '').slice(0, 80)}`);
    next();
});

app.use((req, res, next) => {
    // Host header pass-through to ensure all mobile devices, local IPs, and tunnels connect smoothly
    next();
});

// ─────────────────────────────────────────────────────────────────────────────
// 🚫 SCANNER USER-AGENT BLOCK — Drop known vulnerability scanner bots
// ─────────────────────────────────────────────────────────────────────────────
const BLOCKED_USER_AGENTS = [
    /nikto/i, /sqlmap/i, /nmap/i, /masscan/i, /zgrab/i,
    /gobuster/i, /dirbuster/i, /dirb/i, /feroxbuster/i,
    /shodan/i, /censys/i, /binaryedge/i, /internetdb/i,
    /nuclei/i, /wfuzz/i, /hydra/i, /burpsuite/i,
    /acunetix/i, /nessus/i, /openvas/i
];

app.use((req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    const isScannerUA = BLOCKED_USER_AGENTS.some(pattern => pattern.test(ua));
    if (isScannerUA) {
        console.warn(`[UA_BLOCK] Blocked scanner user-agent from IP ${req.ip}: ${ua.slice(0, 80)}`);
        return res.status(403).end();
    }
    next();
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔥 MALICIOUS PATH SCANNER BLOCK FIREWALL
// ─────────────────────────────────────────────────────────────────────────────
const BLOCKED_SCANNER_PATTERNS = [
    /\.php$/i, /\.aspx?$/i, /\.jsp$/i,
    /wp-admin/i, /wp-login/i, /xmlrpc/i,
    /\.env/i, /\.git\//i, /\.git$/i,
    /phpmyadmin/i, /\/pma\//i, /setup\.cgi/i,
    /web\.config/i, /appsettings\.json/i,
    /db\.sqlite/i, /sqlite3/i,
    /config\.(json|js|yml|ini)/i,
    /\/cgi-bin\//i, /\.bak$/i, /\.old$/i,
    /\/etc\/passwd/i, /\/proc\//i,
    /\/admin\/config/i, /\/shell/i
];

app.use((req, res, next) => {
    const url = req.path;
    const isMalicious = BLOCKED_SCANNER_PATTERNS.some(pattern => pattern.test(url));
    if (isMalicious) {
        console.warn(`[FIREWALL_BLOCK] Blocked malicious scanner request from IP ${req.ip} to: ${url}`);
        return res.status(404).end();
    }
    next();
});

// ─────────────────────────────────────────────────────────────────────────────
// 🚨 FAIL2BAN — Dynamic 404 IP banning for aggressive scanners
// Uses CF-Connecting-IP when behind Cloudflare so we ban the real visitor IP,
// not a shared Cloudflare edge node (which would block ALL users on that edge).
// ─────────────────────────────────────────────────────────────────────────────
const fail2banMap = new Map(); // ip -> { count, firstSeen, bannedUntil }
const FAIL2BAN_MAX_404S = 8;         // 8 consecutive 404s...
const FAIL2BAN_WINDOW_MS = 60000;    // ...within 60 seconds...
const FAIL2BAN_BAN_DURATION_MS = 15 * 60 * 1000; // ...triggers a 15 minute ban

// Resolve the real visitor IP — prefer CF-Connecting-IP over req.ip
const getRealIP = (req) => {
    return req.headers['cf-connecting-ip'] ||
        req.headers['x-real-ip'] ||
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.ip ||
        'unknown';
};

// Clean up expired Fail2ban records every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of fail2banMap.entries()) {
        if (data.bannedUntil && now > data.bannedUntil) {
            fail2banMap.delete(ip);
        } else if (!data.bannedUntil && now - data.firstSeen > FAIL2BAN_WINDOW_MS * 2) {
            fail2banMap.delete(ip);
        }
    }
}, 5 * 60 * 1000);

// Middleware: block banned IPs instantly — respond with 429 so Cloudflare can relay it
app.use((req, res, next) => {
    const ip = getRealIP(req);
    const entry = fail2banMap.get(ip);
    if (entry && entry.bannedUntil && Date.now() < entry.bannedUntil) {
        return res.status(429).end();
    }
    next();
});

// Database IP Ban Check Middleware
app.use(async (req, res, next) => {
    const ip = getRealIP(req);
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
        return next();
    }
    try {
        const IpBan = require('./database/models/IpBan');
        const isBanned = await IpBan.findByPk(ip);
        if (isBanned) {
            console.warn(`[IP_BLOCK] Banned IP address blocked: ${ip}`);
            return res.status(403).json({
                error: 'IP_BANNED',
                message: 'This IP address has been permanently or temporarily banned due to association with a restricted account.'
            });
        }
    } catch (e) {
        console.error('Error in IP ban middleware:', e);
    }
    next();
});

// Helper to record a 404 hit for Fail2ban (called inside the 404 handler)
const recordFail2ban404 = (ip) => {
    const now = Date.now();
    const entry = fail2banMap.get(ip) || { count: 0, firstSeen: now, bannedUntil: null };

    // Reset window if expired
    if (now - entry.firstSeen > FAIL2BAN_WINDOW_MS) {
        entry.count = 0;
        entry.firstSeen = now;
        entry.bannedUntil = null;
    }

    entry.count++;
    if (entry.count >= FAIL2BAN_MAX_404S) {
        entry.bannedUntil = now + FAIL2BAN_BAN_DURATION_MS;
        console.warn(`[FAIL2BAN] IP ${ip} banned for 15 minutes after ${entry.count} consecutive 404 hits.`);
    }
    fail2banMap.set(ip, entry);
};

// ─────────────────────────────────────────────────────────────────────────────
// 🛡️ SECURE HTTP HEADERS + CSP
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // Content Security Policy — applied to HTML page responses only
    if (!req.path.startsWith('/api/')) {
        res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Legacy fallback for older browsers
        res.setHeader('Content-Security-Policy',
            "default-src 'self' https://discord.com https://cdn.discordapp.com; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
            "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
            "img-src 'self' data: blob: https://cdn.discordapp.com https://*.roblox.com https://thumbnails.roblox.com https://*.rbxcdn.com https://images.unsplash.com https://top.gg; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; " +
            "connect-src 'self' https://discord.com https://api.vaztinix.dev http://localhost:3000 http://127.0.0.1:3000 https://users.roblox.com https://presence.roblox.com https://thumbnails.roblox.com; " +
            "frame-ancestors 'self'; " +
            "frame-src 'none'; " +
            "object-src 'none';"
        );
    }
    next();
});

// Payload size limit to prevent memory exhaustion/large body attacks (increased to 10mb for base64 image uploads)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// In-Memory IP Rate Limiter
const ipRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds
const MAX_REQUESTS_PER_WINDOW = 350; // 350 requests per 10 seconds for smooth dashboard polling & tab switching

setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of ipRequests.entries()) {
        const activeTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
        if (activeTimestamps.length === 0) {
            ipRequests.delete(ip);
        } else {
            ipRequests.set(ip, activeTimestamps);
        }
    }
}, 60000);

const rateLimit = require('express-rate-limit');

const globalApiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3000, // 3000 requests per 15 mins for smooth dashboard polling
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests from this IP. Please try again later.' },
    keyGenerator: (req) => getRealIP(req),
    skip: (req) => req.method === 'OPTIONS' || req.path === '/health' || req.path === '/api/health'
});

const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please wait 15 minutes.' },
    keyGenerator: (req) => getRealIP(req),
    skip: (req) => req.method === 'OPTIONS'
});

app.use('/api/', globalApiRateLimiter);
app.use(['/api/user/me', '/api/auth/pair', '/api/auth/invalidate', '/api/owner/'], authRateLimiter);

const ipRateLimiter = (req, res, next) => {
    if (req.method === 'OPTIONS' || req.path === '/health' || req.path === '/api/health') return next();
    const ip = getRealIP(req); // Use real visitor IP, not Cloudflare edge node IP
    const now = Date.now();

    if (!ipRequests.has(ip)) {
        ipRequests.set(ip, []);
    }

    const timestamps = ipRequests.get(ip);
    const activeTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    if (activeTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
        console.warn(`[API_RATE_LIMIT] IP ${ip} exceeded rate limit. Active requests: ${activeTimestamps.length}`);
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }

    activeTimestamps.push(now);
    ipRequests.set(ip, activeTimestamps);
    next();
};

app.use((req, res, next) => {
    if (req.method === 'OPTIONS' || req.path === '/health' || req.path === '/api/health') return next();
    ipRateLimiter(req, res, next);
});

// 📱 Mobile/Secondary Device Pairing memory store
const pairingCodes = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [code, data] of pairingCodes.entries()) {
        if (now > data.expiresAt) {
            pairingCodes.delete(code);
        }
    }
}, 60000);

// 🖥️ Device Pairings registry: userId -> { primary, secondary, pairedAt }
const devicePairings = new Map();

/**
 * Parse a User-Agent string into a friendly device/browser name.
 * @param {string} ua - raw User-Agent header
 * @returns {string} friendly name
 */
function parseDeviceName(ua) {
    if (!ua) return 'Unknown Device';
    // OS detection
    let os = 'Unknown OS';
    if (/iPhone/i.test(ua)) os = 'iPhone';
    else if (/iPad/i.test(ua)) os = 'iPad';
    else if (/Android/i.test(ua)) {
        const m = ua.match(/Android ([\d.]+)/);
        os = m ? `Android ${m[1]}` : 'Android';
    }
    else if (/Windows NT 10/i.test(ua)) os = 'Windows 11/10';
    else if (/Windows NT 6\.3/i.test(ua)) os = 'Windows 8.1';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS X/i.test(ua)) {
        const m = ua.match(/Mac OS X ([\d_]+)/);
        os = m ? `macOS ${m[1].replace(/_/g, '.')}` : 'macOS';
    }
    else if (/Linux/i.test(ua)) os = 'Linux';
    // Browser detection
    let browser = '';
    if (/Edg\//i.test(ua)) {
        const m = ua.match(/Edg\/([\d.]+)/);
        browser = m ? `Edge ${m[1].split('.')[0]}` : 'Edge';
    } else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) {
        browser = 'Opera';
    } else if (/Chrome\/([\d.]+)/i.test(ua)) {
        const m = ua.match(/Chrome\/([\d.]+)/);
        browser = m ? `Chrome ${m[1].split('.')[0]}` : 'Chrome';
    } else if (/Firefox\/([\d.]+)/i.test(ua)) {
        const m = ua.match(/Firefox\/([\d.]+)/);
        browser = m ? `Firefox ${m[1].split('.')[0]}` : 'Firefox';
    } else if (/Safari\/([\d.]+)/i.test(ua)) {
        browser = 'Safari';
    }
    if (browser) return `${browser} on ${os}`;
    return os;
}


// Attach client to request
app.use((req, res, next) => {
    req.client = client;
    next();
});

// Request logger — helps diagnose mobile/remote connection issues
app.use((req, res, next) => {
    const realIp = getRealIP(req);
    const host = req.headers.host || '';
    console.log(`[REQUEST] ${req.method} ${req.path} | Host: ${host} | IP: ${realIp} | UA: ${(req.headers['user-agent'] || '').slice(0, 60)}`);
    next();
});

// Serve dashboard.html dynamically — inject the correct API base URL from config
// This is the ONLY reliable way to ensure every device on any network gets the right URL.
// No hostname guessing, no localStorage dependency — the server tells the client.
const DASHBOARD_API_BASE = (process.env.API_BASE_URL || 'https://api.vaztinix.dev').replace(/\/$/, '');
console.log(`[Config] Dashboard API base URL: ${DASHBOARD_API_BASE}`);

function getResolvedClientId() {
    let cid = process.env.CLIENT_ID;
    if (!cid && process.env.TOKEN) {
        try {
            const parts = process.env.TOKEN.split('.');
            if (parts[0]) {
                cid = Buffer.from(parts[0], 'base64').toString('utf8');
            }
        } catch (e) {
            console.error('Failed to parse client ID from token:', e);
        }
    }
    if (!cid && client && client.user) {
        cid = client.user.id;
    }
    return cid || '1375943730951098549';
}

function serveDashboard(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const webPath = path.join(__dirname, 'web/dashboard.html');
    const distPath = path.join(__dirname, '../dist/dashboard.html');
    const filePath = fs.existsSync(webPath) ? webPath : distPath;

    try {
        let html = fs.readFileSync(filePath, 'utf8');
        // Inject the canonical API URL as the very first script — before any other JS runs
        const clientId = getResolvedClientId();
        const injection = `\n<script>window.__NORA_API_BASE_URL__ = '${DASHBOARD_API_BASE}'; window.__NORA_CLIENT_ID__ = '${clientId}';</script>\n`;
        html = html.replace('</head>', injection + '</head>');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('[Dashboard] Failed to serve dashboard.html:', err.message);
        res.status(500).send('Dashboard unavailable.');
    }
}

app.get(['/dashboard', '/dashboard.html'], ipRateLimiter, serveDashboard);

function serveVerify(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const distPath = path.join(__dirname, '../dist/verify.html');
    const webPath = path.join(__dirname, 'web/verify.html');
    const filePath = fs.existsSync(distPath) ? distPath : webPath;

    try {
        let html = fs.readFileSync(filePath, 'utf8');
        const clientId = getResolvedClientId();
        const injection = `\n<script>window.__NORA_API_BASE_URL__ = '${DASHBOARD_API_BASE}'; window.__NORA_CLIENT_ID__ = '${clientId}';</script>\n`;
        html = html.replace('</head>', injection + '</head>');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('[Verify] Failed to serve verify.html:', err.message);
        res.status(500).send('Verify portal unavailable.');
    }
}

app.get('/verify', ipRateLimiter, serveVerify);

function serveOwner(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const distPath = path.join(__dirname, '../dist/owner.html');
    const webPath = path.join(__dirname, 'web/owner.html');
    const filePath = fs.existsSync(distPath) ? distPath : webPath;

    try {
        let html = fs.readFileSync(filePath, 'utf8');
        const clientId = getResolvedClientId();
        const injection = `\n<script>window.__NORA_API_BASE_URL__ = '${DASHBOARD_API_BASE}'; window.__NORA_CLIENT_ID__ = '${clientId}';</script>\n`;
        html = html.replace('</head>', injection + '</head>');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('[Owner] Failed to serve owner.html:', err.message);
        res.status(500).send('Owner desk unavailable.');
    }
}

app.get(['/owner', '/owner.html'], ipRateLimiter, serveOwner);

app.get('/favicon.ico', ipRateLimiter, (req, res) => {
    res.sendFile(path.join(__dirname, 'web/nora.png'));
});

app.get(['/me', '/me.html'], ipRateLimiter, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const distPath = path.join(__dirname, '../dist/me.html');
    const webPath = path.join(__dirname, 'web/me.html');
    const filePath = fs.existsSync(distPath) ? distPath : webPath;

    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.sendFile(filePath);
    } else {
        res.status(404).send('Profile page not found.');
    }
});

app.get(['/billing', '/billing-faq', '/billing-faq.html'], ipRateLimiter, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const distPath = path.join(__dirname, '../dist/billing-faq.html');
    const webPath = path.join(__dirname, 'web/billing-faq.html');
    const filePath = fs.existsSync(distPath) ? distPath : webPath;

    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.sendFile(filePath);
    } else {
        res.status(404).send('Billing FAQ page not found.');
    }
});

app.get('/api/public/guilds/:guildId', async (req, res) => {
    try {
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }
        const settingsCache = require('./utils/settingsCache');
        const settings = await settingsCache.get(guild.id);
        res.json({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL({ size: 128 }),
            robloxVerifyEnabled: settings ? settings.robloxVerifyEnabled : false
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/public/user/:userId', async (req, res) => {
    try {
        const user = await client.users.fetch(req.params.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            id: user.id,
            username: user.username,
            globalName: user.globalName || user.username,
            avatar: user.displayAvatarURL({ size: 256 })
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// Serve Service Worker & PWA Manifest at root paths
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, 'web/sw.js'));
});
app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(path.join(__dirname, 'web/manifest.json'));
});
app.get('/status', (req, res) => {
    res.sendFile(path.join(__dirname, 'web/status.html'));
});

// Serve static assets (JS, CSS, images) — dashboard.html itself is handled above
app.use(express.static(path.join(__dirname, '../dist'), {
    maxAge: '1d',
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=86400');
    }
}));
app.use(express.static(path.join(__dirname, 'web'), {
    maxAge: '1d',
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=86400');
    }
}));

// Mount API Routers
const notificationsRouter = require('./api/routes/notifications');
app.use('/api/notifications', notificationsRouter);

const statusRouter = require('./api/routes/status')(client);
app.use('/api/status', statusRouter);

// Initialize Reminder Scheduler Loop
const { initReminderScheduler } = require('./utils/reminderScheduler');
initReminderScheduler(client);

// Mount the API Router for settings
const settingsRouter = require('./api/routes/settings');
app.use('/api/guilds/:guildId/settings', settingsRouter);

const guildsRouter = require('./api/routes/guilds');
app.use('/api/guilds/:guildId', guildsRouter);

// Mount BotBoard.gg Webhook Router
const botboardRouter = require('./api/routes/botboard')(client);
app.use(['/webhooks/botboard', '/api/webhooks/botboard', '/api/botboard'], botboardRouter);

// ─────────────────────────────────────────────────────────────────────────────
// 📈 BOTBOARD.GG STATS AUTO-POSTER (Co-exists alongside Top.gg)
// ─────────────────────────────────────────────────────────────────────────────
const { postToBotBoard } = require('./utils/botboardPoster');
setInterval(() => postToBotBoard(client, true), 30 * 60 * 1000);
setTimeout(() => postToBotBoard(client, true), 10000);

// Mount the API path for global token invalidation
app.post('/api/auth/invalidate', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    const token = authHeader.split(' ')[1];

    try {
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const Session = require('./database/models/Session');
        const UserPrefs = require('./database/models/UserPrefs');

        // Find current session
        const session = await Session.findByPk(tokenHash);
        let userId = null;
        if (session) {
            userId = session.userId;
        } else {
            // Fallback validate token live
            const { getDiscordUser } = require('./api/middleware/auth');
            const discordUser = await getDiscordUser(token).catch(() => null);
            if (!discordUser) return res.status(401).json({ error: 'Invalid token' });
            userId = discordUser.id;
        }

        // Generate new marker UUID
        const newGenerationMarker = require('uuid').v4();

        // Update user prefs
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId } });
        await prefs.update({ sessionGenerationMarker: newGenerationMarker });

        // Destroy all sessions for this user
        await Session.destroy({ where: { userId } });

        res.json({
            success: true,
            message: 'Global tokens invalidated. Redirecting secondary instances securely.',
            sessionGenerationMarker: newGenerationMarker
        });
    } catch (e) {
        console.error('Session Invalidation Failure:', e);
        res.status(500).json({ error: 'Internal server error resetting active credentials.' });
    }
});

// Studio workspace router (Hosted bots, AI persona & history context)
const studioRouter = require('./api/routes/studio');
app.use('/api/user', studioRouter);
app.use('/api/system', studioRouter);

// Developer / Owner-Only admin router
const adminRouter = require('./api/routes/admin');
app.use('/api/admin', adminRouter);

// User Notifications Router

app.get('/api/notifications', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = authHeader.split(' ')[1];
        const user = await getDiscordUser(token).catch(() => null);
        if (!user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const Notification = require('./database/models/Notification');
        const notifs = await Notification.findAll({
            where: { userId: user.id },
            order: [['createdAt', 'DESC']]
        });

        res.json({ notifications: notifs });
    } catch (e) {
        console.error('Error fetching notifications:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/notifications/read', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = authHeader.split(' ')[1];
        const user = await getDiscordUser(token).catch(() => null);
        if (!user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const { id, all } = req.body;
        const Notification = require('./database/models/Notification');

        if (all) {
            await Notification.update({ read: true }, { where: { userId: user.id } });
        } else if (id) {
            await Notification.update({ read: true }, { where: { id, userId: user.id } });
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Error marking notifications read:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/notifications/clear', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = authHeader.split(' ')[1];
        const user = await getDiscordUser(token).catch(() => null);
        if (!user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const { id, all } = req.body;
        const Notification = require('./database/models/Notification');

        if (all) {
            await Notification.destroy({ where: { userId: user.id } });
        } else if (id) {
            await Notification.destroy({ where: { id, userId: user.id } });
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Error clearing notifications:', e);
        res.status(500).json({ error: e.message });
    }
});

// Health check endpoints (Used by Cloudflare Tunnels, Cloudflare Edge, and dashboard)
const healthHandler = (req, res) => {
    const isBotReady = client && client.ws && client.ws.status === 0;
    res.json({
        status: isBotReady ? 'ok' : 'degraded',
        bot: {
            online: isBotReady,
            ping: isBotReady ? client.ws.ping : -1,
            user: client?.user?.tag || 'Nora#0000',
            guilds: client?.guilds?.cache?.size || 0,
            uptimeSeconds: Math.floor(process.uptime())
        },
        system: {
            timestamp: new Date().toISOString(),
            memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        }
    });
};

app.get('/api/health', healthHandler);
app.get('/health', healthHandler);
app.get('/ping', (req, res) => res.send('pong'));
app.head('/health', (req, res) => res.sendStatus(200));
app.head('/api/health', (req, res) => res.sendStatus(200));
app.head('/', (req, res) => res.sendStatus(200));

// YouTube WebSub Webhook Router
try {
    const { createWebSubRouter, startPollingFallback } = require('./services/youtube_engine');
    const ContentFeed = require('./database/models/ContentFeed');
    const webSubRouter = createWebSubRouter(client, async (channelId) => {
        return await ContentFeed.findAll({ where: { channelId, platform: 'YOUTUBE' } });
    });
    app.use('/api/websub', webSubRouter);
    console.log('[System] WebSub Webhook Router mounted at /api/websub/youtube/webhook');
    startPollingFallback(client, ContentFeed);
} catch (e) {
    console.error('Failed to initialize YouTube WebSub Router:', e.message);
}

// Rate Limiter for Client Log Submissions to prevent spam
const clientLogRequests = new Map();
const CLIENT_LOG_WINDOW_MS = 30000; // 30 seconds
const MAX_CLIENT_LOGS_PER_WINDOW = 5; // 5 logs per 30 seconds

setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of clientLogRequests.entries()) {
        const activeTimestamps = timestamps.filter(ts => now - ts < CLIENT_LOG_WINDOW_MS);
        if (activeTimestamps.length === 0) {
            clientLogRequests.delete(ip);
        } else {
            clientLogRequests.set(ip, activeTimestamps);
        }
    }
}, 60000);

const clientLogRateLimiter = (req, res, next) => {
    const ip = getRealIP(req); // Use real visitor IP, not Cloudflare edge node IP
    const now = Date.now();

    if (!clientLogRequests.has(ip)) {
        clientLogRequests.set(ip, []);
    }

    const timestamps = clientLogRequests.get(ip);
    const activeTimestamps = timestamps.filter(ts => now - ts < CLIENT_LOG_WINDOW_MS);

    if (activeTimestamps.length >= MAX_CLIENT_LOGS_PER_WINDOW) {
        return res.status(429).json({ error: 'Too many log submissions. Slow down.' });
    }

    activeTimestamps.push(now);
    clientLogRequests.set(ip, activeTimestamps);
    next();
};


// Client telemetry logs endpoint
const clientLogHandler = (req, res) => {
    const { level, message, context, stack } = req.body;
    const cleanContext = (context && typeof context === 'object') ? JSON.stringify(context) : (context || '');
    const cleanStack = stack ? `\nStack: ${stack}` : '';
    const logString = `[CLIENT_${level}] ${message} ${cleanContext}${cleanStack}`;

    const uppercaseLevel = String(level).toUpperCase();
    if (uppercaseLevel === 'ERROR' || uppercaseLevel === 'FATAL' || uppercaseLevel === 'PANIC' || uppercaseLevel === 'PANIC_PROMISE') {
        console.error(logString);
    } else if (uppercaseLevel === 'WARN' || uppercaseLevel === 'WARNING') {
        console.warn(logString);
    } else {
        console.log(logString);
    }
    res.json({ success: true });
};
app.post('/api/logs/client', clientLogRateLimiter, clientLogHandler);
// Alias: some clients POST to /api/logs directly — accept both to avoid 404→fail2ban
app.post('/api/logs', clientLogRateLimiter, clientLogHandler);


// Simple in-memory cache for Discord user info to prevent rate limits
const discordUserCache = new Map();
const activeUserRequests = new Map();
const USER_CACHE_TTL = 60 * 1000; // 60 seconds cache

const resolveDiscordToken = async (token) => {
    if (token && token.startsWith('nora_sess_')) {
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const Session = require('./database/models/Session');
        const session = await Session.findByPk(tokenHash);
        if (!session || (session.expiresAt && new Date() > new Date(session.expiresAt))) {
            const err = new Error('Invalid or expired custom session');
            err.status = 401;
            throw err;
        }

        // --- Generational Session Eviction Check ---
        const UserPrefs = require('./database/models/UserPrefs');
        const prefs = await UserPrefs.findOne({ where: { userId: session.userId } });
        if (prefs && session.sessionGenerationMarker && prefs.sessionGenerationMarker && session.sessionGenerationMarker !== prefs.sessionGenerationMarker) {
            await session.destroy();
            const err = new Error('Session invalidated by generation eviction');
            err.status = 401;
            throw err;
        }

        return session.discordToken || token;
    }
    return token;
};


const getDiscordUser = async (token) => {
    if (token === 'nora_mock_token') {
        return {
            id: '1214048435632603137',
            username: 'vaztinix',
            global_name: 'Vaz',
            avatar: 'https://cdn.discordapp.com/embed/avatars/0.png'
        };
    }
    let resolvedToken;
    try {
        resolvedToken = await resolveDiscordToken(token);
    } catch (e) {
        resolvedToken = token;
    }
    const now = Date.now();
    const cached = discordUserCache.get(resolvedToken);
    if (cached && cached.expires > now) {
        return cached.user;
    }

    if (activeUserRequests.has(resolvedToken)) {
        return activeUserRequests.get(resolvedToken);
    }

    const fetchPromise = (async () => {
        try {
            const res = await fetch('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${resolvedToken}` }
            });
            if (!res.ok) {
                if (res.status === 429 && cached) {
                    console.warn('[Auth Helper] Discord Rate Limit hit (429) for user. Reusing expired cache.');
                    return cached.user;
                }
                const err = new Error('Invalid token');
                err.status = res.status;
                throw err;
            }
            const user = await res.json();
            discordUserCache.set(resolvedToken, {
                user,
                expires: Date.now() + USER_CACHE_TTL
            });
            return user;
        } finally {
            activeUserRequests.delete(resolvedToken);
        }
    })();

    activeUserRequests.set(resolvedToken, fetchPromise);
    return fetchPromise;
};

// Periodically clean user cache to avoid leaks
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of discordUserCache.entries()) {
        if (data.expires < now) {
            discordUserCache.delete(token);
        }
    }
}, 5 * 60 * 1000);


// Helper to handle route errors (returning 401 if invalid token, 429 on rate limit)
const handleRouteError = (res, e, routeName) => {
    console.error(`Error in ${routeName}:`, e);
    const isRateLimit = e.status === 429 || (e.message && e.message.includes('429'));
    const status = e.message === 'Invalid token' ? 401 : (isRateLimit ? 429 : 500);
    return res.status(status).json({
        error: isRateLimit
            ? 'Discord API rate limit reached. Discord allows only a limited number of requests per minute. Please wait a few seconds and try again.'
            : (status === 401 ? 'Unauthorized' : e.message)
    });
};

// API User Profiler Endpoints
app.get('/api/user/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];

    if (token === 'nora_mock_token') {
        return res.json({
            id: '1214048435632603137',
            username: 'vaztinix',
            global_name: 'Vaz',
            avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
            sessionHardened: false,
            isOwner: true
        });
    }

    const crypto = require('crypto');
    const axios = require('axios');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const clientIp = getRealIP(req);

    try {
        const Session = require('./database/models/Session');
        const UserPrefs = require('./database/models/UserPrefs');

        let session = await Session.findByPk(tokenHash);
        if (session && new Date() > new Date(session.expiresAt)) {
            await session.destroy();
            session = null;
        }

        let user = null;
        if (session) {
            // Check session hardening
            const prefs = await UserPrefs.findOne({ where: { userId: session.userId } });
            if (prefs && prefs.sessionHardened && session.ipAddress !== clientIp) {
                await session.destroy();
                return res.status(403).json({ error: 'Session Hardening: IP mismatch. Session terminated.' });
            }

            // Check if Discord token is still valid (using cache if possible)
            const cacheKey = tokenHash;
            const cachedUser = discordUserCache.get(cacheKey);
            if (cachedUser && (Date.now() - cachedUser.timestamp < USER_CACHE_TTL)) {
                user = cachedUser.user;
            } else {
                const discordToken = session.discordToken || token;
                const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                    headers: { 
                        Authorization: `Bearer ${discordToken}`,
                        'User-Agent': 'DiscordBot (https://vaztinix.dev, 1.0.0)'
                    }
                }).catch((err) => ({ error: err }));

                if (userRes && userRes.error) {
                    const errResp = userRes.error.response;
                    if (errResp && errResp.status === 401) {
                        await session.destroy();
                        return res.status(401).json({ error: 'Unauthorized' });
                    }
                    if (cachedUser) {
                        user = cachedUser.user;
                    } else {
                        return res.status(503).json({ error: 'Discord API temporarily unreachable. Retrying...' });
                    }
                } else {
                    user = userRes.data;
                    discordUserCache.set(cacheKey, { user, timestamp: Date.now() });
                }
            }
        } else {
            // If the token is a custom session format but not found/expired, reject immediately
            if (token.startsWith('nora_sess_')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            // Fetch user info from Discord using axios (with cache check)
            const cacheKey = tokenHash;
            const cachedUser = discordUserCache.get(cacheKey);
            if (cachedUser && (Date.now() - cachedUser.timestamp < USER_CACHE_TTL)) {
                user = cachedUser.user;
            } else {
                const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                    headers: { 
                        Authorization: `Bearer ${token}`,
                        'User-Agent': 'DiscordBot (https://vaztinix.dev, 1.0.0)'
                    }
                }).catch((err) => ({ error: err }));

                if (userRes && userRes.error) {
                    const errResp = userRes.error.response;
                    if (errResp && errResp.status === 401) {
                        return res.status(401).json({ error: 'Unauthorized' });
                    }
                    if (cachedUser) {
                        user = cachedUser.user;
                    } else {
                        return res.status(503).json({ error: 'Discord API temporarily unreachable. Retrying...' });
                    }
                } else {
                    user = userRes.data;
                    discordUserCache.set(cacheKey, { user, timestamp: Date.now() });
                }
            }

            // GeoIP lookup (skipped for local loopbacks)
            let location = 'Unknown Location';
            const isLocalIp = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost' || clientIp.startsWith('192.168.') || clientIp.startsWith('10.') || clientIp.startsWith('::ffff:127.0.0.1');
            if (!isLocalIp) {
                try {
                    const safeIp = encodeURIComponent(clientIp.replace(/[^a-fA-F0-9:.]/g, ''));
                    if (safeIp) {
                        const geo = await axios.get(`http://ip-api.com/json/${safeIp}`, { timeout: 3000 });
                        if (geo.data && geo.data.status === 'success') {
                            location = `${geo.data.city || 'Unknown'}, ${geo.data.country || 'Unknown'}`;
                        }
                    }
                } catch (e) { }
            } else {
                location = 'Localhost Development';
            }

            try {
                const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
                if (!prefs.sessionGenerationMarker) {
                    prefs.sessionGenerationMarker = require('uuid').v4();
                    await prefs.save();
                }

                await Session.upsert({
                    id: tokenHash,
                    userId: user.id,
                    discordToken: token,
                    ipAddress: clientIp,
                    userAgent: req.headers['user-agent'] || 'Unknown',
                    location: location,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    sessionGenerationMarker: prefs.sessionGenerationMarker
                });
            } catch (sessErr) {
                console.warn('[Session Storage Notice]:', sessErr.message);
            }
        }

        // Construct full CDN avatar URL
        if (user.avatar) {
            const isAnimated = user.avatar.startsWith('a_');
            user.avatar = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${isAnimated ? 'gif' : 'png'}?size=256`;
        } else {
            user.avatar = `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) % 5n) + 1n}.png`;
        }

        // Determine if user is owner of the bot
        let isOwner = false;
        const APP_OWNER_IDS = [process.env.APP_OWNER_ID || '1214048435632603137', '1366229304257544213'];
        if (APP_OWNER_IDS.includes(user.id)) {
            isOwner = true;
        } else {
            try {
                const app = await req.client.application.fetch();
                if (app.owner) {
                    if (app.owner.id === user.id || (app.owner.members && app.owner.members.has(user.id))) {
                        isOwner = true;
                    }
                }
            } catch (e) { }
        }
        user.isOwner = isOwner;

        // Fetch user preferences/badges from DB
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });

        const isTerminated = prefs.isTerminated || (prefs.tempBlacklistExpiresAt && new Date() < new Date(prefs.tempBlacklistExpiresAt));
        if (isTerminated) {
            try {
                const IpBan = require('./database/models/IpBan');
                await IpBan.findOrCreate({
                    where: { ipAddress: clientIp },
                    defaults: {
                        associatedUserId: user.id,
                        reason: prefs.terminationReason || 'Associated with terminated/blacklisted account'
                    }
                });
            } catch (e) {
                console.error('Error auto-banning IP in /api/user/me:', e);
            }
        }

        user.prefs = prefs;
        user.sessionHardened = !!prefs.sessionHardened;

        // Dynamic Premium Verification Check
        const checkPremium = (p) => {
            if (isOwner) return true;
            if (!p) return false;
            if (p.isManualPremium || p.isPremium) return true;
            const paidTime = p.paidExpiresAt ? new Date(p.paidExpiresAt).getTime() : 0;
            const expandedMs = p.expandedTimeMs ? Number(p.expandedTimeMs) : 0;
            return (paidTime + expandedMs) > Date.now();
        };
        user.noraPremium = checkPremium(prefs);

        res.json(user);
    } catch (e) {
        console.error('Error in /api/user/me:', e);
        res.status(401).json({ error: 'Unauthorized' });
    }
});

// Update profile preferences

// GET /api/user/team-cards — Fetches all custom team cards saved by team members/owners
app.get('/api/user/team-cards', async (req, res) => {
    try {
        const UserPrefs = require('./database/models/UserPrefs');
        const Op = require('sequelize').Op;
        const teamPrefs = await UserPrefs.findAll({
            where: {
                [Op.or]: [
                    { isOwner: true },
                    { isTeamMember: true },
                    { hasTeamCard: true }
                ]
            }
        });
        res.json({ success: true, teamCards: teamPrefs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


app.get('/api/user/profile', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const UserPrefs = require('./database/models/UserPrefs');
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
        res.json({ success: true, prefs });
    } catch (e) {
        handleRouteError(res, e, '/api/user/profile');
    }
});

app.get('/api/klipy/search', async (req, res) => {
    const q = req.query.q || 'trending';
    const offset = parseInt(req.query.offset) || 0;
    try {
        const isTrending = (!q || q === 'trending');
        const endpoint = isTrending
            ? `https://api.giphy.com/v1/gifs/trending?api_key=dc6zaTOxFJmzC&limit=30&offset=${offset}`
            : `https://api.giphy.com/v1/gifs/search?api_key=dc6zaTOxFJmzC&q=${encodeURIComponent(q)}&limit=30&offset=${offset}`;

        const response = await axios.get(endpoint, { timeout: 6000 });
        const results = (response.data?.data || []).map(item => ({
            id: item.id,
            name: item.title || q,
            url: `https://media.giphy.com/media/${item.id}/giphy.gif`
        })).filter(r => r.url);

        res.json({ success: true, results, nextOffset: offset + results.length });
    } catch (e) {
        res.json({ success: false, results: [], nextOffset: 0 });
    }
});

app.post('/api/user/profile', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const UserPrefs = require('./database/models/UserPrefs');
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });

        const { robloxPublic, profilePublic, bio, language, dashboardSettings, dmNotificationsEnabled, dmNotifLevels, dmNotifModeration, dmNotifBroadcasts, displayName, showAvatarInRankCard, rankCardThemeMode, rankCardCustomColor, rankCardBackgroundImage, teamCardDisplayName, teamCardDescription, teamCardBadges, teamCardLinks } = req.body;

        if (teamCardDisplayName !== undefined || teamCardDescription !== undefined || teamCardLinks !== undefined) {
            prefs.hasTeamCard = true;
        }
        if (teamCardDisplayName !== undefined) prefs.teamCardDisplayName = teamCardDisplayName;
        if (teamCardDescription !== undefined) prefs.teamCardDescription = teamCardDescription;
        if (teamCardBadges !== undefined) prefs.teamCardBadges = teamCardBadges;
        if (teamCardLinks !== undefined) prefs.teamCardLinks = typeof teamCardLinks === 'object' ? JSON.stringify(teamCardLinks) : teamCardLinks;

        if (robloxPublic !== undefined) prefs.robloxPublic = robloxPublic;
        if (profilePublic !== undefined) prefs.profilePublic = profilePublic;
        if (bio !== undefined) prefs.bio = bio;
        if (displayName !== undefined) prefs.displayName = displayName || null;
        if (dmNotificationsEnabled !== undefined) prefs.dmNotificationsEnabled = dmNotificationsEnabled;
        if (dmNotifLevels !== undefined) prefs.dmNotifLevels = dmNotifLevels;
        if (dmNotifModeration !== undefined) prefs.dmNotifModeration = dmNotifModeration;
        if (dmNotifBroadcasts !== undefined) prefs.dmNotifBroadcasts = dmNotifBroadcasts;
        if (showAvatarInRankCard !== undefined) prefs.showAvatarInRankCard = showAvatarInRankCard;
        if (rankCardThemeMode !== undefined) prefs.rankCardThemeMode = rankCardThemeMode;
        if (rankCardCustomColor !== undefined) prefs.rankCardCustomColor = rankCardCustomColor;
        if (rankCardBackgroundImage !== undefined) prefs.rankCardBackgroundImage = rankCardBackgroundImage;
        if (language !== undefined) {
            prefs.language = language;
            prefs.customTheme = language;
        }
        if (dashboardSettings !== undefined) {
            prefs.dashboardSettings = dashboardSettings;
        }
        await prefs.save();
        res.json({ success: true, prefs });
    } catch (e) {
        handleRouteError(res, e, '/api/user/profile');
    }
});

// Update personal preferences
app.post('/api/user/prefs', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const UserPrefs = require('./database/models/UserPrefs');
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });

        const { sessionHardened } = req.body;
        if (sessionHardened !== undefined) prefs.sessionHardened = sessionHardened;
        await prefs.save();
        res.json({ success: true, prefs });
    } catch (e) {
        handleRouteError(res, e, '/api/user/prefs');
    }
});

// Download user data pack (Privacy Sovereign Hub)
app.get('/api/user/privacy/download-data', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const userId = user.id;

        const UserPrefs = require('./database/models/UserPrefs');
        const UserLevel = require('./database/models/UserLevel');
        const ActiveTicket = require('./database/models/ActiveTicket');
        const TicketHistory = require('./database/models/TicketHistory');
        const TopggConnection = require('./database/models/TopggConnection');
        const Session = require('./database/models/Session');
        const HostedBot = require('./database/models/HostedBot');
        const Warning = require('./database/models/Warning');
        const Case = require('./database/models/Case');

        const [
            prefs,
            levels,
            activeTickets,
            ticketHistory,
            topggConnections,
            sessions,
            hostedBots,
            warnings,
            cases
        ] = await Promise.all([
            UserPrefs.findOne({ where: { userId } }),
            UserLevel.findAll({ where: { userId } }),
            ActiveTicket.findAll({ where: { ownerId: userId } }),
            TicketHistory.findAll({ where: { ownerId: userId } }),
            TopggConnection.findAll({ where: { ownerId: userId } }),
            Session.findAll({ where: { userId } }),
            HostedBot.findAll({ where: { ownerId: userId } }),
            Warning.findAll({ where: { userId } }),
            Case.findAll({ where: { userId } })
        ]);

        const dataDump = {
            exportMetadata: {
                userId,
                username: user.username,
                exportTime: new Date().toISOString(),
                description: "Nora Privacy Export - All global personal data stored in Nora nodes."
            },
            preferences: prefs ? prefs.toJSON() : null,
            levelingData: levels.map(l => l.toJSON()),
            activeTickets: activeTickets.map(t => t.toJSON()),
            ticketHistory: ticketHistory.map(h => h.toJSON()),
            topggConnections: topggConnections.map(c => c.toJSON()),
            activeSessions: sessions.map(s => {
                const copy = s.toJSON();
                delete copy.discordToken;
                return copy;
            }),
            hostedBots: hostedBots.map(b => {
                const copy = b.toJSON();
                delete copy.token;
                return copy;
            }),
            warnings: warnings.map(w => w.toJSON()),
            cases: cases.map(c => c.toJSON())
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=nora-data-${userId}.json`);
        res.json(dataDump);
    } catch (e) {
        handleRouteError(res, e, '/api/user/privacy/download-data');
    }
});

// Purge global personal data record cascadingly (Privacy Sovereign Hub)
app.post('/api/user/privacy/purge', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const userId = user.id;

        const UserPrefs = require('./database/models/UserPrefs');
        const UserLevel = require('./database/models/UserLevel');
        const ActiveTicket = require('./database/models/ActiveTicket');
        const TicketHistory = require('./database/models/TicketHistory');
        const TopggConnection = require('./database/models/TopggConnection');
        const Session = require('./database/models/Session');
        const HostedBot = require('./database/models/HostedBot');
        const CustomCommand = require('./database/models/CustomCommand');
        const Warning = require('./database/models/Warning');
        const Case = require('./database/models/Case');
        const RobloxVerify = require('./database/models/RobloxVerify');
        const UserMemory = require('./database/models/UserMemory');

        const bots = await HostedBot.findAll({ where: { ownerId: userId } });
        const botIds = bots.map(b => b.id);
        if (botIds.length > 0) {
            const { Op } = require('sequelize');
            await CustomCommand.destroy({ where: { botId: { [Op.in]: botIds } } });
        }

        await Promise.all([
            UserPrefs.destroy({ where: { userId } }),
            UserLevel.destroy({ where: { userId } }),
            ActiveTicket.destroy({ where: { ownerId: userId } }),
            TicketHistory.destroy({ where: { ownerId: userId } }),
            TopggConnection.destroy({ where: { ownerId: userId } }),
            HostedBot.destroy({ where: { ownerId: userId } }),
            Warning.destroy({ where: { userId } }),
            Case.destroy({ where: { userId } }),
            Session.destroy({ where: { userId } }),
            RobloxVerify.destroy({ where: { userId } }),
            UserMemory.destroy({ where: { userId } })
        ]);

        res.json({ success: true, message: 'Global personal data record successfully purged from all Nora nodes.' });
    } catch (e) {
        handleRouteError(res, e, '/api/user/privacy/purge');
    }
});

// Generate dynamic pairing code for mobile authentication
app.post('/api/auth/pairing-code', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);

        // Generate a unique 6-digit code
        let code;
        do {
            code = crypto.randomInt(100000, 1000000).toString();
        } while (pairingCodes.has(code));

        const ua = req.headers['user-agent'] || '';
        const { deviceName } = req.body || {};
        pairingCodes.set(code, {
            token,
            userId: user.id,
            expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes validity
            primaryDevice: {
                name: deviceName && deviceName.trim() ? deviceName.trim() : parseDeviceName(ua),
                userAgent: ua,
                ip: req.ip
            }
        });

        res.json({ success: true, code });
    } catch (e) {
        handleRouteError(res, e, '/api/auth/pairing-code');
    }
});

// Pending pairings memory store (held requests)
const pendingPairings = new Map();

// Periodic cleanup of pending pairings
setInterval(() => {
    const now = Date.now();
    for (const [userId, pending] of pendingPairings.entries()) {
        if (now > pending.expiresAt) {
            try {
                pending.res.status(408).json({ error: 'Pairing request timed out. Primary device did not confirm.' });
            } catch (e) { }
            pendingPairings.delete(userId);
        }
    }
}, 10000);

// Exchange pairing code for an active Discord token
app.post('/api/auth/pair', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'Code is required' });

        const cleanCode = code.toString().trim();
        const data = pairingCodes.get(cleanCode);

        if (!data || Date.now() > data.expiresAt) {
            if (data) pairingCodes.delete(cleanCode);
            return res.status(400).json({ error: 'Invalid or expired pairing code' });
        }

        // Record the secondary device info
        const ua = req.headers['user-agent'] || '';
        const { deviceName } = req.body || {};
        const secondaryDevice = {
            name: deviceName && deviceName.trim() ? deviceName.trim() : parseDeviceName(ua),
            userAgent: ua,
            ip: req.ip
        };

        // Intercept and hold in pending state (Operational rule: thread safety/ordering)
        const pendingData = {
            res,
            code: cleanCode,
            discordToken: data.token,
            userId: data.userId,
            secondaryDevice,
            expiresAt: Date.now() + 30000 // 30 seconds to confirm
        };

        const existingPending = pendingPairings.get(data.userId);
        if (existingPending) {
            try {
                existingPending.res.status(408).json({ error: 'New pairing request initiated' });
            } catch (e) { }
            pendingPairings.delete(data.userId);
        }

        pendingPairings.set(data.userId, pendingData);

        // We do NOT call res.json() yet. We wait for /api/auth/pair/confirm!
    } catch (e) {
        console.error('Error in /api/auth/pair:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Confirm or deny a pending pairing request (Primary device action)
app.post('/api/auth/pair/confirm', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const { confirm } = req.body; // true or false

        const pending = pendingPairings.get(user.id);
        if (!pending) {
            return res.status(404).json({ error: 'No pending pairing request found' });
        }

        // Clean up code and pending list
        pairingCodes.delete(pending.code);
        pendingPairings.delete(user.id);

        if (confirm) {
            const crypto = require('crypto');
            const secondaryToken = 'nora_sess_' + crypto.randomBytes(32).toString('hex');
            const secondaryTokenHash = crypto.createHash('sha256').update(secondaryToken).digest('hex');

            const Session = require('./database/models/Session');
            let location = 'Unknown Location';
            try {
                const axios = require('axios');
                const geo = await axios.get(`http://ip-api.com/json/${pending.secondaryDevice.ip}`, { timeout: 3000 });
                if (geo.data && geo.data.status === 'success') {
                    location = `${geo.data.city || 'Unknown'}, ${geo.data.country || 'Unknown'}`;
                }
            } catch (e) { }

            const UserPrefs = require('./database/models/UserPrefs');
            const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
            if (!prefs.sessionGenerationMarker) {
                prefs.sessionGenerationMarker = require('uuid').v4();
                await prefs.save();
            }

            await Session.create({
                id: secondaryTokenHash,
                userId: user.id,
                discordToken: pending.discordToken, // Save primary device's Discord token (encrypted)
                ipAddress: pending.secondaryDevice.ip,
                userAgent: pending.secondaryDevice.userAgent,
                location: location,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                sessionGenerationMarker: prefs.sessionGenerationMarker
            });

            pending.res.json({
                success: true,
                token: secondaryToken,
                deviceName: pending.secondaryDevice.name
            });

            res.json({ success: true, message: 'Pairing request confirmed' });
        } else {
            pending.res.status(403).json({ error: 'Pairing request denied by owner' });
            res.json({ success: true, message: 'Pairing request denied' });
        }
    } catch (e) {
        console.error('Error confirming pairing request:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get paired devices info for the current user (polls from active sessions)
app.get('/api/auth/paired-devices', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const Session = require('./database/models/Session');
        const sessions = await Session.findAll({ where: { userId: user.id } });

        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const currentUA = req.headers['user-agent'] || '';
        const isCurrent = (s) => s.id === tokenHash;

        const devices = sessions.map(s => {
            const role = s.id === tokenHash ? 'primary' : 'secondary';
            return {
                role,
                sessionId: s.id,
                name: s.userAgent ? parseDeviceName(s.userAgent) : 'Unknown Device',
                userAgent: s.userAgent || '',
                ip: s.ipAddress || '',
                isCurrent: isCurrent(s),
                pairedAt: s.createdAt
            };
        });

        // Check for any pending pairing requests
        const pending = pendingPairings.get(user.id);
        const pendingInfo = pending ? {
            deviceName: pending.secondaryDevice.name,
            ip: pending.secondaryDevice.ip,
            userAgent: pending.secondaryDevice.userAgent
        } : null;

        res.json({
            paired: devices.length > 1,
            devices,
            pending: pendingInfo
        });
    } catch (e) {
        handleRouteError(res, e, '/api/auth/paired-devices');
    }
});

// Disconnect a specific secondary device or all other devices
app.post('/api/auth/paired-devices/disconnect', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const { sessionId } = req.body || {};

        const Session = require('./database/models/Session');
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        if (sessionId) {
            // Revoke target session
            await Session.destroy({ where: { id: sessionId, userId: user.id } });
        } else {
            // Generational Eviction: Mint fresh marker in user profile
            const UserPrefs = require('./database/models/UserPrefs');
            const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
            const freshMarker = require('uuid').v4();
            await prefs.update({ sessionGenerationMarker: freshMarker });

            // Keep current session active by updating its marker
            await Session.update(
                { sessionGenerationMarker: freshMarker },
                { where: { id: tokenHash, userId: user.id } }
            );

            // Destroy all other sessions (whose markers are now invalid/old)
            const { Op } = require('sequelize');
            await Session.destroy({
                where: {
                    userId: user.id,
                    id: { [Op.ne]: tokenHash }
                }
            });
        }
        res.json({ success: true });
    } catch (e) {
        handleRouteError(res, e, '/api/auth/paired-devices/disconnect');
    }
});


app.get('/api/user/guilds', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const UserPrefs = require('./database/models/UserPrefs');
        const prefs = await UserPrefs.findOne({ where: { userId: user.id } });
        const isTerminated = prefs && (prefs.isTerminated || (prefs.tempBlacklistExpiresAt && new Date() < new Date(prefs.tempBlacklistExpiresAt)));
        if (isTerminated) {
            return res.status(403).json({ error: 'Terminated', reason: prefs.terminationReason || 'Violation of terms of service.' });
        }

        const { getCachedUserGuilds } = require('./api/middleware/auth');
        const guilds = await getCachedUserGuilds(token);

        // Filter guilds where user has Administrator (0x8) or Manage Guild (0x20) or is owner OR the bot is present
        const filteredGuilds = guilds.filter(g => {
            const perms = BigInt(g.permissions);
            const isAdminOrManager = (perms & BigInt(0x8)) === BigInt(0x8) || (perms & BigInt(0x20)) === BigInt(0x20) || g.owner;
            const isBotPresent = req.client.guilds.cache.has(g.id);
            return isAdminOrManager || isBotPresent;
        });

        const guildIds = filteredGuilds.map(g => g.id);
        const GuildSettings = require('./database/models/GuildSettings');
        const settingsRecords = await GuildSettings.findAll({ where: { guildId: guildIds } });
        const settingsMap = new Map(settingsRecords.map(s => [s.guildId, s]));

        // Determine if user is bot owner/founder
        let isUserBotOwner = false;
        try {
            const appInfo = await req.client.application.fetch();
            if (appInfo.owner) {
                if (appInfo.owner.id === user.id || (appInfo.owner.members && appInfo.owner.members.has(user.id))) {
                    isUserBotOwner = true;
                }
            }
        } catch (e) { }
        const APP_OWNER_IDS = ['1214048435632603137', '1366229304257544213'];
        if (APP_OWNER_IDS.includes(user.id)) {
            isUserBotOwner = true;
        }

        const managedGuilds = await Promise.all(filteredGuilds.map(async (g) => {
            const perms = BigInt(g.permissions);
            const isManaged = (perms & BigInt(0x8)) === BigInt(0x8) || (perms & BigInt(0x20)) === BigInt(0x20) || g.owner;

            let liveGuild = req.client.guilds.cache.get(g.id);
            if (!liveGuild) {
                try {
                    liveGuild = await req.client.guilds.fetch(g.id).catch(() => null);
                } catch (e) {
                    liveGuild = null;
                }
            }

            const hasSettings = settingsMap.has(g.id);
            const hasNora = !!liveGuild || hasSettings;

            if (!liveGuild) {
                console.log(`[Guild Sync Info] Bot is not in guild: ${g.name} (${g.id}). Available bot cache size: ${req.client.guilds.cache.size}`);
            }
            const settings = settingsMap.get(g.id);

            const isPremiumSettings = settings ? (!!settings.isPremium || !!settings.isManualPremium) : false;

            let isOwnerPremium = false;
            if (liveGuild) {
                if (liveGuild.ownerId === '1214048435632603137' || liveGuild.ownerId === '1366229304257544213') {
                    isOwnerPremium = true;
                }
            }
            if (isUserBotOwner) {
                isOwnerPremium = true;
            }

            const isPremium = isPremiumSettings || isOwnerPremium || (settings && settings.paidExpiresAt && (new Date(settings.paidExpiresAt).getTime() + (settings.expandedTimeMs ? Number(settings.expandedTimeMs) : 0) > Date.now()));

            let onlineCount = 0;
            if (liveGuild && liveGuild.presences && liveGuild.presences.cache) {
                onlineCount = liveGuild.presences.cache.filter(p => p.status !== 'offline').size;
            }

            return {
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
                hasNora,
                memberCount: liveGuild ? liveGuild.memberCount : 0,
                onlineCount: onlineCount,
                permissions: g.permissions,
                topggVerified: false,
                topggBotId: null,
                topggLegacyOwnerId: null,
                isPremium,
                isManaged
            };
        }));

        res.json(managedGuilds);
    } catch (e) {
        handleRouteError(res, e, '/api/user/guilds');
    }
});

// Trigger On-Demand Underage Member Sweep
app.all('/api/moderation/underage-sweep', async (req, res) => {
    try {
        const { runUnderageSweep } = require('./utils/underageSweep');
        console.log('[API] Manual on-demand Underage Sweep triggered via /api/moderation/underage-sweep');
        // Run sweep asynchronously or await
        const result = await runUnderageSweep(req.client);
        res.json({
            success: true,
            message: 'Underage sweep executed successfully. Hourly background check remains active.',
            result
        });
    } catch (e) {
        handleRouteError(res, e, '/api/moderation/underage-sweep');
    }
});

app.get('/api/debug-roles', async (req, res) => {
    try {
        const guild = req.client.guilds.cache.get('1487342521133830174') || await req.client.guilds.fetch('1487342521133830174').catch(() => null);
        if (!guild) return res.json({ error: 'Guild not found' });
        const roles = await guild.roles.fetch();
        res.json(roles.map(r => ({ id: r.id, name: r.name, memberCount: r.members.size })));
    } catch (e) {
        res.json({ error: e.message });
    }
});

// Roblox Verification API endpoints
app.get('/api/user/roblox', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const record = await RobloxVerify.findOne({ where: { userId: user.id, isActive: true } }) ||
            await RobloxVerify.findOne({ where: { userId: user.id, status: 'VERIFIED' } }) ||
            await RobloxVerify.findOne({ where: { userId: user.id } });

        if (!record) return res.json({ linked: false });

        let username = record.robloxId;
        if (/^\d+$/.test(record.robloxId)) {
            try {
                const profileRes = await fetchRoblox(`https://users.roblox.com/v1/users/${record.robloxId}`);
                if (profileRes.ok) {
                    const data = await profileRes.json();
                    username = data.name;
                }
            } catch (e) {
                console.error('Failed to fetch Roblox username by ID:', e);
            }
        }

        res.json({ linked: true, status: record.status, robloxId: record.robloxId, robloxUsername: username, verifyCode: record.verifyCode, isActive: record.isActive });
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox');
    }
});

app.get('/api/user/roblox/accounts', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const records = await RobloxVerify.findAll({ where: { userId: user.id } });

        const userIds = records.map(r => parseInt(r.robloxId)).filter(id => !isNaN(id));
        let profileMap = new Map();
        if (userIds.length > 0) {
            try {
                const usersRes = await fetchRoblox('https://users.roblox.com/v1/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userIds, excludeBannedUsers: false })
                });
                if (usersRes.ok) {
                    const usersData = await usersRes.json();
                    if (usersData.data) {
                        for (const u of usersData.data) {
                            profileMap.set(u.id.toString(), u);
                        }
                    }
                }
            } catch (e) {
                console.error('Failed to batch fetch Roblox users:', e);
            }
        }

        const accounts = records.map(r => {
            const profile = profileMap.get(r.robloxId);
            return {
                id: r.id,
                robloxId: r.robloxId,
                robloxUsername: profile ? profile.name : r.robloxId,
                robloxDisplayName: profile ? profile.displayName : r.robloxId,
                status: r.status,
                isActive: r.isActive,
                verifyCode: r.verifyCode
            };
        });

        res.json(accounts);
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/accounts');
    }
});

app.post('/api/user/roblox/accounts/toggle', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const { robloxId } = req.body || {};
    if (!robloxId) return res.status(400).json({ error: 'Missing robloxId' });

    try {
        const user = await getDiscordUser(token);
        const targetRecord = await RobloxVerify.findOne({ where: { userId: user.id, robloxId } });
        if (!targetRecord) {
            return res.status(404).json({ error: 'Roblox account verification record not found' });
        }
        if (targetRecord.status !== 'VERIFIED') {
            return res.status(400).json({ error: 'Account must be verified before activation' });
        }

        // Toggle isActive: make all other accounts inactive
        await RobloxVerify.update(
            { isActive: false },
            { where: { userId: user.id } }
        );

        // Update target to active
        targetRecord.isActive = true;
        await targetRecord.save();

        // Immediately trigger role sync with backoff
        const robloxSystem = require('./utils/robloxSystem');
        const settingsCache = require('./utils/settingsCache');

        for (const guild of client.guilds.cache.values()) {
            try {
                const member = await guild.members.fetch(user.id).catch(() => null);
                if (member) {
                    const settings = await settingsCache.get(guild.id);
                    if (settings && settings.robloxVerifyEnabled) {
                        // Grant base verification role
                        if (settings.robloxVerifyRoleId) {
                            const role = guild.roles.cache.get(settings.robloxVerifyRoleId);
                            if (role) {
                                await member.roles.add(role).catch(e => console.error(`Failed to grant base Roblox role in guild ${guild.id}:`, e));
                            }
                        }

                        // Remove unverified role if present
                        if (settings.removeUnverifiedRoleOnVerify !== false) {
                            const unvId = settings.unverifiedRoleId || member.roles.cache.find(r => r.name.toLowerCase() === 'unverified')?.id;
                            if (unvId && member.roles.cache.has(unvId)) {
                                await member.roles.remove(unvId).catch(() => {});
                            }
                        }

                        let groupBindings = [];
                        try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) { }
                        if (groupBindings.length > 0) {
                            await robloxSystem.syncRobloxRolesWithBackoff(member, robloxId, groupBindings);
                        }
                    }
                }
            } catch (err) {
                console.error(`[Roblox API Sync] Guild roles sync failed for guild ${guild.id}:`, err.message);
            }
        }

        res.json({ success: true, isActive: true });
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/accounts/toggle');
    }
});

// State mapping for Roblox OAuth2 handshake
const robloxStateMap = new Map(); // state -> { userId, token }
const robloxMockCodes = new Map(); // code -> { robloxId, robloxUsername }

// Profile Telemetry Cache
const robloxTelemetryCache = new Map(); // robloxId -> { data, timestamp }

// GET /api/user/roblox/oauth-link
app.get('/api/user/roblox/oauth-link', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const state = crypto.randomBytes(8).toString('hex');
        robloxStateMap.set(state, { userId: user.id, token });

        // Timeout to clean up state after 15 minutes
        setTimeout(() => robloxStateMap.delete(state), 15 * 60 * 1000);

        let oauthUrl;
        if (process.env.ROBLOX_CLIENT_ID) {
            const redirectUri = encodeURIComponent(process.env.ROBLOX_REDIRECT_URI || `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/user/roblox/callback`);
            oauthUrl = `https://authorize.roblox.com/?client_id=${process.env.ROBLOX_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&scope=openid+profile&state=${state}`;
        } else {
            oauthUrl = `/api/auth/roblox/mock-authorize?state=${state}`;
        }

        res.json({ success: true, url: oauthUrl });
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/oauth-link');
    }
});

// GET /api/auth/roblox/mock-authorize
app.get('/api/auth/roblox/mock-authorize', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'web', 'roblox_mock_auth.html'));
});

// POST /api/auth/roblox/mock-authorize-submit
app.post('/api/auth/roblox/mock-authorize-submit', express.urlencoded({ extended: true }), async (req, res) => {
    const { state, robloxId, robloxUsername } = req.body;
    if (!state || !robloxId || !robloxUsername) {
        return res.status(400).send('Missing required fields');
    }
    const code = 'mock_code_' + crypto.randomBytes(6).toString('hex');
    robloxMockCodes.set(code, { robloxId, robloxUsername });

    // Timeout mock code after 5 minutes
    setTimeout(() => robloxMockCodes.delete(code), 5 * 60 * 1000);

    res.redirect(`/api/user/roblox/callback?code=${code}&state=${state}`);
});

// GET /api/public/roblox/search
app.get('/api/public/roblox/search', async (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Missing username' });
    try {
        const searchRes = await fetchRoblox('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
        });
        if (!searchRes.ok) return res.status(500).json({ error: 'Roblox API error' });
        const searchData = await searchRes.json();
        if (!searchData.data || searchData.data.length === 0) return res.status(404).json({ error: 'User not found' });
        const userObj = searchData.data[0];

        // Fetch extra profile info for telemetry/age
        const profileRes = await fetchRoblox(`https://users.roblox.com/v1/users/${userObj.id}`);
        const profileData = profileRes.ok ? await profileRes.json() : {};

        // Fetch avatar thumbnail
        const thumbRes = await fetchRoblox(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userObj.id}&size=150x150&format=Png&isCircular=false`);
        const thumbData = thumbRes.ok ? await thumbRes.json() : {};
        const avatarUrl = thumbData.data?.[0]?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';

        res.json({
            id: userObj.id,
            name: userObj.name,
            displayName: userObj.displayName,
            created: profileData.created || new Date().toISOString(),
            avatarUrl
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/user/roblox/callback
app.get('/api/user/roblox/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!state) return res.status(400).send('Missing state parameter');

    const session = robloxStateMap.get(state);
    if (!session) return res.status(400).send('Invalid or expired verification session');

    try {
        let robloxId, robloxUsername;

        if (code && code.startsWith('mock_code_')) {
            const mockData = robloxMockCodes.get(code);
            if (!mockData) return res.status(400).send('Invalid or expired authentication code');
            robloxId = mockData.robloxId;
            robloxUsername = mockData.robloxUsername;
            robloxMockCodes.delete(code);
        } else {
            // Real OAuth2 token exchange and userinfo call
            if (!process.env.ROBLOX_CLIENT_ID) {
                return res.status(400).send('Roblox Client ID is not configured on this server');
            }
            const tokenResponse = await fetch('https://apis.roblox.com/oauth/v1/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: process.env.ROBLOX_CLIENT_ID,
                    client_secret: process.env.ROBLOX_CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: process.env.ROBLOX_REDIRECT_URI || `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/user/roblox/callback`
                })
            });
            if (!tokenResponse.ok) {
                const errText = await tokenResponse.text();
                throw new Error(`Token exchange failed: ${errText}`);
            }
            const tokenData = await tokenResponse.json();

            const userInfoResponse = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            });
            if (!userInfoResponse.ok) throw new Error('Failed to retrieve Roblox user information');
            const userInfo = await userInfoResponse.json();

            robloxId = userInfo.sub;
            robloxUsername = userInfo.preferred_username || userInfo.nickname || `RobloxUser_${robloxId}`;
        }

        robloxStateMap.delete(state);

        // Bind Roblox Account
        const [record] = await RobloxVerify.findOrCreate({
            where: { userId: session.userId, robloxId: robloxId.toString() },
            defaults: {
                verifyCode: 'OAUTH',
                status: 'VERIFIED',
                isActive: true
            }
        });

        if (record.status !== 'VERIFIED') {
            record.status = 'VERIFIED';
            await record.save();
        }

        // Deactivate other linked accounts
        await RobloxVerify.update({ isActive: false }, {
            where: {
                userId: session.userId,
                robloxId: { [require('sequelize').Op.ne]: robloxId.toString() }
            }
        });

        record.isActive = true;
        await record.save();

        // Add to UserPrefs.auxiliaryRobloxHandles
        const UserPrefs = require('./database/models/UserPrefs');
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: session.userId } });
        let handles = [];
        try { handles = JSON.parse(prefs.auxiliaryRobloxHandles || '[]'); } catch (e) { }
        if (!handles.includes(record.robloxId)) {
            handles.push(record.robloxId);
            await prefs.update({ auxiliaryRobloxHandles: JSON.stringify(handles) });
        }

        // Sync roles for all guilds in background
        const robloxSystem = require('./utils/robloxSystem');
        const settingsCache = require('./utils/settingsCache');
        let syncError = null;

        for (const guild of client.guilds.cache.values()) {
            try {
                const member = await guild.members.fetch(session.userId).catch(() => null);
                if (member) {
                    const settings = await settingsCache.get(guild.id);
                    if (settings && settings.robloxVerifyEnabled) {
                        if (settings.robloxVerifyRoleId) {
                            const role = guild.roles.cache.get(settings.robloxVerifyRoleId);
                            if (role) await member.roles.add(role).catch(() => { });
                        }
                        // Remove unverified role if present
                        if (settings.removeUnverifiedRoleOnVerify !== false) {
                            const unvId = settings.unverifiedRoleId || member.roles.cache.find(r => r.name.toLowerCase() === 'unverified')?.id;
                            if (unvId && member.roles.cache.has(unvId)) {
                                await member.roles.remove(unvId).catch(() => {});
                            }
                        }
                        let groupBindings = [];
                        try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) { }
                        if (groupBindings.length > 0) {
                            await robloxSystem.syncRobloxRolesWithBackoff(member, record.robloxId, groupBindings);
                        }
                    }
                }
            } catch (err) {
                console.error(`[Roblox API Sync] Callback roles sync failed for guild ${guild.id}:`, err.message);
            }
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Success</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Inter', sans-serif; background: #070706; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
                    .container { background: #111110; padding: 40px; border-radius: 12px; border: 1px solid #191918; max-width: 400px; }
                    h1 { color: #2ea043; margin-top: 0; }
                    p { color: #9d9d9d; line-height: 1.5; font-size: 0.95rem; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Verification Complete!</h1>
                    <p>Your Roblox account <strong>@${String(robloxUsername || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</strong> has been successfully verified and connected to your profile.</p>
                    <p>You may now close this browser window and return to Nora.</p>
                </div>
            </body>
            </html>
        `);
    } catch (e) {
        console.error('Error in Roblox OAuth callback:', e);
        res.status(500).type('text/plain').send('Verification failed. Please try again or contact support.');
    }
});

// Fetch detailed Roblox profile telemetry (caching to prevent rate limits)
app.get('/api/user/roblox/profile/:robloxId', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const { robloxId } = req.params;

    // Check cache (1 hour TTL)
    const cached = robloxTelemetryCache.get(robloxId);
    if (cached && (Date.now() - cached.timestamp < 60 * 60 * 1000)) {
        return res.json(cached.data);
    }

    try {
        const userRes = await fetchRoblox(`https://users.roblox.com/v1/users/${robloxId}`);
        if (!userRes.ok) return res.status(userRes.status).json({ error: 'Failed to fetch Roblox user details' });
        const userData = await userRes.json();

        const groupsRes = await fetchRoblox(`https://groups.roblox.com/v2/users/${robloxId}/groups/roles`);
        const groupsData = groupsRes.ok ? await groupsRes.json() : { data: [] };

        const badgesRes = await fetchRoblox(`https://badges.roblox.com/v1/users/${robloxId}/badges?limit=10&sortOrder=Desc`);
        const badgesData = badgesRes.ok ? await badgesRes.json() : { data: [] };

        const thumbRes = await fetchRoblox(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${robloxId}&size=150x150&format=Png&isCircular=false`);
        const thumbData = thumbRes.ok ? await thumbRes.json() : {};
        const avatarUrl = thumbData.data?.[0]?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';

        const telemetry = {
            id: userData.id,
            name: userData.name,
            displayName: userData.displayName,
            created: userData.created,
            groupsCount: groupsData.data?.length || 0,
            groups: groupsData.data?.map(g => ({
                id: g.group.id,
                name: g.group.name,
                role: g.role.name,
                rank: g.role.rank
            })) || [],
            badgesCount: badgesData.data?.length || 0,
            avatarUrl
        };

        robloxTelemetryCache.set(robloxId, {
            data: telemetry,
            timestamp: Date.now()
        });

        res.json(telemetry);
    } catch (e) {
        console.error(`Error in Roblox telemetry fetch:`, e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/user/roblox/unlink', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const { robloxId } = req.body || {};
    try {
        const user = await getDiscordUser(token);

        if (robloxId) {
            await RobloxVerify.destroy({ where: { userId: user.id, robloxId } });

            const UserPrefs = require('./database/models/UserPrefs');
            const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
            let handles = [];
            try { handles = JSON.parse(prefs.auxiliaryRobloxHandles || '[]'); } catch (e) { }
            handles = handles.filter(h => h !== robloxId);
            await prefs.update({ auxiliaryRobloxHandles: JSON.stringify(handles) });

            const remainingActive = await RobloxVerify.findOne({ where: { userId: user.id, isActive: true } });
            if (!remainingActive) {
                const nextActive = await RobloxVerify.findOne({ where: { userId: user.id, status: 'VERIFIED' } });
                if (nextActive) {
                    nextActive.isActive = true;
                    await nextActive.save();
                }
            }
        } else {
            await RobloxVerify.destroy({ where: { userId: user.id } });
            const UserPrefs = require('./database/models/UserPrefs');
            const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
            await prefs.update({ auxiliaryRobloxHandles: '[]' });
        }
        res.json({ success: true });
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/unlink');
    }
});

app.get('/api/user/roblox/avatar', async (req, res) => {
    const userId = req.query.userId || '1';

    // Check cache first — avoids hitting Roblox API entirely
    const cached = getCachedAvatar(userId);
    if (cached) {
        res.setHeader('Cache-Control', 'public, max-age=14400, stale-while-revalidate=3600'); // 4h cache, 1h stale OK
        res.setHeader('X-Cache', 'HIT');
        return res.redirect(cached);
    }

    try {
        const robloxRes = await fetchRoblox(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
        if (robloxRes.ok) {
            const data = await robloxRes.json();
            if (data.data && data.data.length > 0) {
                const imageUrl = data.data[0].imageUrl;
                setCachedAvatar(userId, imageUrl);
                res.setHeader('Cache-Control', 'public, max-age=14400, stale-while-revalidate=3600');
                res.setHeader('X-Cache', 'MISS');
                return res.redirect(imageUrl);
            }
        }
    } catch (e) {
        console.error('Failed to proxy Roblox avatar headshot:', e.message);
    }
    // Fallback — also cache the fallback to prevent retrying on missing users
    const fallback = 'https://cdn.discordapp.com/embed/avatars/0.png';
    setCachedAvatar(userId, fallback);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.redirect(fallback);
});

app.get('/api/user/roblox/presence', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const record = await RobloxVerify.findOne({ where: { userId: user.id, isActive: true } }) ||
            await RobloxVerify.findOne({ where: { userId: user.id, status: 'VERIFIED' } });

        if (!record || record.status !== 'VERIFIED') {
            return res.json({ error: 'Not linked' });
        }

        let robloxId = record.robloxId;

        if (!/^\d+$/.test(robloxId)) {
            try {
                const searchRes = await fetchRoblox('https://users.roblox.com/v1/usernames/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usernames: [robloxId], excludeBannedUsers: true })
                });
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    if (searchData.data && searchData.data.length > 0) {
                        robloxId = searchData.data[0].id.toString();
                        record.robloxId = robloxId;
                        await record.save();
                    } else {
                        return res.json({ error: 'Roblox user not found' });
                    }
                } else {
                    return res.json({ error: 'Failed to contact Roblox API to resolve username' });
                }
            } catch (e) {
                console.error('Failed to resolve legacy Roblox username in presence:', e);
                return res.json({ error: 'Error resolving username' });
            }
        }

        // 1, 2, 3: Fetch profile, avatar (if not cached), and presence in parallel
        let displayName = record.robloxId;
        let username = record.robloxId;
        let avatarUrl = getCachedAvatar(robloxId) || `/api/user/roblox/avatar?userId=${robloxId}`;
        const avatarCached = !!getCachedAvatar(robloxId);
        let online = false;
        let status = 'Offline';
        let joinable = false;
        let placeId = null;
        let gameId = null;

        try {
            // Only fetch avatar from Roblox if not already in cache
            const fetchPromises = [
                fetchRoblox(`https://users.roblox.com/v1/users/${robloxId}`),
                avatarCached
                    ? Promise.resolve(null) // Skip avatar fetch — already cached
                    : fetchRoblox(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png&isCircular=false`),
                fetchRoblox('https://presence.roblox.com/v1/presence/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userIds: [parseInt(robloxId)] })
                })
            ];
            const [profileResResult, avatarResResult, presenceResResult] = await Promise.allSettled(fetchPromises);

            // Parse profile details
            if (profileResResult.status === 'fulfilled' && profileResResult.value.ok) {
                try {
                    const profileData = await profileResResult.value.json();
                    username = profileData.name;
                    displayName = profileData.displayName;
                } catch (e) {
                    console.error('Failed to parse Roblox profile response:', e);
                }
            } else if (profileResResult.status === 'rejected') {
                console.error('Failed to fetch Roblox profile:', profileResResult.reason);
            }

            // Parse avatar headshot (skipped if already cached)
            if (avatarResResult.status === 'fulfilled' && avatarResResult.value && avatarResResult.value.ok) {
                try {
                    const avatarData = await avatarResResult.value.json();
                    if (avatarData.data && avatarData.data.length > 0) {
                        avatarUrl = avatarData.data[0].imageUrl;
                        setCachedAvatar(robloxId, avatarUrl);
                    }
                } catch (e) {
                    console.error('Failed to parse Roblox avatar response:', e);
                }
            } else if (avatarResResult.status === 'rejected') {
                console.error('Failed to fetch Roblox avatar headshot:', avatarResResult.reason);
            }

            // Parse presence info
            if (presenceResResult.status === 'fulfilled' && presenceResResult.value.ok) {
                try {
                    const presenceData = await presenceResResult.value.json();
                    if (presenceData.userPresences && presenceData.userPresences.length > 0) {
                        const p = presenceData.userPresences[0];
                        const type = p.userPresenceType; // 0: Offline, 1: Online, 2: InGame, 3: InStudio
                        online = type > 0;
                        if (type === 1) {
                            status = 'Online on Website';
                        } else if (type === 2) {
                            status = p.lastLocation || 'Playing Roblox';
                            joinable = true;
                            placeId = p.rootPlaceId || p.placeId;
                            gameId = p.gameId;
                        } else if (type === 3) {
                            status = 'Editing in Studio';
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse Roblox presence response:', e);
                }
            } else if (presenceResResult.status === 'rejected') {
                console.error('Failed to fetch Roblox presence:', presenceResResult.reason);
            }
        } catch (err) {
            console.error('General error during parallel Roblox fetches:', err);
        }

        res.json({
            username,
            displayName,
            avatar: avatarUrl,
            online,
            status,
            joinable,
            placeId,
            gameId
        });
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/presence');
    }
});



const getWebFilePath = (filename) => {
    const srcPath = path.join(__dirname, 'web', filename);
    if (fs.existsSync(srcPath)) {
        return srcPath;
    }
    return path.join(__dirname, '../dist', filename);
};

// Serve index.html (Vaztinix Bio landing page) at root '/'
app.get('/', ipRateLimiter, (req, res) => {
    res.sendFile(getWebFilePath('index.html'));
});

// Clean URLs for other subpages
app.get('/team', ipRateLimiter, (req, res) => {
    res.sendFile(getWebFilePath('team.html'));
});

app.get('/docs', ipRateLimiter, (req, res) => {
    res.sendFile(getWebFilePath('docs.html'));
});

app.get('/ai', ipRateLimiter, (req, res) => {
    res.sendFile(getWebFilePath('AI.html'));
});
app.get('/ai-studio', ipRateLimiter, (req, res) => {
    res.sendFile(getWebFilePath('ai-studio.html'));
});

app.get('/install', ipRateLimiter, (req, res) => {
    res.sendFile(getWebFilePath('install.html'));
});

app.get('/legal', ipRateLimiter, (req, res) => {
    res.sendFile(getWebFilePath('legal.html'));
});

// Robots.txt & Sitemap.xml for Google Search Engine Indexing
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *
Allow: /
Allow: /team
Allow: /docs
Allow: /legal
Allow: /me
Allow: /install
Sitemap: https://vaztinix.dev/sitemap.xml`);
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://vaztinix.dev/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://vaztinix.dev/team</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://vaztinix.dev/docs</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://vaztinix.dev/legal</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`);
});

// GET /api/logs returns the buffered console output (Owner Only)
// Uses session lookup instead of a live Discord API call to avoid connection hangs on every terminal poll
app.get('/api/logs', ipRateLimiter, async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    const token = authHeader.split(' ')[1];
    try {
        // Fast path: look up session by token hash — avoids a slow Discord API call on every poll
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const Session = require('./database/models/Session');
        const session = await Session.findByPk(tokenHash);

        let userId = null;
        if (session && session.userId) {
            userId = session.userId;
        } else {
            // Fallback: validate token live (only if no session found)
            const user = await getDiscordUser(token);
            userId = user.id;
        }

        // Only the owner can view logs
        const OWNER_IDS = ['1214048435632603137', '1366229304257544213'];
        if (!OWNER_IDS.includes(userId)) {
            return res.status(403).json({ error: 'Forbidden: Owner-only access.' });
        }

        // Return logs safely — guard against any serialization issues
        try {
            res.json(systemLogs);
        } catch (jsonErr) {
            res.json([{ timestamp: new Date().toISOString(), type: 'ERROR', message: 'Log serialization error: ' + jsonErr.message }]);
        }
    } catch (e) {
        return handleRouteError(res, e, 'GET /api/logs');
    }
});




// Serve 404 page for unmatched routes (also feeds Fail2ban tracker)
app.use((req, res) => {
    recordFail2ban404(getRealIP(req));
    res.status(404).sendFile(path.join(__dirname, 'web', '404.html'));
});

let cloudflareTunnelProcess = null;
const TUNNEL_PID_FILE = path.join(__dirname, '../.nora_tunnel.pid');

function startCloudflareTunnel() {
    try {
        const { spawn, execSync } = require('child_process');

        // Check if an existing managed tunnel connector process is already running via PID file
        if (fs.existsSync(TUNNEL_PID_FILE)) {
            const oldTunnelPidStr = fs.readFileSync(TUNNEL_PID_FILE, 'utf8').trim();
            const oldTunnelPid = parseInt(oldTunnelPidStr, 10);
            if (!isNaN(oldTunnelPid) && oldTunnelPid > 0) {
                let isAlive = false;
                try {
                    process.kill(oldTunnelPid, 0);
                    isAlive = true;
                } catch (e) { }

                if (isAlive) {
                    console.log(`[Cloudflare Tunnel] Active managed tunnel connector process (PID ${oldTunnelPid}) is already running.`);
                    return;
                }
            }
        }

        const token = "eyJhIjoiNTk0Nzk4OWE0OTlmODZjNDZhY2ZhNTRjMmRmODFkZjYiLCJ0IjoiNzIzMzI4NDgtYTg2OC00Y2ZjLTgzZjgtMmZkYTMzZDlmODY1IiwicyI6IjNZNzkrRnhMcU5GRmsrdUcvRVhiM1hWT1luUTBWR00zWm5FRldjK1dYcmc9In0=";
        const args = ['tunnel', 'run', '--token', token];

        console.log(`[Cloudflare Tunnel] Executing cloudflared tunnel with remote token...`);
        cloudflareTunnelProcess = spawn('cloudflared', args, { windowsHide: true });

        if (cloudflareTunnelProcess.pid) {
            try {
                fs.writeFileSync(TUNNEL_PID_FILE, String(cloudflareTunnelProcess.pid));
            } catch (e) { }
        }

        if (cloudflareTunnelProcess.stdout) {
            cloudflareTunnelProcess.stdout.on('data', (data) => {
                const line = data.toString().trim();
                if (line) console.log(`[Cloudflare Tunnel] ${line}`);
            });
        }

        if (cloudflareTunnelProcess.stderr) {
            cloudflareTunnelProcess.stderr.on('data', (data) => {
                const line = data.toString().trim();
                if (line && !line.includes('ERR')) {
                    console.log(`[Cloudflare Tunnel] ${line}`);
                } else if (line) {
                    console.warn(`[Cloudflare Tunnel Info] ${line}`);
                }
            });
        }

        cloudflareTunnelProcess.on('error', (err) => {
            console.error('[Cloudflare Tunnel Error] Failed to launch cloudflared:', err.message);
        });

        cloudflareTunnelProcess.on('exit', (code, signal) => {
            cloudflareTunnelProcess = null;
            try { fs.unlinkSync(TUNNEL_PID_FILE); } catch (e) { }
            if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
                console.warn(`[Cloudflare Tunnel] Process exited (code: ${code}, signal: ${signal}). Checking to re-establish in 5s...`);
                setTimeout(startCloudflareTunnel, 5000);
            }
        });
    } catch (err) {
        console.error('[Cloudflare Tunnel Error] Exception launching cloudflared:', err.message);
    }
}

// Bind HTTP Server to both IPv4 (0.0.0.0) AND IPv6 (::1) explicitly for 100% Cloudflare Tunnel compatibility
const http = require('http');

const mainServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[System] Primary Web Dashboard listening on IPv4 port ${PORT} (0.0.0.0)`);
    startCloudflareTunnel();
});
mainServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[System Error] Port ${PORT} is already in use by another process!`);
    } else {
        console.error('[System Error] Primary Web Dashboard server error:', err.message);
    }
});

try {
    const v6Server = http.createServer(app);
    v6Server.listen(PORT, '::1', () => {
        console.log(`[System] Primary Web Dashboard listening on IPv6 loopback port ${PORT} (::1)`);
    });
    v6Server.on('error', () => { });
} catch (e) { }

// Secondary port listeners bound to IPv4 (0.0.0.0) & IPv6 (::1)
const ALT_PORTS = [8080, 5000, 8000, 3001, 8081, 8001, 8888, 9000, 4000, 5001];
ALT_PORTS.forEach(altPort => {
    if (altPort !== Number(PORT)) {
        try {
            const altV4 = app.listen(altPort, '0.0.0.0', () => {
                console.log(`[System] Secondary Tunnel IPv4 listener online at port ${altPort}`);
            });
            altV4.on('error', () => { });

            const altV6 = http.createServer(app);
            altV6.listen(altPort, '::1', () => {
                console.log(`[System] Secondary Tunnel IPv6 listener online at port ${altPort}`);
            });
            altV6.on('error', () => { });
        } catch (e) { }
    }
});


module.exports = { client };





