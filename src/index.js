require('dotenv').config();

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

const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
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


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.AutoModerationExecution,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember, Partials.ThreadMember]
});

client.commands = new Collection();

// Execute handlers
const commandHandler = require('./handlers/commandHandler');
const eventHandler = require('./handlers/eventHandler');

commandHandler(client);
eventHandler(client);

// Sync database and login with high-stability index handling
sequelize.sync().then(() => {
    console.log('Nora - Database Synchronized (Leveling Indices Healthy)');
    
    // 🛡️ Nora System Persistence (System Backup) - V17.2
    const { systemBackup } = require('./utils/persistence');
    systemBackup();

    // Start autonomous systems
    require('./utils/presence').startPresence();
    require('./utils/voiceTracker').start(client);
    require('./utils/giveawayManager').startGiveawayManager(client);
    
    // Final check for token stability
    client.login(process.env.TOKEN);
}).catch(err => {
    console.error('Nora - Database Connection Failure:', err);
});

// Global Error Handling to prevent the bot from going offline on minor errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

// 🗳️ System Vote HQ Tracker (Webhook Server) & AutoPoster
const { AutoPoster } = require('topgg-autoposter');
const express = require('express');
const Topgg = require('@top-gg/sdk');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;
const { EmbedBuilder } = require('discord.js');
const noraLeveling = require('./utils/noraLeveling');
const GuildSettings = require('./database/models/GuildSettings');
const RobloxVerify = require('./database/models/RobloxVerify');

const webhook = new Topgg.Webhook(process.env.VOTE_SECRET || 'NORA_VOTE_SECRET_2026');
const NORA_SERVER_ID = '1351304498185900184';
const NORA_V0 = process.env.TOPGG_TOKEN || process.env.NORA_V0 || '';

// Enable trust proxy for correct IP identification behind Cloudflare
app.set('trust proxy', true);

// Conceal technology stack
app.disable('x-powered-by');

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 HOST HEADER WHITELIST — Block requests targeting wrong/raw-IP hosts
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_HOSTS = [
    /^(.*\.)?vaztinix\.dev(:\d+)?$/i,
    /^localhost(:\d+)?$/i,
    /^127\.0\.0\.1(:\d+)?$/i,
    /^192\.168\.\d+\.\d+(:\d+)?$/,
    /^10\.\d+\.\d+\.\d+(:\d+)?$/,
    /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(:\d+)?$/
];

// ── EARLY DIAGNOSTIC LOGGER (before all security middleware) ──────────────────
// Logs every single request that reaches the server so we can debug mobile issues
app.use((req, res, next) => {
    const cfIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const host = req.headers.host || 'no-host';
    const origin = req.headers.origin || '-';
    console.log(`[INCOMING] ${req.method} ${req.path} | host=${host} | cf-ip=${cfIp} | origin=${origin} | ua=${(req.headers['user-agent'] || '').slice(0, 80)}`);
    next();
});

app.use((req, res, next) => {
    const host = req.headers.host || '';
    const isAllowedHost = ALLOWED_HOSTS.some(pattern => pattern.test(host));
    if (!isAllowedHost) {
        console.warn(`[HOST_BLOCK] Blocked request with unauthorized Host header: "${host}" from IP ${req.ip}`);
        return res.status(400).end();

    }
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
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // Content Security Policy — applied to HTML page responses
    if (!req.path.startsWith('/api/')) {
        res.setHeader('Content-Security-Policy',
            "default-src 'self' https://discord.com https://cdn.discordapp.com; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "img-src 'self' data: blob: https://cdn.discordapp.com https://*.roblox.com https://thumbnails.roblox.com https://images.unsplash.com https://top.gg; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; " +
            "connect-src 'self' https://discord.com https://api.vaztinix.dev http://localhost:3000 http://127.0.0.1:3000 https://users.roblox.com https://presence.roblox.com https://thumbnails.roblox.com; " +
            "frame-src 'none'; " +
            "object-src 'none';"
        );
    }
    next();
});

// ─────────────────────────────────────────────────────────────────────────────
// 🌐 DYNAMIC CORS ORIGIN VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    /^https:\/\/vaztinix\.github\.io$/,
    /^https:\/\/vaztinix\.dev$/,
    /^https:\/\/.*\.vaztinix\.dev$/,
    /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
    /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,
    /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(:\d+)?$/,
    /^https?:\/\/.*\.local(:\d+)?$/
];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        const isAllowed = ALLOWED_ORIGINS.some(regex => regex.test(origin));
        if (isAllowed) {
            res.header('Access-Control-Allow-Origin', origin);
        } else {
            console.warn(`[CORS_BLOCK] CORS policy blocked origin: ${origin} on path: ${req.path}`);
            return res.status(403).json({ error: 'CORS policy violation: Origin not allowed.' });
        }
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Payload size limit to prevent memory exhaustion/large body attacks (increased to 10mb for base64 image uploads)
app.use(express.json({ limit: '10mb' }));

// In-Memory IP Rate Limiter
const ipRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds
const MAX_REQUESTS_PER_WINDOW = 120; // 120 requests per 10 seconds

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

const ipRateLimiter = (req, res, next) => {
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

app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next();
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

function serveDashboard(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const distPath = path.join(__dirname, '../dist/dashboard.html');
    const webPath  = path.join(__dirname, 'web/dashboard.html');
    const filePath = fs.existsSync(distPath) ? distPath : webPath;

    try {
        let html = fs.readFileSync(filePath, 'utf8');
        // Inject the canonical API URL as the very first script — before any other JS runs
        const injection = `\n<script>window.__NORA_API_BASE_URL__ = '${DASHBOARD_API_BASE}';</script>\n`;
        html = html.replace('</head>', injection + '</head>');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('[Dashboard] Failed to serve dashboard.html:', err.message);
        res.status(500).send('Dashboard unavailable.');
    }
}

app.get(['/dashboard', '/dashboard.html', '/'], serveDashboard);

// Serve static assets (JS, CSS, images) — dashboard.html itself is handled above
app.use(express.static(path.join(__dirname, '../dist')));
app.use(express.static(path.join(__dirname, 'web')));


// Mount the API Router for settings
const settingsRouter = require('./api/routes/settings');
app.use('/api/guilds/:guildId/settings', settingsRouter);

const guildsRouter = require('./api/routes/guilds');
app.use('/api/guilds/:guildId', guildsRouter);

// Studio workspace router (Hosted bots, AI persona & history context)
const studioRouter = require('./api/routes/studio');
app.use('/api/user', studioRouter);
app.use('/api/system', studioRouter);

// Developer / Owner-Only admin router
const adminRouter = require('./api/routes/admin');
app.use('/api/admin', adminRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Nora API is running.' });
});

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

        return session.discordToken;
    }
    return token;
};

const getDiscordUser = async (token) => {
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
            
            // Check if Discord token is still valid
            const discordToken = session.discordToken || token;
            const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${discordToken}` }
            }).catch(() => null);
            if (!userRes) {
                await session.destroy();
                return res.status(401).json({ error: 'Unauthorized' });
            }
            user = userRes.data;
        } else {
            // If the token is a custom session format but not found/expired, reject immediately
            if (token.startsWith('nora_sess_')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            // Fetch user info from Discord using axios
            const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${token}` }
            }).catch(() => null);
            if (!userRes) return res.status(401).json({ error: 'Unauthorized' });
            user = userRes.data;
            
            // GeoIP lookup
            let location = 'Unknown Location';
            try {
                const geo = await axios.get(`http://ip-api.com/json/${clientIp}`, { timeout: 3000 });
                if (geo.data && geo.data.status === 'success') {
                    location = `${geo.data.city || 'Unknown'}, ${geo.data.country || 'Unknown'}`;
                }
            } catch (e) {}
            
            const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
            if (!prefs.sessionGenerationMarker) {
                prefs.sessionGenerationMarker = require('uuid').v4();
                await prefs.save();
            }

            session = await Session.create({
                id: tokenHash,
                userId: user.id,
                ipAddress: clientIp,
                userAgent: req.headers['user-agent'] || 'Unknown',
                location: location,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                sessionGenerationMarker: prefs.sessionGenerationMarker
            });
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
            } catch (e) {}
        }
        user.isOwner = isOwner;

        // Fetch user preferences/badges from DB
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
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
app.post('/api/user/profile', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);
        const UserPrefs = require('./database/models/UserPrefs');
        const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
        
        const { robloxPublic, profilePublic, bio, language, dashboardSettings } = req.body;
        if (robloxPublic !== undefined) prefs.robloxPublic = robloxPublic;
        if (profilePublic !== undefined) prefs.profilePublic = profilePublic;
        if (bio !== undefined) prefs.bio = bio;
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
            code = Math.floor(100000 + Math.random() * 900000).toString();
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
            } catch (e) {}
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
            } catch (e) {}
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
            } catch (e) {}
            
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
        const { getCachedUserGuilds } = require('./api/middleware/auth');
        const guilds = await getCachedUserGuilds(token);
        
        // Filter guilds where user has Administrator (0x8) or Manage Guild (0x20) or is owner
        const filteredGuilds = guilds.filter(g => {
            const perms = BigInt(g.permissions);
            return (perms & BigInt(0x8)) === BigInt(0x8) || (perms & BigInt(0x20)) === BigInt(0x20) || g.owner;
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
        } catch (e) {}
        const APP_OWNER_IDS = ['1214048435632603137', '1366229304257544213'];
        if (APP_OWNER_IDS.includes(user.id)) {
            isUserBotOwner = true;
        }

        const managedGuilds = filteredGuilds.map(g => {
            const hasNora = req.client.guilds.cache.has(g.id);
            const liveGuild = req.client.guilds.cache.get(g.id);
            const settings = settingsMap.get(g.id);

            const isPremiumSettings = settings ? (!!settings.isPremium || !!settings.isManualPremium) : false;
            
            let isOwnerPremium = false;
            if (liveGuild) {
                if (liveGuild.ownerId === '1214048435632603137' || liveGuild.ownerId === '1366229304257544213') {
                    isOwnerPremium = true;
                }
            }
            if (g.owner && isUserBotOwner) {
                isOwnerPremium = true;
            }

            const isPremium = isPremiumSettings || isOwnerPremium;

            return {
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
                hasNora,
                memberCount: liveGuild ? liveGuild.memberCount : 0,
                onlineCount: liveGuild ? liveGuild.presences.cache.filter(p => p.status !== 'offline').size : 0,
                permissions: g.permissions,
                topggVerified: settings ? !!settings.topggVerified : false,
                topggBotId: settings ? settings.topggBotId : null,
                topggLegacyOwnerId: settings ? settings.topggLegacyOwnerId : null,
                isPremium
            };
        });
        
        res.json(managedGuilds);
    } catch (e) {
        handleRouteError(res, e, '/api/user/guilds');
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
                const profileRes = await fetch(`https://users.roblox.com/v1/users/${record.robloxId}`);
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
                const usersRes = await fetch('https://users.roblox.com/v1/users', {
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
                        let groupBindings = [];
                        try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) {}
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

app.post('/api/user/roblox/link', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username' });
    try {
        const user = await getDiscordUser(token);
        
        // Search Roblox API for ID
        const searchRes = await fetch('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
        });
        if (!searchRes.ok) {
            return res.status(500).json({ error: 'Failed to contact Roblox API' });
        }
        const searchData = await searchRes.json();
        if (!searchData.data || searchData.data.length === 0) {
            return res.status(404).json({ error: 'Roblox user not found. Check the username spelling.' });
        }
        const robloxUser = searchData.data[0];
        const code = `Nora-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        const [record] = await RobloxVerify.findOrCreate({ 
            where: { userId: user.id, robloxId: robloxUser.id.toString() }, 
            defaults: { 
                verifyCode: code, 
                status: 'PENDING',
                isActive: false
            } 
        });

        if (record.status !== 'VERIFIED') {
            record.verifyCode = code;
            record.status = 'PENDING';
            await record.save();
        }

        res.json({ success: true, verifyCode: record.verifyCode, status: record.status, linked: true, robloxId: record.robloxId });
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/link');
    }
});

app.post('/api/user/roblox/check', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const { robloxId } = req.body || {};
    try {
        const user = await getDiscordUser(token);
        let record;
        if (robloxId) {
            record = await RobloxVerify.findOne({ where: { userId: user.id, robloxId } });
        } else {
            record = await RobloxVerify.findOne({ where: { userId: user.id, status: 'PENDING' } });
        }
        if (!record) return res.status(404).json({ error: 'Link not initialized' });

        // If robloxId is not numeric, it's a legacy username string. Let's resolve it first.
        if (!/^\d+$/.test(record.robloxId)) {
            const searchRes = await fetch('https://users.roblox.com/v1/usernames/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usernames: [record.robloxId], excludeBannedUsers: true })
            });
            if (searchRes.ok) {
                const searchData = await searchRes.json();
                if (searchData.data && searchData.data.length > 0) {
                    record.robloxId = searchData.data[0].id.toString();
                    await record.save();
                }
            }
        }

        // Fetch Roblox profile to verify description code
        const profileRes = await fetch(`https://users.roblox.com/v1/users/${record.robloxId}`);
        if (!profileRes.ok) {
            return res.status(400).json({ error: 'Failed to fetch Roblox profile for verification. Check that the ID is valid.' });
        }
        const profileData = await profileRes.json();
        const description = profileData.description || '';

        if (description.includes(record.verifyCode)) {
            record.status = 'VERIFIED';
            
            // Check if user has an active verified account. If not, make this active.
            const hasActive = await RobloxVerify.findOne({ where: { userId: user.id, isActive: true, status: 'VERIFIED' } });
            if (!hasActive) {
                record.isActive = true;
            }
            await record.save();

            // Add to UserPrefs.auxiliaryRobloxHandles
            const UserPrefs = require('./database/models/UserPrefs');
            const [prefs] = await UserPrefs.findOrCreate({ where: { userId: user.id } });
            let handles = [];
            try { handles = JSON.parse(prefs.auxiliaryRobloxHandles || '[]'); } catch (e) {}
            if (!handles.includes(record.robloxId)) {
                handles.push(record.robloxId);
                await prefs.update({ auxiliaryRobloxHandles: JSON.stringify(handles) });
            }

            // Sync Roblox roles with backoff
            if (record.isActive) {
                const robloxSystem = require('./utils/robloxSystem');
                const settingsCache = require('./utils/settingsCache');
                for (const guild of client.guilds.cache.values()) {
                    try {
                        const member = await guild.members.fetch(user.id).catch(() => null);
                        if (member) {
                            const settings = await settingsCache.get(guild.id);
                            if (settings && settings.robloxVerifyEnabled) {
                                let groupBindings = [];
                                try { groupBindings = JSON.parse(settings.robloxGroupBindings || '[]'); } catch (e) {}
                                if (groupBindings.length > 0) {
                                    await robloxSystem.syncRobloxRolesWithBackoff(member, record.robloxId, groupBindings);
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`[Roblox API Sync] Guild roles sync failed for guild ${guild.id}:`, err.message);
                    }
                }
            }

            res.json({ success: true, status: 'VERIFIED', robloxId: record.robloxId, robloxUsername: profileData.name });
        } else {
            res.status(400).json({ error: `Verification code "${record.verifyCode}" was not found in your Roblox description.` });
        }
    } catch (e) {
        handleRouteError(res, e, '/api/user/roblox/check');
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
            try { handles = JSON.parse(prefs.auxiliaryRobloxHandles || '[]'); } catch (e) {}
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
                const searchRes = await fetch('https://users.roblox.com/v1/usernames/users', {
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
        
        // 1. Fetch profile details
        let displayName = record.robloxId;
        let username = record.robloxId;
        try {
            const profileRes = await fetch(`https://users.roblox.com/v1/users/${robloxId}`);
            if (profileRes.ok) {
                const profileData = await profileRes.json();
                username = profileData.name;
                displayName = profileData.displayName;
            }
        } catch (e) {
            console.error('Failed to fetch Roblox profile:', e);
        }
        
        // 2. Fetch avatar headshot thumbnail
        let avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxId}&width=150&height=150&format=png`;
        try {
            const avatarRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png&isCircular=false`);
            if (avatarRes.ok) {
                const avatarData = await avatarRes.json();
                if (avatarData.data && avatarData.data.length > 0) {
                    avatarUrl = avatarData.data[0].imageUrl;
                }
            }
        } catch (e) {
            console.error('Failed to fetch Roblox avatar headshot:', e);
        }
        
        // 3. Fetch presence info
        let online = false;
        let status = 'Offline';
        let joinable = false;
        let placeId = null;
        let gameId = null;
        
        try {
            const presenceRes = await fetch('https://presence.roblox.com/v1/presence/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userIds: [parseInt(robloxId)] })
            });
            if (presenceRes.ok) {
                const presenceData = await presenceRes.json();
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
            }
        } catch (e) {
            console.error('Failed to fetch Roblox presence:', e);
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

app.get('/api/user/topgg/bots', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const user = await getDiscordUser(token);

        // Verify that the user is the bot owner
        const APP_OWNER_IDS = [process.env.APP_OWNER_ID || '1214048435632603137', '1366229304257544213'];
        let isOwner = APP_OWNER_IDS.includes(user.id);
        if (!isOwner) {
            try {
                const app = await req.client.application.fetch();
                if (app.owner) {
                    if (app.owner.id === user.id || (app.owner.members && app.owner.members.has(user.id))) {
                        isOwner = true;
                    }
                }
            } catch (e) {}
        }
        if (!isOwner) {
            return res.status(403).json({ error: 'Forbidden: Only the bot owner can configure Top.gg settings.' });
        }

        const url = `https://top.gg/user/${user.id}`;
        const topggRes = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        if (!topggRes.ok) {
            console.error(`Top.gg user profile fetch failed with status ${topggRes.status}`);
            return res.json({ bots: [] });
        }
        
        const html = await topggRes.text();
        const bots = [];
        const seenIds = new Set();
        let index = 0;
        
        while (true) {
            index = html.indexOf('"__typename\\":\\"DiscordBot\\"', index);
            if (index === -1) break;
            
            const startOfObj = html.lastIndexOf('{', index);
            if (startOfObj !== -1) {
                let braceCount = 0;
                let endOfObj = -1;
                for (let i = startOfObj; i < html.length; i++) {
                    if (html[i] === '{') braceCount++;
                    else if (html[i] === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            endOfObj = i;
                            break;
                        }
                    }
                }
                if (endOfObj !== -1) {
                    const rawSlice = html.substring(startOfObj, endOfObj + 1);
                    try {
                        const unescaped = rawSlice
                            .replace(/\\"/g, '"')
                            .replace(/\\\\/g, '\\')
                            .replace(/\\u0026/g, '&');
                        
                        const obj = JSON.parse(unescaped);
                        if (obj.id && obj.name && !seenIds.has(obj.id)) {
                            seenIds.add(obj.id);
                            bots.push({
                                id: obj.id,
                                internalId: obj.internalId || obj.id,
                                username: obj.name,
                                avatar: obj.iconUrl || 'https://top.gg/images/topgg-logo.png'
                            });
                        }
                    } catch (e) {}
                }
            }
            index += 30;
        }
        
        res.json({ bots });
    } catch (e) {
        handleRouteError(res, e, '/api/user/topgg/bots');
    }
});

const getWebFilePath = (filename) => {
    const distPath = path.join(__dirname, '../dist', filename);
    if (fs.existsSync(distPath)) {
        return distPath;
    }
    return path.join(__dirname, 'web', filename);
};

// Serve index.html (Vaztinix Bio landing page) at root '/'
app.get('/', (req, res) => {
    res.sendFile(getWebFilePath('index.html'));
});

// Serve nora.html at '/nora'
app.get('/nora', (req, res) => {
    res.sendFile(getWebFilePath('nora.html'));
});



// Clean URLs for other subpages
app.get('/team', (req, res) => {
    res.sendFile(getWebFilePath('team.html'));
});

app.get('/docs', (req, res) => {
    res.sendFile(getWebFilePath('docs.html'));
});

app.get('/ai', (req, res) => {
    res.sendFile(getWebFilePath('AI.html'));
});
app.get('/ai-studio', (req, res) => {
    res.sendFile(getWebFilePath('ai-studio.html'));
});

const handleTopggWebhook = async (req, res) => {
    try {
        const payload = req.body;
        console.log('[Top.gg Webhook] Received payload:', JSON.stringify(payload));

        const targetId = payload.bot || payload.guild;
        if (!targetId) {
            return res.status(400).json({ error: 'Missing bot or guild ID in payload' });
        }

        const trackingCategory = payload.bot ? 'bot' : 'server';

        // 1. Authorization checks
        const authHeader = req.headers.authorization || '';
        const cleanAuth = authHeader.replace(/^Bearer\s+/i, '').trim();

        // Check legacy main bot webhook token first
        const globalSecret = (process.env.VOTE_SECRET || 'NORA_VOTE_SECRET_2026').trim();
        const isGlobalMatch = cleanAuth === globalSecret;

        // Find connections matching targetId
        const TopggConnection = require('./database/models/TopggConnection');
        const connections = await TopggConnection.findAll({
            where: { targetId, verified: true }
        });

        // Let's also look at req.params.guildId if it was sent to the old guild-specific route
        const guildIdParam = req.params.guildId;
        
        let isValid = false;
        let ownerId = null;

        if (isGlobalMatch) {
            isValid = true;
        } else {
            // Check connections list
            const matchedConnection = connections.find(conn => {
                const connToken = conn.token ? conn.token.replace(/^Bearer\s+/i, '').trim() : '';
                return connToken && cleanAuth === connToken;
            });

            if (matchedConnection) {
                isValid = true;
                ownerId = matchedConnection.ownerId;
            } else if (guildIdParam) {
                // Check if the old route matches the guild's settings auth
                const GuildSettings = require('./database/models/GuildSettings');
                const settings = await GuildSettings.findOne({ where: { guildId: guildIdParam } });
                const cleanSettingsAuth = settings && settings.topggWebhookAuth ? settings.topggWebhookAuth.trim() : '';
                if (cleanSettingsAuth && cleanAuth === cleanSettingsAuth) {
                    isValid = true;
                }
            }
        }

        if (!isValid) {
            console.warn(`[Top.gg Webhook] Unauthorized request received for target: ${targetId}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Return 200 OK immediately to satisfy high-throughput/asynchronous processing constraints
        res.status(200).json({ success: true });

        // Enqueue the vote payload for async processing
        const voteQueue = require('./utils/voteQueue');
        voteQueue.enqueue({
            bot: payload.bot,
            guild: payload.guild,
            user: payload.user,
            type: payload.type || 'upvote',
            isWeekend: !!payload.isWeekend,
            nora_metadata: {
                tracking_category: trackingCategory,
                verified_owner: ownerId || 'legacy'
            }
        });
    } catch (e) {
        console.error('[Top.gg Webhook] Error handling webhook:', e);
        try {
            if (!res.headersSent) res.status(500).json({ error: e.message });
        } catch (err) {}
    }
};

app.post('/v1/webhooks/topgg', handleTopggWebhook);
app.post('/api/v1/webhooks/topgg', handleTopggWebhook);
app.post('/topgg/webhook', handleTopggWebhook);
app.post('/api/webhooks/topgg/:guildId', handleTopggWebhook);

app.get('/install', (req, res) => {
    res.sendFile(getWebFilePath('install.html'));
});

app.get('/legal', (req, res) => {
    res.sendFile(getWebFilePath('legal.html'));
});

// GET /api/logs returns the buffered console output (Owner Only)
// Uses session lookup instead of a live Discord API call to avoid connection hangs on every terminal poll
app.get('/api/logs', async (req, res) => {
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

app.listen(PORT, () => {
    console.log(`[System] Web Dashboard and Webhook listener online at port ${PORT}`);
    
    // Start AutoPoster using the v0 token for statistics
    const ap = AutoPoster(NORA_V0, client);
    ap.on('posted', () => {
        console.log('[Top.gg] Statistics automatically posted.');
    });
});


module.exports = { client };





