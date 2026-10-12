const fs = require('fs');
const path = require('path');
const dgram = require('dgram');

/**
 * 📺 Nora Roku Smart TV Hardware Integration
 * External Control Protocol (ECP) over HTTP port 8060.
 * 
 * STRICT ACCESS CONTROL:
 * Only Authorized Developer ID (1214048435632603137) has execution rights.
 */
const AUTHORIZED_USER_ID = '1214048435632603137';
const WHITELISTED_GUILD_IDS = ['1487342521133830174', '1515800329889779954'];
const CONFIG_FILE_PATH = path.join(__dirname, '..', 'database', 'rokuConfig.json');

// Well-known standard Roku App IDs
const KNOWN_APPS = {
    'youtube': { id: '837', name: 'YouTube' },
    'yt': { id: '837', name: 'YouTube' },
    'youtube tv': { id: '195316', name: 'YouTube TV' },
    'youtubetv': { id: '195316', name: 'YouTube TV' },
    'netflix': { id: '12', name: 'Netflix' },
    'hulu': { id: '2285', name: 'Hulu' },
    'disney': { id: '291097', name: 'Disney+' },
    'disney+': { id: '291097', name: 'Disney+' },
    'disney plus': { id: '291097', name: 'Disney+' },
    'prime': { id: '13', name: 'Prime Video' },
    'prime video': { id: '13', name: 'Prime Video' },
    'amazon': { id: '13', name: 'Prime Video' },
    'amazon video': { id: '13', name: 'Prime Video' },
    'amazon prime': { id: '13', name: 'Prime Video' },
    'spotify': { id: '22297', name: 'Spotify' },
    'max': { id: '61322', name: 'Max' },
    'hbo': { id: '61322', name: 'Max' },
    'hbo max': { id: '61322', name: 'Max' },
    'hbomax': { id: '61322', name: 'Max' },
    'twitch': { id: '102146', name: 'Twitch' },
    'crunchyroll': { id: '2595', name: 'Crunchyroll' },
    'plex': { id: '13535', name: 'Plex' },
    'apple tv': { id: '551012', name: 'Apple TV' },
    'apple': { id: '551012', name: 'Apple TV' },
    'appletv': { id: '551012', name: 'Apple TV' },
    'apple tv+': { id: '551012', name: 'Apple TV' },
    'peacock': { id: '593099', name: 'Peacock' },
    'peacock tv': { id: '593099', name: 'Peacock' },
    'paramount': { id: '31440', name: 'Paramount+' },
    'paramount+': { id: '31440', name: 'Paramount+' },
    'paramount plus': { id: '31440', name: 'Paramount+' },
    'roku channel': { id: '151908', name: 'The Roku Channel' },
    'the roku channel': { id: '151908', name: 'The Roku Channel' },
    'tubi': { id: '41468', name: 'Tubi' },
    'tubi tv': { id: '41468', name: 'Tubi' },
    'pluto': { id: '74519', name: 'Pluto TV' },
    'pluto tv': { id: '74519', name: 'Pluto TV' },
    'sling': { id: '46041', name: 'Sling TV' },
    'sling tv': { id: '46041', name: 'Sling TV' },
    'espn': { id: '34376', name: 'ESPN' },
    'espn+': { id: '34376', name: 'ESPN' },
    'espn plus': { id: '34376', name: 'ESPN' },
    'freevee': { id: '622419', name: 'Amazon Freevee' },
    'fubo': { id: '39129', name: 'FuboTV' },
    'fubotv': { id: '39129', name: 'FuboTV' },
    'philo': { id: '179048', name: 'Philo' },
    'vudu': { id: '13842', name: 'Fandango at Home (Vudu)' },
    'fandango': { id: '13842', name: 'Fandango at Home (Vudu)' },
    'discovery': { id: '614745', name: 'Discovery+' },
    'discovery+': { id: '614745', name: 'Discovery+' },
    'discovery plus': { id: '614745', name: 'Discovery+' },
    'amc': { id: '156434', name: 'AMC+' },
    'amc+': { id: '156434', name: 'AMC+' },
    'starz': { id: '88393', name: 'STARZ' },
    'pandora': { id: '28', name: 'Pandora' },
    'iheart': { id: '21783', name: 'iHeartRadio' },
    'iheartradio': { id: '21783', name: 'iHeartRadio' },
    'emby': { id: '42714', name: 'Emby' },
    'jellyfin': { id: '659424', name: 'Jellyfin' },
    'weather': { id: '42427', name: 'The Weather Channel' },
    'weather channel': { id: '42427', name: 'The Weather Channel' }
};

class RokuController {
    constructor() {
        const cfg = this.loadConfig();
        this.ip = (process.env.ROKU_IP && process.env.ROKU_IP.trim()) || cfg.ip || '192.168.1.100';
        this.port = 8060;
        this.guestAccess = cfg.guestAccess || {};
        this.lastKnownDeviceInfo = null;
        this.installedAppsCache = null;
        this.lastAppCacheTime = 0;
    }

    /**
     * Load configured Roku settings from persistent JSON
     */
    loadConfig() {
        try {
            if (fs.existsSync(CONFIG_FILE_PATH)) {
                const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
                return JSON.parse(raw);
            }
        } catch (e) {
            console.warn('[RokuController] Error reading rokuConfig.json:', e.message);
        }
        return {};
    }

    /**
     * Save Roku settings persistently
     */
    saveConfig(cfg) {
        try {
            const dir = path.dirname(CONFIG_FILE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(cfg, null, 2));
            return true;
        } catch (e) {
            console.error('[RokuController] Failed to persist rokuConfig.json:', e.message);
            return false;
        }
    }

    /**
     * Hot-reloads guest access definitions from persistent rokuConfig.json
     */
    refreshGuestAccess() {
        const cfg = this.loadConfig();
        if (cfg && cfg.guestAccess) {
            this.guestAccess = cfg.guestAccess;
        }
        return this.guestAccess;
    }

    /**
     * Check if a given Discord Guild ID is authorized for Roku TV hardware control
     */
    isGuildWhitelisted(guildId) {
        if (!guildId) return false;
        return WHITELISTED_GUILD_IDS.includes(String(guildId));
    }

    /**
     * Check if a given Discord User ID is authorized to command the Roku TV
     */
    isAuthorized(userId) {
        const id = String(userId);
        if (id === AUTHORIZED_USER_ID) return true;
        this.refreshGuestAccess();
        const entry = this.guestAccess[id];
        if (!entry) return false;
        if (typeof entry === 'number') return entry > 0;
        return (entry.tries || 0) > 0;
    }

    /**
     * Get remaining tries for a user
     */
    getRemainingTries(userId) {
        const id = String(userId);
        if (id === AUTHORIZED_USER_ID) return Infinity;
        this.refreshGuestAccess();
        const entry = this.guestAccess[id];
        if (!entry) return 0;
        if (typeof entry === 'number') return entry;
        return entry.tries || 0;
    }

    /**
     * Get allowed actions for a guest user (null if owner, array of actions if restricted)
     */
    getAllowedActions(userId) {
        const id = String(userId);
        if (id === AUTHORIZED_USER_ID) return null; // Owner has access to all actions
        this.refreshGuestAccess();
        const entry = this.guestAccess[id];
        if (!entry) return [];
        if (typeof entry === 'object' && entry.allowedActions === null) {
            return null; // Full access
        }
        if (typeof entry === 'object' && Array.isArray(entry.allowedActions)) {
            return entry.allowedActions;
        }
        // Default restriction for all guests: ONLY power controls
        return ['POWER_ON', 'POWER_OFF', 'POWER_TOGGLE'];
    }

    /**
     * Resolves allowed command actions from text description
     */
    resolveAllowedActions(phrase) {
        if (!phrase || typeof phrase !== 'string') {
            return ['POWER_ON', 'POWER_OFF', 'POWER_TOGGLE'];
        }
        const lower = phrase.toLowerCase().trim();

        if (lower.match(/\b(full\s+access|full\s+control|all\s+commands|all\s+access|everything|unrestricted|full)\b/i)) {
            return null; // null means all actions allowed
        }

        const ACTION_GROUPS = {
            POWER: ['POWER_ON', 'POWER_OFF', 'POWER_TOGGLE', 'RESTART'],
            VOLUME: ['VOLUME_UP', 'VOLUME_DOWN', 'MUTE', 'UNMUTE'],
            PLAYBACK: ['PLAY', 'PAUSE', 'REPLAY', 'FAST_FORWARD'],
            APPS: ['LAUNCH_APP'],
            NAV: ['HOME', 'BACK', 'SELECT', 'UP', 'DOWN', 'LEFT', 'RIGHT'],
            INPUTS: ['SWITCH_INPUT'],
            SEARCH: ['SEARCH', 'TYPE', 'WRITE_MESSAGE'],
            CHANNELS: ['CHANNEL_UP', 'CHANNEL_DOWN'],
            RESTART: ['RESTART'],
            MESSAGES: ['WRITE_MESSAGE', 'TYPE']
        };

        const matched = new Set();

        if (lower.match(/\b(power|turn\s+on|turn\s+off|power\s+on|power\s+off|wake|on\s+and\s+off|restart|reboot)\b/i)) {
            ACTION_GROUPS.POWER.forEach(a => matched.add(a));
        }
        if (lower.match(/\b(volume|sound|audio|mute|unmute|louder|quieter)\b/i)) {
            ACTION_GROUPS.VOLUME.forEach(a => matched.add(a));
        }
        if (lower.match(/\b(playback|play|pause|resume|fast\s+forward|rewind|replay|skip)\b/i)) {
            ACTION_GROUPS.PLAYBACK.forEach(a => matched.add(a));
        }
        if (lower.match(/\b(apps?|youtube|netflix|crunchyroll|spotify|hulu|disney|launch|open)\b/i)) {
            ACTION_GROUPS.APPS.forEach(a => matched.add(a));
        }
        if (lower.match(/\b(nav|navigation|remote|arrows|home|back|dpad|select)\b/i)) {
            ACTION_GROUPS.NAV.forEach(a => matched.add(a));
        }
        if (lower.match(/\b(inputs?|hdmi|switch\s+input|antenna)\b/i)) {
            ACTION_GROUPS.INPUTS.forEach(a => matched.add(a));
        }
        if (lower.match(/\b(search|type|typing|write|message)\b/i)) {
            ACTION_GROUPS.SEARCH.forEach(a => matched.add(a));
        }
        if (lower.match(/\b(channel|channels)\b/i)) {
            ACTION_GROUPS.CHANNELS.forEach(a => matched.add(a));
        }

        if (matched.size === 0) {
            return ['POWER_ON', 'POWER_OFF', 'POWER_TOGGLE'];
        }

        return Array.from(matched);
    }

    /**
     * Formats allowed scopes into human-readable badge summary
     */
    formatAllowedScopes(allowedActions) {
        if (allowedActions === null || allowedActions === undefined) {
            return '🌟 Full Access (All Commands)';
        }
        const scopes = [];
        if (allowedActions.includes('POWER_ON') || allowedActions.includes('POWER_OFF')) {
            scopes.push('⚡ Power (On/Off/Restart)');
        }
        if (allowedActions.includes('VOLUME_UP') || allowedActions.includes('MUTE')) {
            scopes.push('🔊 Volume & Mute');
        }
        if (allowedActions.includes('PLAY') || allowedActions.includes('PAUSE')) {
            scopes.push('⏯️ Playback');
        }
        if (allowedActions.includes('LAUNCH_APP')) {
            scopes.push('📱 Apps');
        }
        if (allowedActions.includes('HOME') || allowedActions.includes('SELECT')) {
            scopes.push('🎮 Remote Navigation');
        }
        if (allowedActions.includes('SWITCH_INPUT')) {
            scopes.push('🔌 HDMI & Inputs');
        }
        if (allowedActions.includes('SEARCH') || allowedActions.includes('TYPE') || allowedActions.includes('WRITE_MESSAGE')) {
            scopes.push('🔍 Search & Messaging');
        }
        if (allowedActions.includes('CHANNEL_UP')) {
            scopes.push('📺 Channels');
        }
        return scopes.length > 0 ? scopes.join(', ') : '🔒 Restricted';
    }

    /**
     * Friendly description for a specific action
     */
    getActionFriendlyName(action) {
        const names = {
            'POWER_ON': 'Power On',
            'POWER_OFF': 'Power Off',
            'POWER_TOGGLE': 'Power Toggle',
            'RESTART': 'System Reboot / Restart',
            'WRITE_MESSAGE': 'Display Message on TV Screen',
            'VOLUME_UP': 'Volume Control',
            'VOLUME_DOWN': 'Volume Control',
            'MUTE': 'Mute / Audio',
            'UNMUTE': 'Unmute / Audio',
            'PLAY': 'Media Playback',
            'PAUSE': 'Media Playback',
            'REPLAY': 'Media Playback',
            'FAST_FORWARD': 'Media Playback',
            'HOME': 'Home Screen Navigation',
            'BACK': 'Back Navigation',
            'SELECT': 'Remote Selection (OK)',
            'UP': 'Remote Arrow Navigation',
            'DOWN': 'Remote Arrow Navigation',
            'LEFT': 'Remote Arrow Navigation',
            'RIGHT': 'Remote Arrow Navigation',
            'LAUNCH_APP': 'App Launching',
            'SWITCH_INPUT': 'HDMI / Input Switching',
            'SEARCH': 'Search Functionality',
            'TYPE': 'Keyboard Input',
            'CHANNEL_UP': 'Channel Tuning',
            'CHANNEL_DOWN': 'Channel Tuning'
        };
        return names[action] || action;
    }

    /**
     * Grant temporary guest access to a user for N tries with customizable action scopes
     */
    grantGuestAccess(userId, count = 1, allowedActions = ['POWER_ON', 'POWER_OFF', 'POWER_TOGGLE']) {
        this.refreshGuestAccess();
        const id = String(userId).trim();
        const tries = Math.max(1, parseInt(count, 10) || 1);
        const current = this.guestAccess[id];
        const existingTries = typeof current === 'number' ? current : (current?.tries || 0);

        // Merge permissions if user already had an existing pass
        let mergedActions = allowedActions;
        if (current && typeof current === 'object' && Array.isArray(current.allowedActions) && Array.isArray(allowedActions)) {
            const set = new Set([...current.allowedActions, ...allowedActions]);
            mergedActions = Array.from(set);
        } else if (allowedActions === null || (current && typeof current === 'object' && current.allowedActions === null)) {
            mergedActions = null; // Upgraded to full access
        }

        this.guestAccess[id] = {
            tries: existingTries + tries,
            allowedActions: mergedActions
        };
        const cfg = this.loadConfig();
        cfg.ip = this.ip;
        cfg.updatedAt = new Date().toISOString();
        cfg.guestAccess = this.guestAccess;
        this.saveConfig(cfg);
        return { totalTries: this.guestAccess[id].tries, allowedActions: mergedActions };
    }

    /**
     * Revoke guest access for a user
     */
    revokeGuestAccess(userId) {
        const id = String(userId).trim();
        delete this.guestAccess[id];
        const cfg = this.loadConfig();
        cfg.ip = this.ip;
        cfg.updatedAt = new Date().toISOString();
        cfg.guestAccess = this.guestAccess;
        this.saveConfig(cfg);
        return true;
    }

    /**
     * Revoke a specific number of tries from a user
     */
    revokeGuestTries(userId, count = 1) {
        this.refreshGuestAccess();
        const id = String(userId).trim();
        const current = this.guestAccess[id];
        if (!current) {
            return { success: false, notFound: true, message: `User <@${id}> does not have an active guest pass.` };
        }
        const currentTries = typeof current === 'number' ? current : (current?.tries || 0);
        const toRemove = Math.max(1, parseInt(count, 10) || 1);
        const remaining = Math.max(0, currentTries - toRemove);

        if (remaining <= 0) {
            delete this.guestAccess[id];
            const cfg = this.loadConfig();
            cfg.ip = this.ip;
            cfg.updatedAt = new Date().toISOString();
            cfg.guestAccess = this.guestAccess;
            this.saveConfig(cfg);
            return {
                success: true,
                revokedFully: true,
                removedTries: currentTries,
                remainingTries: 0
            };
        }

        if (typeof current === 'number') {
            this.guestAccess[id] = remaining;
        } else {
            this.guestAccess[id].tries = remaining;
        }
        const cfg = this.loadConfig();
        cfg.ip = this.ip;
        cfg.updatedAt = new Date().toISOString();
        cfg.guestAccess = this.guestAccess;
        this.saveConfig(cfg);

        return {
            success: true,
            revokedFully: false,
            removedTries: toRemove,
            remainingTries: remaining
        };
    }

    /**
     * Revoke specific permission actions / scopes from a user
     */
    revokeGuestPermission(userId, actionOrScope) {
        this.refreshGuestAccess();
        const id = String(userId).trim();
        const current = this.guestAccess[id];
        if (!current) {
            return { success: false, notFound: true, message: `User <@${id}> does not have an active guest pass.` };
        }

        const actionsToRevoke = this.resolveAllowedActions(actionOrScope);
        if (!actionsToRevoke || actionsToRevoke.length === 0) {
            return { success: false, message: `No specific permissions recognized to revoke.` };
        }

        const ALL_KNOWN_ACTIONS = [
            'POWER_ON', 'POWER_OFF', 'POWER_TOGGLE', 'RESTART',
            'VOLUME_UP', 'VOLUME_DOWN', 'MUTE', 'UNMUTE',
            'PLAY', 'PAUSE', 'REPLAY', 'FAST_FORWARD',
            'LAUNCH_APP',
            'HOME', 'BACK', 'SELECT', 'UP', 'DOWN', 'LEFT', 'RIGHT',
            'SWITCH_INPUT',
            'SEARCH', 'TYPE', 'WRITE_MESSAGE',
            'CHANNEL_UP', 'CHANNEL_DOWN'
        ];

        let currentActions = typeof current === 'object' && Array.isArray(current.allowedActions)
            ? current.allowedActions
            : (current.allowedActions === null ? ALL_KNOWN_ACTIONS : ['POWER_ON', 'POWER_OFF', 'POWER_TOGGLE']);

        const updatedActions = currentActions.filter(act => !actionsToRevoke.includes(act));

        if (updatedActions.length === 0) {
            delete this.guestAccess[id];
            const cfg = this.loadConfig();
            cfg.ip = this.ip;
            cfg.updatedAt = new Date().toISOString();
            cfg.guestAccess = this.guestAccess;
            this.saveConfig(cfg);
            return {
                success: true,
                revokedFully: true,
                revokedActions: actionsToRevoke,
                remainingActions: []
            };
        }

        this.guestAccess[id].allowedActions = updatedActions;
        const cfg = this.loadConfig();
        cfg.ip = this.ip;
        cfg.updatedAt = new Date().toISOString();
        cfg.guestAccess = this.guestAccess;
        this.saveConfig(cfg);

        return {
            success: true,
            revokedFully: false,
            revokedActions: actionsToRevoke,
            remainingActions: updatedActions
        };
    }

    /**
     * Grant or append specific permission actions / scopes to a user
     */
    grantGuestPermission(userId, actionOrScope, tries = 0) {
        this.refreshGuestAccess();
        const id = String(userId).trim();
        const actionsToGrant = this.resolveAllowedActions(actionOrScope);
        const current = this.guestAccess[id];

        let finalTries = current ? (typeof current === 'number' ? current : (current?.tries || 0)) : 10;
        if (tries > 0) {
            finalTries = current ? finalTries + tries : tries;
        }

        let mergedActions = actionsToGrant;
        if (actionsToGrant === null) {
            mergedActions = null; // Full access
        } else if (current && typeof current === 'object' && Array.isArray(current.allowedActions)) {
            const set = new Set([...current.allowedActions, ...actionsToGrant]);
            mergedActions = Array.from(set);
        }

        this.guestAccess[id] = {
            tries: Math.max(1, finalTries),
            allowedActions: mergedActions
        };

        const cfg = this.loadConfig();
        cfg.ip = this.ip;
        cfg.updatedAt = new Date().toISOString();
        cfg.guestAccess = this.guestAccess;
        this.saveConfig(cfg);

        return {
            success: true,
            totalTries: this.guestAccess[id].tries,
            allowedActions: mergedActions,
            grantedActions: actionsToGrant
        };
    }

    /**
     * Comprehensive TV Control & Permission Help Guide
     */
    getTvHelpGuide() {
        return `📺 **Nora Smart TV Control Guide & Permission Directory**

### 🎮 Available TV Functions & Controls
• ⚡ **Power & Reboot**: \`turn on\`, \`turn off\`, \`toggle power\`, \`restart tv\`
• 🔊 **Volume & Audio**: \`set volume to 25\`, \`volume up 5\`, \`volume down\`, \`quieter\`, \`mute\`, \`unmute\`, \`toggle mute\`
• 🎯 **Remote Navigation**: \`ok\`, \`enter\`, \`select\`, \`back\`, \`home\`, \`up\`, \`down\`, \`left\`, \`right\`, \`star (*)\`
• ⏯️ **Playback**: \`play\`, \`pause\`, \`resume\`, \`replay\`, \`rewind\`, \`fast forward\`
• 📱 **Apps**: \`open crunchyroll\`, \`watch youtube\`, \`launch netflix\`, \`disney+\`, \`hulu\`, \`spotify\`
• 🔌 **Inputs**: \`switch input to hdmi 1\`, \`hdmi 2\`, \`computer/pc\`, \`live tv\`, \`av\`
• 📺 **Channels**: \`channel up\`, \`channel down\`, \`next channel\`
• ✍️ **Screen Messaging**: \`display message "Hello!" on tv\`, \`type "search query"\`
• 📊 **Status**: \`tv status\`, \`who has access to the tv\`

---

### 🎟️ Access & Permission Management (Developer Only)
You can manage guest passes and fine-grained permissions conversationally or via \`/roku\`:

• **Grant Passes / Tries**:
  - \`give @user 5 tries for tv\` *(default: power)*
  - \`give @user 10 tries for power and volume\`
  - \`give @user full access with 10 tries\`

• **Grant Specific Permissions**:
  - \`give @user volume permission on tv\`
  - \`grant apps and playback permission to @user\`

• **Revoke Specific Tries**:
  - \`revoke 3 tries from @user for tv\`
  - \`take away 5 tries from @user\`

• **Revoke Specific Permissions**:
  - \`revoke volume permission from @user on tv\`
  - \`remove apps permission from @user\`

• **Revoke All Access**:
  - \`revoke all tv access from @user\`

• **View Active Passes**:
  - \`who has access to the tv\` / \`tv guest list\``;
    }

    /**
     * Consume 1 guest pass try
     */
    consumeGuestAccess(userId) {
        const id = String(userId).trim();
        if (id === AUTHORIZED_USER_ID) return;
        const entry = this.guestAccess[id];
        if (!entry) return;

        if (typeof entry === 'number') {
            this.guestAccess[id]--;
            if (this.guestAccess[id] <= 0) {
                delete this.guestAccess[id];
            }
        } else if (typeof entry === 'object') {
            entry.tries = (entry.tries || 1) - 1;
            if (entry.tries <= 0) {
                delete this.guestAccess[id];
            }
        }

        const cfg = this.loadConfig();
        cfg.ip = this.ip;
        cfg.updatedAt = new Date().toISOString();
        cfg.guestAccess = this.guestAccess;
        this.saveConfig(cfg);
    }

    /**
     * Save Roku IP persistently
     */
    setRokuIP(newIp) {
        if (!newIp || typeof newIp !== 'string') return false;
        const clean = newIp.trim().replace(/^https?:\/\//, '').replace(/:8060\/?$/, '');
        this.ip = clean;
        const cfg = this.loadConfig();
        cfg.ip = clean;
        cfg.updatedAt = new Date().toISOString();
        cfg.guestAccess = this.guestAccess;
        return this.saveConfig(cfg);
    }

    /**
     * Get active Roku IP
     */
    getRokuIP() {
        return this.ip;
    }

    /**
     * Internal HTTP helper to call Roku ECP endpoints
     */
    async request(endpoint, method = 'POST', timeoutMs = 3500) {
        const url = `http://${this.ip}:${this.port}${endpoint}`;
        try {
            const res = await fetch(url, {
                method,
                signal: AbortSignal.timeout(timeoutMs)
            });
            const text = await res.text();
            return { ok: res.ok, status: res.status, data: text };
        } catch (err) {
            return { ok: false, error: 'Connection Failed' };
        }
    }

    /**
     * Discover Roku devices on local network using SSDP (Simple Service Discovery Protocol)
     */
    async discoverRoku(timeoutMs = 3000) {
        return new Promise((resolve) => {
            const socket = dgram.createSocket('udp4');
            const ssdpMsg = 
                'M-SEARCH * HTTP/1.1\r\n' +
                'HOST: 239.255.255.250:1900\r\n' +
                'MAN: "ssdp:discover"\r\n' +
                'ST: roku:ecp\r\n' +
                'MX: 3\r\n\r\n';

            let foundIp = null;
            let foundLocation = null;

            socket.on('message', (msg, rinfo) => {
                const str = msg.toString();
                if (str.toLowerCase().includes('roku') || str.includes('roku:ecp')) {
                    foundIp = rinfo.address;
                    const locMatch = str.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i);
                    if (locMatch) foundLocation = locMatch[1];
                }
            });

            socket.on('error', () => {});

            socket.bind(() => {
                socket.send(Buffer.from(ssdpMsg), 0, ssdpMsg.length, 1900, '239.255.255.250', () => {});
            });

            setTimeout(() => {
                try { socket.close(); } catch (_) {}
                if (foundIp) {
                    this.setRokuIP(foundIp);
                    resolve({ found: true, ip: foundIp, location: foundLocation });
                } else {
                    resolve({ found: false, currentIp: this.ip });
                }
            }, timeoutMs);
        });
    }

    /**
     * Send a single keypress to Roku TV
     */
    async keypress(key) {
        return await this.request(`/keypress/${encodeURIComponent(key)}`, 'POST');
    }

    /**
     * Send multiple keypresses in sequence with delay
     */
    async keypressSequence(key, count = 1, delayMs = 120) {
        let lastResult = null;
        for (let i = 0; i < count; i++) {
            lastResult = await this.keypress(key);
            if (!lastResult.ok) break;
            if (i < count - 1 && delayMs > 0) {
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
        return lastResult;
    }

    /**
     * Power Commands
     */
    async powerOn() {
        const res = await this.keypress('PowerOn');
        if (!res.ok) return await this.keypress('Power');
        return res;
    }

    async powerOff() {
        const res = await this.keypress('PowerOff');
        if (!res.ok) return await this.keypress('Power');
        return res;
    }

    async togglePower() {
        return await this.keypress('Power');
    }

    /**
     * Volume Commands
     */
    async volumeUp(amount = 1) {
        return await this.keypressSequence('VolumeUp', Math.min(25, Math.max(1, amount)));
    }

    async volumeDown(amount = 1) {
        return await this.keypressSequence('VolumeDown', Math.min(25, Math.max(1, amount)));
    }

    async mute() {
        return await this.keypress('VolumeMute');
    }

    /**
     * Playback & Navigation
     */
    async play() { return await this.keypress('Play'); }
    async pause() { return await this.keypress('Play'); }
    async select() { return await this.keypress('Select'); }
    async home() { return await this.keypress('Home'); }
    async back() { return await this.keypress('Back'); }
    async replay() { return await this.keypress('InstantReplay'); }
    async rewind() { return await this.keypress('Rev'); }
    async fastForward() { return await this.keypress('Fwd'); }
    async info() { return await this.keypress('Info'); }
    async up() { return await this.keypress('Up'); }
    async down() { return await this.keypress('Down'); }
    async left() { return await this.keypress('Left'); }
    async right() { return await this.keypress('Right'); }

    /**
     * Inputs
     */
    async switchInput(inputName) {
        const normalized = (inputName || '').toLowerCase().replace(/\s+/g, '');
        if (normalized.includes('computer') || normalized.includes('pc')) {
            return await this.launchApp('tvinput.hdmi2');
        }
        if (normalized.includes('hdmi1')) return await this.keypress('InputHDMI1');
        if (normalized.includes('hdmi2')) return await this.keypress('InputHDMI2');
        if (normalized.includes('hdmi3')) return await this.keypress('InputHDMI3');
        if (normalized.includes('hdmi4')) return await this.keypress('InputHDMI4');
        if (normalized.includes('av')) return await this.keypress('InputAV1');
        if (normalized.includes('tuner') || normalized.includes('livetv') || normalized.includes('antenna') || normalized.includes('dtv') || normalized === 'tv') {
            return await this.keypress('InputTuner');
        }
        return await this.launchApp(inputName);
    }

    async channelUp() { return await this.keypress('ChannelUp'); }
    async channelDown() { return await this.keypress('ChannelDown'); }

    /**
     * Launch Any App by Name, Keyword, or Numeric ID
     */
    async launchApp(appQuery, contentId = null) {
        if (!appQuery) return { ok: false, error: 'No app name provided' };
        let appId = null;
        let displayName = appQuery;

        const cleanQuery = (appQuery || '').toLowerCase().trim();
        const normQuery = cleanQuery.replace(/[^a-z0-9]/g, '');

        // 1. Direct numeric App ID
        if (/^\d+$/.test(cleanQuery)) {
            appId = cleanQuery;
        }

        // 2. FIRST PRIORITY: Match against Live Installed Apps on THIS TV
        if (!appId) {
            let installed = await this.getInstalledApps();
            let match = installed.find(a => a.name.toLowerCase() === cleanQuery);
            if (!match) {
                match = installed.find(a => a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normQuery);
            }
            if (!match) {
                match = installed.find(a => {
                    const normA = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return (normA.length >= 3 && normQuery.includes(normA)) || (normQuery.length >= 3 && normA.includes(normQuery));
                });
            }

            if (match) {
                appId = match.id;
                displayName = match.name;
            }
        }

        // 3. Fallback: Registry of Well-Known Apps
        if (!appId && KNOWN_APPS[cleanQuery]) {
            appId = KNOWN_APPS[cleanQuery].id;
            displayName = KNOWN_APPS[cleanQuery].name;
        }
        if (!appId) {
            for (const [key, val] of Object.entries(KNOWN_APPS)) {
                if (key.replace(/[^a-z0-9]/g, '') === normQuery) {
                    appId = val.id;
                    displayName = val.name;
                    break;
                }
            }
        }

        // 4. Launch app directly if found
        if (appId) {
            let endpoint = `/launch/${encodeURIComponent(appId)}`;
            if (contentId) {
                endpoint += `?contentID=${encodeURIComponent(contentId)}`;
            }
            let res = await this.request(endpoint, 'POST');

            // If Roku returned 404 (ID not installed on this TV), clear cache and check live apps
            if (!res.ok && res.status === 404) {
                this.installedAppsCache = null;
                const freshInstalled = await this.getInstalledApps();
                const freshMatch = freshInstalled.find(a => 
                    a.name.toLowerCase() === cleanQuery || 
                    a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normQuery ||
                    (cleanQuery.length >= 3 && a.name.toLowerCase().includes(cleanQuery))
                );

                if (freshMatch && freshMatch.id !== appId) {
                    appId = freshMatch.id;
                    displayName = freshMatch.name;
                    res = await this.request(`/launch/${encodeURIComponent(appId)}`, 'POST');
                }
            }

            if (res.ok) {
                return { ...res, appId, appName: displayName };
            }

            // If still 404, the app is not installed on the TV. Open Roku Store search for it!
            if (res.status === 404) {
                const searchRes = await this.request(`/search/browse?keyword=${encodeURIComponent(displayName || appQuery)}&type=channel`, 'POST');
                if (searchRes.ok) {
                    return {
                        ok: true,
                        appId: null,
                        appName: displayName,
                        storeSearch: true,
                        message: `📺 **${displayName}** is not installed on your TV yet. I opened the Roku Channel Store so you can add it!`
                    };
                }
                return { ok: false, error: `The app "**${displayName}**" is not currently installed on your Roku TV.` };
            }

            return { ...res, appId, appName: displayName };
        }

        // 5. If not found in installed apps, launch Roku Channel Store search so user can open/install it on TV
        const searchRes = await this.request(`/search/browse?keyword=${encodeURIComponent(appQuery)}&type=channel`, 'POST');
        if (searchRes.ok) {
            return {
                ok: true,
                appId: null,
                appName: appQuery,
                storeSearch: true,
                message: `Searching Roku Channel Store for **"${appQuery}"** so you can launch or install it on your TV!`
            };
        }

        return { ok: false, error: `Could not find or open app "${appQuery}".` };
    }

    /**
     * Restart Roku TV using the universal remote hardware reboot sequence
     * (Home x5 -> Up x1 -> Rev x2 -> Fwd x2)
     */
    async restart() {
        const sequence = [
            { key: 'Home', count: 5, delay: 200 },
            { key: 'Up', count: 1, delay: 200 },
            { key: 'Rev', count: 2, delay: 200 },
            { key: 'Fwd', count: 2, delay: 200 }
        ];
        for (const step of sequence) {
            await this.keypressSequence(step.key, step.count, step.delay);
            await new Promise(r => setTimeout(r, 220));
        }
        return { ok: true, message: 'Roku OS reboot sequence executed.' };
    }

    /**
     * Write / Display message on the Roku TV screen
     * Shows message prominently on TV via search overlay and types characters
     */
    async writeMessage(messageText) {
        if (!messageText) return { ok: false, error: 'No message provided' };
        // Display prominently on TV screen via Roku Search overlay
        const searchRes = await this.search(messageText);
        // Also type via Lit_ keypresses into any active input field
        await this.typeText(messageText);
        return { ok: true, text: messageText };
    }

    /**
     * Search Content / Channel
     */
    async search(keyword, type = null) {
        let endpoint = `/search/browse?keyword=${encodeURIComponent(keyword)}`;
        if (type) endpoint += `&type=${encodeURIComponent(type)}`;
        return await this.request(endpoint, 'POST');
    }

    /**
     * Type text into input on Roku screen
     */
    async typeText(text) {
        if (!text) return { ok: false, error: 'No text provided' };
        for (const char of text) {
            await this.request(`/keypress/Lit_${encodeURIComponent(char)}`, 'POST');
            await new Promise(r => setTimeout(r, 60));
        }
        return { ok: true };
    }

    /**
     * Fetch Installed Apps
     */
    async getInstalledApps() {
        const now = Date.now();
        if (this.installedAppsCache && (now - this.lastAppCacheTime < 300000)) {
            return this.installedAppsCache;
        }

        const res = await this.request('/query/apps', 'GET', 3000);
        if (!res.ok || !res.data) return Object.values(KNOWN_APPS);

        const apps = [];
        const regex = /<app id="([^"]+)"[^>]*>([^<]+)<\/app>/gi;
        let match;
        while ((match = regex.exec(res.data)) !== null) {
            const cleanName = match[2]
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/\u00a0/g, ' ')
                .trim();
            apps.push({ id: match[1], name: cleanName });
        }

        if (apps.length > 0) {
            this.installedAppsCache = apps;
            this.lastAppCacheTime = now;
            return apps;
        }
        return Object.values(KNOWN_APPS);
    }

    /**
     * Query Active App
     */
    async getActiveApp() {
        const res = await this.request('/query/active-app', 'GET', 2500);
        if (!res.ok || !res.data) return null;
        const match = res.data.match(/<app id="([^"]+)"[^>]*>([^<]+)<\/app>/i);
        if (match) {
            return { id: match[1], name: match[2].trim() };
        }
        return null;
    }

    /**
     * Query Device Info
     */
    async getDeviceInfo() {
        const res = await this.request('/query/device-info', 'GET', 2500);
        if (!res.ok || !res.data) return null;

        const parseTag = (tag) => {
            const m = res.data.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`, 'i'));
            return m ? m[1].trim() : null;
        };

        const info = {
            friendlyName: parseTag('user-device-name') || parseTag('friendly-device-name') || 'Roku TV',
            modelName: parseTag('model-name') || 'Roku',
            modelNumber: parseTag('model-number') || 'Unknown',
            serialNumber: parseTag('serial-number') || 'Unknown',
            powerMode: parseTag('power-mode') || 'Unknown',
            wifiMac: parseTag('wifi-mac') || null,
            networkType: parseTag('network-type') || 'Unknown',
            uptime: parseTag('uptime') ? parseInt(parseTag('uptime'), 10) : null
        };
        this.lastKnownDeviceInfo = info;
        return info;
    }

    /**
     * 🧠 Natural Language Roku Intent Parser (Supports Multi-Task Sequences)
     * Analyzes free-form user speech directed at Nora with advanced disambiguation:
     * - Distinguishes hardware TV control from bot commands and conversational chat.
     */
    parseRokuIntent(text, message = null) {
        const raw = (text || '').trim();
        if (!raw) return null;

        const cleaned = raw.replace(/^(?:nora|hey nora)[,\s]*/i, '').trim();
        const lower = cleaned.toLowerCase();

        // 1. Exclude prefix commands that are NOT !tv, !roku, /tv, /roku
        if (/^[!/.#$?-]\w+/i.test(cleaned) && !/^!(?:tv|roku)\b/i.test(cleaned) && !/^\/(?:tv|roku)\b/i.test(cleaned)) {
            return null;
        }

        // 2. Exclude Discord moderation commands targeting users or channels
        if (/\b(?:mute|timeout|unmute|untimeout|kick|ban|unban|warn)\s+<@!?\d+>/i.test(cleaned)) {
            return null;
        }
        if (/\b(?:purge|clear|clean)\s+\d+\b/i.test(cleaned)) {
            return null;
        }
        if (/\b(?:lockdown|slowmode|adaptiveslowmode|verify|ticket|ticket close)\b/i.test(cleaned) && !/\b(?:tv|roku|television)\b/i.test(cleaned)) {
            return null;
        }

        // 3. Exclude Host PC / Device Specs queries
        if (/\b(?:device|pc|computer|system|hardware|host)\s+(?:specs?|specifications?|hardware|info)\b/i.test(cleaned)) {
            return null;
        }

        // 4. Conversational / Explanation / Philosophical / AI-talk Filter:
        // When user asks Nora a question, wants to chat, discusses programming, or asks about Nora:
        const isConversationalQuestion = /\b(?:what\s+model|read\s+the\s+code|how\s+does|how\s+do|can\s+you\s+speak|speak\s+with\s+me|talk\s+to\s+me|chat\s+with\s+me|tell\s+me\s+about|why\s+is|who\s+made|who\s+created|do\s+you\s+like|what\s+is\s+your\s+favorite|tell\s+me\s+a\s+joke|how\s+are\s+you|explain\s+how|what\s+do\s+you\s+think|can\s+you\s+help\s+me\s+with|who\s+are\s+you)\b/i.test(cleaned);
        const isTvStatusOrControl = /\b(?:what(?:'s|\s+is)\s+(?:playing|on)\s+(?:on\s+)?(?:the\s+)?tv|is\s+(?:the\s+)?tv\s+on|who\s+(?:all\s+)?(?:can\s+control|has\s+access\s+to)\s+(?:the\s+|my\s+)?(?:roku|tv)|(?:turn\s+on|turn\s+off|restart|reboot)\s+(?:the\s+)?tv)\b/i.test(cleaned);

        if (isConversationalQuestion && !isTvStatusOrControl) {
            return null;
        }

        const hasTvContext = /\b(tv|roku|television|screen|remote|smart\s*tv)\b/i.test(cleaned) || /^!(?:tv|roku)\b/i.test(cleaned) || /^\/(?:tv|roku)\b/i.test(cleaned);

        // 1. Check for compound / multi-task instructions joined by conjunctions
        if (/\b(?:and then|then|and|&)\b|[,;]/i.test(cleaned)) {
            const parts = cleaned
                .split(/\s*(?:,\s*and\s*then|\s+and\s+then|,\s*then|\s+then|,\s*and|\s+and|\s*;\s*|,\s*)\s*/i)
                .map(p => p.trim())
                .filter(Boolean);

            if (parts.length > 1) {
                const tasks = [];
                for (const part of parts) {
                    const taskIntent = this._parseSingleIntent(part, hasTvContext, message);
                    if (taskIntent && taskIntent.action !== 'COMPOSITE' && taskIntent.action !== 'UNKNOWN_TV_ACTION') {
                        tasks.push(taskIntent);
                    }
                }
                // If multiple distinct tasks were found, return COMPOSITE
                if (tasks.length >= 2) {
                    return { action: 'COMPOSITE', tasks };
                }
            }
        }

        // 2. Fall back to single intent
        return this._parseSingleIntent(cleaned, hasTvContext, message);
    }

    _parseSingleIntent(text, hasTvContext = false, message = null) {
        const raw = (text || '').trim();
        let cleaned = raw
            .replace(/^(?:hey\s+)?nora[,\s]*/i, '')
            .replace(/^(?:please|can\s+you|could\s+you|would\s+you|go\s+ahead\s+and|i\s+want\s+you\s+to|i\s+need\s+you\s+to|try\s+to)[,\s]*/i, '')
            .replace(/[,\s]*(?:please|for\s+me|thanks|thank\s+you)[.!?]*$/i, '')
            .trim();
        const lower = cleaned.toLowerCase();

        // Helper to extract mentioned target user from string or Discord message
        const getMentionedUserId = (str) => {
            const m = str.match(/<@!?(\d{17,20})>/);
            if (m) return m[1];
            const m2 = str.match(/\b(\d{17,20})\b/);
            if (m2) return m2[1];
            if (message && message.mentions?.users) {
                const u = message.mentions.users.filter(usr => usr.id !== message.client?.user?.id).first();
                if (u) return u.id;
            }
            return null;
        };

        // 0. TV Help Guide / Function Directory
        if (lower.match(/\b(?:tv\s+help|roku\s+help|help\s+(?:with\s+)?(?:the\s+)?(?:tv|roku)|(?:what\s+)?(?:tv|roku)\s+functions|(?:what\s+)?(?:tv|roku)\s+commands|what\s+functions\s+can\s+i\s+(?:give|revoke)|tv\s+permissions\s+help|how\s+to\s+control\s+(?:the\s+)?(?:tv|roku))\b/i) ||
            (hasTvContext && lower.match(/^(?:help|commands|functions|guide)$/i))) {
            return { action: 'TV_HELP' };
        }

        // 1. Granular Revoke: Specific amount of tries (e.g. "revoke 5 tries from @user for tv", "take away 3 tries from @user")
        const revokeTriesMatch = lower.match(/(?:revoke|take\s+away|remove|subtract|minus)\s+(\d+)\s*(?:tries|try|times?)\s+(?:from|for)\s+(?:this\s+user\s+|user\s+)?<?@?!?!?(\d{17,20})>?/i) ||
                                 lower.match(/(?:revoke|take\s+away|remove|subtract)\s+<?@?!?!?(\d{17,20})>?\s+(\d+)\s*(?:tries|try|times?)/i) ||
                                 (lower.match(/(?:revoke|take\s+away|remove)\s+(\d+)\s*(?:tries|try)/i) && getMentionedUserId(lower));
        if (revokeTriesMatch) {
            const count = parseInt(revokeTriesMatch[1] && !isNaN(revokeTriesMatch[1]) ? revokeTriesMatch[1] : (revokeTriesMatch[2] || '1'), 10) || 1;
            const targetId = getMentionedUserId(lower);
            if (targetId) {
                return { action: 'REVOKE_TRIES', targetId, count };
            }
        }

        // 2. Granular Revoke: Specific permission scope (e.g. "revoke volume permission from @user on tv", "remove apps from @user")
        const revokePermMatch = lower.match(/(?:revoke|take\s+away|remove)\s+(?:the\s+)?(power|volume|sound|audio|apps?|playback|nav|navigation|inputs?|channels?|messages?)\s+(?:permission|permissions|access|control|scope)?\s+(?:from|for)\s+(?:this\s+user\s+|user\s+)?<?@?!?!?(\d{17,20})>?/i) ||
                                (lower.match(/(?:revoke|take\s+away|remove)\s+(?:the\s+)?(power|volume|sound|audio|apps?|playback|nav|navigation|inputs?|channels?|messages?)\s+(?:permission|permissions|access|control)?/i) && getMentionedUserId(lower));
        if (revokePermMatch) {
            const scope = revokePermMatch[1];
            const targetId = getMentionedUserId(lower);
            if (targetId && scope && !['all', 'guest', 'tv', 'roku'].includes(scope.toLowerCase())) {
                return { action: 'REVOKE_PERMISSION', targetId, permissionScope: scope };
            }
        }

        // 3. Revoke All Access (e.g. "revoke all tv access from @user", "revoke access for @user")
        const revokeMatch = lower.match(/(?:revoke|remove|take\s+away)\s+(?:all\s+)?(?:guest\s+|roku\s+|tv\s+)?access\s+(?:for|from)\s+(?:this\s+user\s+|user\s+)?<?@?!?!?(\d{17,20})>?/i) ||
                            (lower.match(/(?:revoke|remove)\s+(?:all\s+)?(?:tv|roku|guest)?\s*access/i) && getMentionedUserId(lower));
        if (revokeMatch) {
            const targetId = getMentionedUserId(lower);
            if (targetId) {
                return { action: 'REVOKE_ACCESS', targetId };
            }
        }

        // 4. Granular Grant: Specific permission scope (e.g. "give @user volume permission on tv", "grant apps permission to @user")
        const grantPermMatch = lower.match(/(?:give|grant|allow|add)\s+<?@?!?!?(\d{17,20})>?\s+(?:the\s+)?(power|volume|sound|audio|apps?|playback|nav|navigation|inputs?|channels?|messages?)\s+(?:permission|permissions|access|control)/i) ||
                               lower.match(/(?:give|grant|allow|add)\s+(?:the\s+)?(power|volume|sound|audio|apps?|playback|nav|navigation|inputs?|channels?|messages?)\s+(?:permission|permissions|access|control)\s+(?:to|for)\s+<?@?!?!?(\d{17,20})>?/i);
        if (grantPermMatch) {
            const targetId = getMentionedUserId(lower);
            const scope = grantPermMatch[1] && grantPermMatch[1].length < 15 ? grantPermMatch[1] : grantPermMatch[2];
            if (targetId && scope) {
                return { action: 'GRANT_PERMISSION', targetId, permissionScope: scope };
            }
        }

        // 5. Grant Tries / Guest Access patterns
        let grantMatch = lower.match(/(?:give|grant|allow)\s+(\d+)\s*(?:try|tries|times?)\s+(?:to|for)\s+(?:this\s+user\s+|user\s+)?<?@?!?!?(\d{17,20})>?/i);
        if (grantMatch) {
            const tries = parseInt(grantMatch[1], 10) || 1;
            const targetId = grantMatch[2] || getMentionedUserId(lower);
            if (targetId) {
                const allowedActions = this.resolveAllowedActions(lower);
                return { action: 'GRANT_ACCESS', targetId, tries, allowedActions };
            }
        }

        grantMatch = lower.match(/(?:give|grant|allow|let)\s+(?:this\s+user\s+|user\s+)?<?@?!?!?(\d{17,20})>?(?:\s+(?:have|to\s+have))?\s+(\d+)\s*(?:try|tries|times?)/i);
        if (grantMatch) {
            const targetId = grantMatch[1] || getMentionedUserId(lower);
            const tries = parseInt(grantMatch[2], 10) || 1;
            if (targetId) {
                const allowedActions = this.resolveAllowedActions(lower);
                return { action: 'GRANT_ACCESS', targetId, tries, allowedActions };
            }
        }

        grantMatch = lower.match(/(?:give|grant|allow)\s+(?:guest\s+|roku\s+|tv\s+|full\s+|all\s+|unrestricted\s+)?access\s+(?:to|for)\s+(?:this\s+user\s+|user\s+)?<?@?!?!?(\d{17,20})>?(?:\s+(?:for|with)?\s*(\d+)\s*(?:try|tries|times?)?)?/i);
        if (grantMatch) {
            const targetId = grantMatch[1] || getMentionedUserId(lower);
            const tries = parseInt(grantMatch[2] || '1', 10) || 1;
            if (targetId) {
                const allowedActions = this.resolveAllowedActions(lower);
                return { action: 'GRANT_ACCESS', targetId, tries, allowedActions };
            }
        }

        grantMatch = lower.match(/(?:give|grant|allow)\s+(?:this\s+user\s+|user\s+)?<?@?!?!?(\d{17,20})>?\s+(?:guest\s+|roku\s+|tv\s+|full\s+|all\s+|unrestricted\s+)?access(?:\s+(?:for|with)?\s*(\d+)\s*(?:try|tries|times?)?)?/i);
        if (grantMatch) {
            const targetId = grantMatch[1] || getMentionedUserId(lower);
            const tries = parseInt(grantMatch[2] || '1', 10) || 1;
            if (targetId) {
                const allowedActions = this.resolveAllowedActions(lower);
                return { action: 'GRANT_ACCESS', targetId, tries, allowedActions };
            }
        }

        grantMatch = lower.match(/(?:let|allow)\s+(?:this\s+user\s+|user\s+)?<?@?!?!?(\d{17,20})>?\s+(?:use|control)\s+(?:the\s+)?(?:tv|roku)(?:\s+(?:for\s+)?(\d+)\s*(?:try|tries|times?)?)?/i);
        if (grantMatch) {
            const targetId = grantMatch[1] || getMentionedUserId(lower);
            const tries = parseInt(grantMatch[2] || '1', 10) || 1;
            if (targetId) {
                const allowedActions = this.resolveAllowedActions(lower);
                return { action: 'GRANT_ACCESS', targetId, tries, allowedActions };
            }
        }

        grantMatch = lower.match(/^grant\s+access\s+<?@?!?!?(\d{17,20})>?(?:\s+(\d+))?/i);
        if (grantMatch) {
            const targetId = grantMatch[1] || getMentionedUserId(lower);
            const tries = parseInt(grantMatch[2] || '1', 10) || 1;
            if (targetId) {
                const allowedActions = this.resolveAllowedActions(lower);
                return { action: 'GRANT_ACCESS', targetId, tries, allowedActions };
            }
        }

        // Direct mention fallback for grants
        if (message) {
            const targetUser = message.mentions?.users?.filter(u => u.id !== message.client?.user?.id)?.first();
            if (targetUser) {
                const mentionGrant = lower.match(/(?:give|grant|allow|let)\s+(?:them|him|her|this\s+user|user)?\s*(?:guest\s+|roku\s+|tv\s+)?(?:access\s+)?(?:for\s+)?(\d+)?\s*(?:try|tries|times?)?/i);
                if (mentionGrant && (lower.includes('try') || lower.includes('access') || lower.includes('tv') || lower.includes('roku'))) {
                    const tries = parseInt(mentionGrant[1] || '1', 10) || 1;
                    const allowedActions = this.resolveAllowedActions(lower);
                    return { action: 'GRANT_ACCESS', targetId: targetUser.id, tries, allowedActions };
                }
            }
        }

        // 6. IP Configuration / Discovery commands
        const ipMatch = lower.match(/\b(?:set|change|update)?\s*roku\s*ip\s*(?:to|=)?\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/i);
        if (ipMatch) {
            return { action: 'SET_IP', ip: ipMatch[1] };
        }

        if (lower.match(/\b(?:scan\s*for|discover|find|locate)\s*(?:my\s+)?(?:roku|tv)\b/i)) {
            return { action: 'DISCOVER' };
        }

        // 7. Access List / Status Queries
        if (lower.match(/\b(?:who\s+(?:all\s+)?(?:has\s+access|can\s+control|has\s+guest|is\s+authorized)|guest\s+list|access\s+list|list\s+guests|guest\s+passes|view\s+passes)\b/i)) {
            return { action: 'ACCESS_LIST' };
        }

        if (lower.match(/\b(?:tv\s+status|roku\s+status|check\s+(?:the\s+)?(?:roku|tv)|is\s+(?:the\s+)?tv\s+on|what(?:'s|\s+is)\s+(?:playing|on)\s+(?:on\s+)?(?:the\s+)?tv)\b/i)) {
            return { action: 'STATUS' };
        }

        // 8. Power actions
        if (lower.match(/\b(?:turn\s+on|power\s+on|wake\s+up|switch\s+on|turn\s+it\s+on|boot\s+up|start\s+up)\s*(?:the\s+|my\s+)?(?:tv|television|roku)\b/i) ||
            lower.match(/\b(?:turn|power)\s*(?:the\s+|my\s+)?(?:tv|television|roku)\s*on\b/i) ||
            (hasTvContext && lower.match(/\b(?:turn\s+on|power\s+on|wake\s+up|switch\s+on)\b/i))) {
            return { action: 'POWER_ON' };
        }

        if (lower.match(/\b(?:turn\s+off|power\s+off|shut\s+off|shut\s+down|switch\s+off|turn\s+it\s+off|put\s+to\s+sleep)\s*(?:the\s+|my\s+)?(?:tv|television|roku)\b/i) ||
            lower.match(/\b(?:turn|power|shut)\s*(?:the\s+|my\s+)?(?:tv|television|roku)\s*off\b/i) ||
            (hasTvContext && lower.match(/\b(?:turn\s+off|power\s+off|shut\s+off|shut\s+down)\b/i))) {
            return { action: 'POWER_OFF' };
        }

        if (lower.match(/\b(?:toggle\s+power|power\s+toggle|toggle\s+the\s+power)\s*(?:the\s+|my\s+)?(?:tv|roku|television)\b/i)) {
            return { action: 'POWER_TOGGLE' };
        }

        // Restart / Reboot actions
        if (lower.match(/\b(?:restart|reboot|power\s+cycle|reset)\s*(?:the\s+|my\s+)?(?:tv|television|roku)\b/i) ||
            lower.match(/\b(?:tv|roku)\s+(?:restart|reboot)\b/i) ||
            (hasTvContext && lower.match(/\b(?:restart|reboot|power\s+cycle)\b/i))) {
            return { action: 'RESTART' };
        }

        // 9. Volume Controls
        // 9a. Set volume to specific number (e.g. "set volume to 25 on roku tv", "volume to 30", "volume 25")
        const setVolMatch = lower.match(/\b(?:set|change|put|make|turn)?\s*(?:the\s+)?volume\s+(?:to|=)\s*(\d+)\b/i) ||
                            lower.match(/\bvolume\s+(\d+)\b/i) ||
                            lower.match(/\bset\s+(?:the\s+)?(?:tv\s+)?volume\s+(?:to\s+)?(\d+)\b/i);
        if (setVolMatch && hasTvContext) {
            const target = parseInt(setVolMatch[1], 10);
            if (!isNaN(target)) {
                return { action: 'SET_VOLUME', targetVolume: Math.min(100, Math.max(0, target)) };
            }
        }

        // 9b. Volume Up
        const volUpMatch = lower.match(/\b(?:turn\s+up|increase|raise|boost)\s*(?:the\s+)?(?:tv\s+)?(?:volume|sound|audio)\s*(?:by\s+(\d+))?\b/i) ||
                           lower.match(/\b(?:tv\s+)?volume\s+up\s*(?:by\s+(\d+))?\b/i) ||
                           lower.match(/\b(?:make\s+(?:the\s+)?tv\s+louder)\b/i) ||
                           (hasTvContext && lower.match(/\b(?:louder|turn\s+it\s+up)\s*(?:by\s+(\d+))?\b/i)) ||
                           (hasTvContext && lower.match(/\bvolume\s*\+\s*(\d+)?\b/i));
        if (volUpMatch) {
            const amount = volUpMatch[1] || volUpMatch[2] || 3;
            return { action: 'VOLUME_UP', amount: parseInt(amount, 10) || 3 };
        }

        // 9c. Volume Down
        const volDownMatch = lower.match(/\b(?:turn\s+down|lower|decrease|reduce)\s*(?:the\s+)?(?:tv\s+)?(?:volume|sound|audio)\s*(?:by\s+(\d+))?\b/i) ||
                             lower.match(/\b(?:tv\s+)?volume\s+down\s*(?:by\s+(\d+))?\b/i) ||
                             lower.match(/\b(?:make\s+(?:the\s+)?tv\s+quieter)\b/i) ||
                             (hasTvContext && lower.match(/\b(?:quieter|turn\s+it\s+down)\s*(?:by\s+(\d+))?\b/i)) ||
                             (hasTvContext && lower.match(/\bvolume\s*-\s*(\d+)?\b/i));
        if (volDownMatch) {
            const amount = volDownMatch[1] || volDownMatch[2] || 3;
            return { action: 'VOLUME_DOWN', amount: parseInt(amount, 10) || 3 };
        }

        // 9d. Mute / Unmute / Toggle Mute
        if (lower.match(/\btoggle\s+mute\b/i) ||
            lower.match(/\b(?:mute\s*\/\s*unmute|unmute\s*\/\s*mute)\b/i) ||
            (hasTvContext && lower.match(/\b(?:toggle\s+mute|mute\s+it\s+again|toggle\s+the\s+sound)\b/i))) {
            return { action: 'MUTE' };
        }

        if (lower.match(/\bunmute\s*(?:the\s+)?(?:tv|television|roku)\b/i) ||
            lower.match(/\b(?:tv|roku)\s+unmute\b/i) ||
            lower.match(/\b(?:sound\s+on|turn\s+sound\s+on|turn\s+on\s+sound|audio\s+on)\b/i) ||
            (hasTvContext && lower.match(/\b(?:unmute|sound\s+on|audio\s+on)\b/i))) {
            return { action: 'UNMUTE' };
        }

        if (lower.match(/\b(?:mute|silence|turn\s+off\s+sound|turn\s+sound\s+off|sound\s+off|audio\s+off)\s*(?:the\s+)?(?:tv|television|roku)\b/i) ||
            lower.match(/\b(?:tv|roku)\s+(?:mute|silence)\b/i) ||
            (hasTvContext && lower.match(/\b(?:mute|silence|sound\s+off|turn\s+off\s+sound|audio\s+off)\b/i))) {
            return { action: 'MUTE' };
        }

        // 10. Playback Controls
        if (lower.match(/\b(?:pause|freeze|hold)\s*(?:the\s+)?(?:tv|movie|show|video|roku|television)\b/i) ||
            lower.match(/\b(?:tv|roku)\s+pause\b/i) ||
            (hasTvContext && lower.match(/\b(?:pause\s+playback|pause\s+it|pause)\b/i))) {
            return { action: 'PAUSE' };
        }

        if (lower.match(/\b(?:resume|unpause)\s*(?:the\s+)?(?:tv|movie|show|video|roku|television)\b/i) ||
            lower.match(/\b(?:tv|roku)\s+(?:resume|unpause)\b/i) ||
            (hasTvContext && lower.match(/\b(?:resume\s+playback|resume\s+it|unpause)\b/i))) {
            return { action: 'PLAY' };
        }

        if (lower.match(/\b(?:rewind|rev)\s*(?:the\s+)?(?:tv|movie|show|video|roku)\b/i) ||
            lower.match(/\b(?:tv|roku)\s+(?:rewind|rev)\b/i) ||
            (hasTvContext && lower.match(/\b(?:rewind|rev)\b/i))) {
            return { action: 'REWIND' };
        }

        if (lower.match(/\b(?:replay|instant\s+replay)\s*(?:the\s+)?(?:tv|movie|show|video|roku)\b/i) ||
            lower.match(/\b(?:tv|roku)\s+(?:replay|instant\s+replay)\b/i) ||
            (hasTvContext && lower.match(/\b(?:replay|instant\s+replay)\b/i))) {
            return { action: 'REPLAY' };
        }

        if (lower.match(/\b(?:fast\s+forward|fwd|skip\s+forward)\s*(?:the\s+)?(?:tv|movie|show|video|roku)\b/i) ||
            lower.match(/\b(?:tv|roku)\s+(?:fast\s+forward|fwd|skip\s+forward)\b/i) ||
            (hasTvContext && lower.match(/\b(?:fast\s+forward|fwd|skip\s+forward)\b/i))) {
            return { action: 'FAST_FORWARD' };
        }

        // 11. Channel Controls
        if (lower.match(/\b(?:tv\s+|roku\s+)?(?:channel\s+up|next\s+channel)\b/i)) {
            return { action: 'CHANNEL_UP' };
        }
        if (lower.match(/\b(?:tv\s+|roku\s+)?(?:channel\s+down|previous\s+channel|prev\s+channel)\b/i)) {
            return { action: 'CHANNEL_DOWN' };
        }

        // 12. Remote Navigation Buttons
        // OK / Select / Enter
        if (lower.match(/\b(?:press|hit|click|push)?\s*(?:ok|select|enter|confirm)\s+(?:on|in)\s+(?:the\s+)?(?:tv|roku|remote)\b/i) ||
            lower.match(/\b(?:tv|roku|remote)\s+(?:ok|select|enter)\b/i) ||
            (hasTvContext && lower.match(/\b(?:press\s+ok|press\s+enter|press\s+select|click\s+ok|click\s+enter|hit\s+enter|enter|ok|select)\b/i))) {
            return { action: 'SELECT' };
        }

        // Back / Return / Exit
        if (lower.match(/\b(?:press|hit|click|go)?\s*(?:back|return|exit|escape)\s+(?:on|in)\s+(?:the\s+)?(?:tv|roku|remote)\b/i) ||
            lower.match(/\b(?:tv|roku|remote)\s+(?:back|return|exit)\b/i) ||
            (hasTvContext && lower.match(/\b(?:press\s+back|go\s+back|back|return|exit)\b/i))) {
            return { action: 'BACK' };
        }

        // Home
        if (lower.match(/\b(?:go\s+to\s+)?(?:tv|roku)\s+home(?:\s+screen)?\b/i) ||
            lower.match(/\b(?:press|hit|click)?\s*home\s+(?:on|in)\s+(?:the\s+)?(?:tv|roku|remote)\b/i) ||
            lower.match(/\b(?:tv|roku|remote)\s+home\b/i) ||
            (hasTvContext && lower.match(/\b(?:go\s+home|home\s+screen|press\s+home|home)\b/i))) {
            return { action: 'HOME' };
        }

        // Arrows (Up, Down, Left, Right)
        if (lower.match(/\b(?:press|hit|click|go)?\s*up\s+(?:on|in)\s+(?:the\s+)?(?:tv|roku|remote)\b/i) ||
            lower.match(/\b(?:tv|roku|remote)\s+up\b/i) ||
            (hasTvContext && lower.match(/\b(?:press\s+up|arrow\s+up|go\s+up)\b/i))) {
            return { action: 'UP' };
        }
        if (lower.match(/\b(?:press|hit|click|go)?\s*down\s+(?:on|in)\s+(?:the\s+)?(?:tv|roku|remote)\b/i) ||
            lower.match(/\b(?:tv|roku|remote)\s+down\b/i) ||
            (hasTvContext && lower.match(/\b(?:press\s+down|arrow\s+down|go\s+down)\b/i))) {
            return { action: 'DOWN' };
        }
        if (lower.match(/\b(?:press|hit|click|go)?\s*left\s+(?:on|in)\s+(?:the\s+)?(?:tv|roku|remote)\b/i) ||
            lower.match(/\b(?:tv|roku|remote)\s+left\b/i) ||
            (hasTvContext && lower.match(/\b(?:press\s+left|arrow\s+left|go\s+left)\b/i))) {
            return { action: 'LEFT' };
        }
        if (lower.match(/\b(?:press|hit|click|go)?\s*right\s+(?:on|in)\s+(?:the\s+)?(?:tv|roku|remote)\b/i) ||
            lower.match(/\b(?:tv|roku|remote)\s+right\b/i) ||
            (hasTvContext && lower.match(/\b(?:press\s+right|arrow\s+right|go\s+right)\b/i))) {
            return { action: 'RIGHT' };
        }

        // Options / Star (*)
        if (lower.match(/\b(?:press|hit|click)?\s*(?:star|asterisk|\*|options|info)\s+(?:on|in)\s+(?:the\s+)?(?:tv|roku|remote)\b/i) ||
            lower.match(/\b(?:tv|roku|remote)\s+(?:star|asterisk|\*|options|info)\b/i) ||
            (hasTvContext && lower.match(/\b(?:press\s+star|options|press\s+info)\b/i))) {
            return { action: 'INFO' };
        }

        // 13. Input Switch (HDMI 1, HDMI 2, Computer, Live TV, etc.)
        const inputMatch = lower.match(/\b(?:switch|change)\s+(?:tv\s+)?(?:input\s+)?to\s+(hdmi\s*\d|av|antenna|tuner|computer|pc|live\s*tv)\b/i) ||
                           lower.match(/\b(?:switch|change)\s+to\s+(hdmi\s*\d|av|antenna|tuner|live\s*tv)\b/i) ||
                           (hasTvContext && lower.match(/\b(hdmi\s*\d|computer|pc|live\s*tv|av)\b/i));
        if (inputMatch) {
            return { action: 'SWITCH_INPUT', input: inputMatch[1].trim() };
        }

        // 14. App Launching (e.g. "open crunchyroll on tv", "watch youtube on roku", "put on netflix")
        let appName = null;
        const appOnTvMatch = lower.match(/\b(?:open|launch|start|put\s+on|watch|play|switch\s+to|load)\s+([a-z0-9+ &'.-]+?)\s+(?:on|in)\s+(?:the\s+|my\s+)?(?:roku|tv|television|screen)\b/i) ||
                             lower.match(/\b(?:tv|roku)\s+(?:open|launch|start|put\s+on|play|watch)\s+([a-z0-9+ &'.-]+)\b/i) ||
                             lower.match(/\bput\s+([a-z0-9+ &'.-]+?)\s+on\s+(?:the\s+|my\s+)?(?:tv|roku|television|screen)\b/i) ||
                             lower.match(/\bwatch\s+([a-z0-9+ &'.-]+?)\s+on\s+(?:the\s+|my\s+)?(?:tv|roku|television|screen)\b/i) ||
                             lower.match(/^!(?:tv|roku)\s+(?:open\s+|launch\s+)?([a-z0-9+ &'.-]+)/i);

        if (appOnTvMatch) {
            appName = appOnTvMatch[1].trim();
        } else if (hasTvContext) {
            const chainedAppMatch = lower.match(/\b(?:open|launch|start|put\s+on|watch)\s+([a-z0-9+ &'.-]+)\b/i);
            if (chainedAppMatch) {
                const candidate = chainedAppMatch[1].trim();
                const controlKeywords = ['the tv', 'tv', 'roku', 'the television', 'power', 'volume', 'sound', 'home', 'back', 'up', 'down', 'left', 'right', 'remote', 'settings', 'message', 'text', 'channel', 'screen'];
                if (!controlKeywords.includes(candidate)) {
                    appName = candidate;
                }
            }
        }

        if (appName) {
            const cleanApp = appName.replace(/\b(on|in)\s+(the\s+|my\s+)?(roku|tv|television|screen)\b/gi, '').trim();
            if (cleanApp && !['the tv', 'tv', 'roku', 'the television', 'power', 'volume', 'home', 'back', 'up', 'down', 'message', 'text', 'screen'].includes(cleanApp)) {
                return { action: 'LAUNCH_APP', appName: cleanApp };
            }
        }

        // 15. Write / Display Message on Screen
        const writeMsgMatch = lower.match(/\b(?:write|display|show|send|put)\s+(?:a\s+)?(?:message|text|note)\s+(?:on|to)\s+(?:the\s+|my\s+)?(?:tv|roku|television)[:\s]+["']?(.+?)["']?$/i) ||
                              lower.match(/\b(?:write|display|show|send)\s+["'](.+?)["']\s+(?:on|to)\s+(?:the\s+|my\s+)?(?:tv|roku|television)\b/i) ||
                              lower.match(/\b(?:tv|roku)\s+(?:write|display|show|message)[:\s]+["']?(.+?)["']?$/i) ||
                              lower.match(/\b(?:write|display|show)\s+(?:on|to)\s+(?:the\s+|my\s+)?(?:tv|roku)[:\s]+["']?(.+?)["']?$/i);
        if (writeMsgMatch) {
            const messageText = writeMsgMatch[1].trim();
            if (messageText) {
                return { action: 'WRITE_MESSAGE', messageText };
            }
        }

        // 16. Search
        const searchMatch = lower.match(/\bsearch\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+(?:the\s+|my\s+)?(?:roku|tv|television)\b/i) ||
                            lower.match(/\b(?:tv|roku)\s+search\s+(?:for\s+)?(.+)\b/i) ||
                            (hasTvContext && lower.match(/\bsearch\s+(?:for\s+)?(.+)\b/i));
        if (searchMatch) {
            const query = searchMatch[1].replace(/\b(on|in)\s+(the\s+)?(roku|tv|television)\b/gi, '').trim();
            if (query) {
                return { action: 'SEARCH', query };
            }
        }

        // 17. Text Input / Typing
        const typeMatch = lower.match(/\b(?:type|enter|write)\s+["']?([^"']+)["']?\s+(?:on|into)\s+(?:the\s+|my\s+)?(?:roku|tv|television)\b/i);
        if (typeMatch) {
            return { action: 'TYPE', text: typeMatch[1].trim() };
        }

        // 18. Universal TV Context Fallback:
        // As long as the user mentioned "roku tv" or "my tv", attempt to understand or provide helpful routing
        if (hasTvContext) {
            // Check for known app name directly mentioned
            for (const [appKey, appObj] of Object.entries(KNOWN_APPS)) {
                if (new RegExp(`\\b${appKey}\\b`, 'i').test(lower)) {
                    return { action: 'LAUNCH_APP', appName: appObj.name };
                }
            }
            if (lower.includes('mute')) return { action: 'MUTE' };
            if (lower.includes('volume') || lower.includes('louder')) return { action: 'VOLUME_UP' };
            if (lower.includes('quieter')) return { action: 'VOLUME_DOWN' };
            if (lower.includes('power') || lower.includes('turn on')) return { action: 'POWER_ON' };
            if (lower.includes('turn off') || lower.includes('shut down')) return { action: 'POWER_OFF' };
            if (lower.includes('reboot') || lower.includes('restart')) return { action: 'RESTART' };

            return { action: 'UNKNOWN_TV_ACTION', rawQuery: raw };
        }

        return null;
    }

    /**
     * ⚡ Execute Roku command triggered by user speech or slash command
     */
    async executeRokuCommand(user, textOrIntent) {
        const userId = String(user.id);
        const isOwner = userId === AUTHORIZED_USER_ID;
        const isGuest = !isOwner && this.isAuthorized(userId);

        const intent = typeof textOrIntent === 'object' && textOrIntent !== null 
            ? textOrIntent 
            : this.parseRokuIntent(textOrIntent);

        if (!intent) {
            return {
                success: false,
                message: "I didn't quite catch what you wanted to do with your Roku TV! You can ask me to turn it on/off, change the volume, open apps like YouTube or Netflix, search for movies, or say **\"tv help\"** to see what commands and permissions you can give or revoke."
            };
        }

        // TV Help can be viewed by anyone or owner
        if (intent.action === 'TV_HELP') {
            return {
                success: true,
                message: this.getTvHelpGuide()
            };
        }

        if (!isOwner && !isGuest) {
            return {
                success: false,
                unauthorized: true,
                message: `🔒 **Access Denied**: Roku Smart TV hardware integration is private and strictly restricted to my developer <@${AUTHORIZED_USER_ID}>.`
            };
        }

        // Restrict administrative actions to owner only
        const ADMIN_ACTIONS = [
            'SET_IP', 'DISCOVER', 'GRANT_ACCESS', 'REVOKE_ACCESS',
            'GRANT_PERMISSION', 'REVOKE_TRIES', 'REVOKE_PERMISSION'
        ];
        if (ADMIN_ACTIONS.includes(intent.action) && !isOwner) {
            return {
                success: false,
                unauthorized: true,
                message: `🔒 **Access Denied**: Only developer <@${AUTHORIZED_USER_ID}> can manage Roku TV settings, passes, and guest permissions.`
            };
        }

        // Restrict actions for guest users
        if (isGuest) {
            const allowedActions = this.getAllowedActions(userId);
            if (allowedActions) {
                const actionsToCheck = intent.action === 'COMPOSITE' 
                    ? (intent.tasks || []).map(t => t.action) 
                    : [intent.action];

                const disallowed = actionsToCheck.find(act => !allowedActions.includes(act));
                if (disallowed) {
                    const yourScopes = this.formatAllowedScopes(allowedActions);
                    const attemptedScope = this.getActionFriendlyName(disallowed);
                    return {
                        success: false,
                        unauthorized: true,
                        message: `🔒 **Permission Denied**: Your guest pass does not include permission for **${attemptedScope}**.\n*(Your pass currently allows: ${yourScopes})*`
                    };
                }
            }
        }

        if (intent.action === 'GRANT_ACCESS') {
            const count = intent.tries || 1;
            const allowed = intent.allowedActions !== undefined 
                ? intent.allowedActions 
                : this.resolveAllowedActions(intent.permissionScope || intent.rawText);
            const res = this.grantGuestAccess(intent.targetId, count, allowed);
            const total = typeof res === 'object' ? res.totalTries : res;
            const finalActions = typeof res === 'object' ? res.allowedActions : allowed;
            const scopeSummary = this.formatAllowedScopes(finalActions);
            return {
                success: true,
                message: `🎟️ **Guest Access Granted**: User <@${intent.targetId}> has been granted **${count}** ${count === 1 ? 'try' : 'tries'} for **${scopeSummary}**! (Total remaining: ${total})`
            };
        }

        if (intent.action === 'GRANT_PERMISSION') {
            const tries = intent.tries || 0;
            const res = this.grantGuestPermission(intent.targetId, intent.permissionScope || intent.rawText, tries);
            const grantedScopes = this.formatAllowedScopes(res.grantedActions);
            const totalScopes = this.formatAllowedScopes(res.allowedActions);
            const triesInfo = tries > 0 ? ` (+${tries} tries, total: ${res.totalTries})` : ` (${res.totalTries} tries remaining)`;
            return {
                success: true,
                message: `🎟️ **Permission Granted**: Added **${grantedScopes}** to <@${intent.targetId}>${triesInfo}!\n*(Active permissions: ${totalScopes})*`
            };
        }

        if (intent.action === 'REVOKE_ACCESS') {
            this.revokeGuestAccess(intent.targetId);
            return {
                success: true,
                message: `🔒 **Guest Access Revoked**: Removed all Roku TV permissions for <@${intent.targetId}>.`
            };
        }

        if (intent.action === 'REVOKE_TRIES') {
            const count = intent.count || 1;
            const res = this.revokeGuestTries(intent.targetId, count);
            if (!res.success) {
                return { success: false, message: `⚠️ ${res.message}` };
            }
            if (res.revokedFully) {
                return {
                    success: true,
                    message: `🔒 **Pass Fully Expired**: Deducted **${res.removedTries}** tries from <@${intent.targetId}>. Their guest pass has been removed.`
                };
            }
            return {
                success: true,
                message: `✂️ **Tries Revoked**: Deducted **${res.removedTries}** tries from <@${intent.targetId}>. (${res.remainingTries} tries remaining)`
            };
        }

        if (intent.action === 'REVOKE_PERMISSION') {
            const res = this.revokeGuestPermission(intent.targetId, intent.permissionScope || intent.rawText);
            if (!res.success) {
                return { success: false, message: `⚠️ ${res.message}` };
            }
            if (res.revokedFully) {
                return {
                    success: true,
                    message: `🔒 **All Permissions Revoked**: Removed all permitted scopes from <@${intent.targetId}>. Their guest pass has ended.`
                };
            }
            const revokedNames = [...new Set((res.revokedActions || []).map(a => this.getActionFriendlyName(a)))].join(', ');
            const remainingScopes = this.formatAllowedScopes(res.remainingActions);
            return {
                success: true,
                message: `🚫 **Permission Revoked**: Removed **${revokedNames}** from <@${intent.targetId}>.\n*(Remaining permissions: ${remainingScopes})*`
            };
        }

        const res = await this._executeRokuAction(intent, isOwner);

        if (isGuest && res && res.success) {
            this.consumeGuestAccess(userId);
            const remaining = this.getRemainingTries(userId);
            if (remaining > 0) {
                res.message += `\n*(🎟️ Guest pass used: ${remaining} try remaining)*`;
            } else {
                res.message += `\n*(🎟️ Guest pass used: 0 tries remaining. Your temporary access has expired.)*`;
            }
        }

        if (res && res.message) {
            res.message = this.sanitizeMessage(res.message);
        }

        return res;
    }

    async _executeRokuAction(intent, isOwner = true) {
        // 0. Composite Multi-Task Execution (e.g. "turn on tv, open youtube, and turn up volume by 5")
        if (intent.action === 'COMPOSITE') {
            const results = [];
            for (let i = 0; i < intent.tasks.length; i++) {
                const subIntent = intent.tasks[i];
                const subRes = await this._executeRokuAction(subIntent, isOwner);
                results.push({ intent: subIntent, res: subRes });
                if (i < intent.tasks.length - 1) {
                    if (subIntent.action === 'POWER_ON') {
                        await new Promise(r => setTimeout(r, 1400));
                    } else if (subIntent.action === 'LAUNCH_APP' || subIntent.action === 'SWITCH_INPUT') {
                        await new Promise(r => setTimeout(r, 1200));
                    } else {
                        await new Promise(r => setTimeout(r, 350));
                    }
                }
            }

            const bullets = results.map(r => {
                if (!r.res || !r.res.success) return `• ⚠️ Failed task: ${r.res?.message || 'Error'}`;
                const cleanMsg = (r.res.message || 'Done').replace(/^[^\w\s]+/, '').trim();
                return `• ${cleanMsg}`;
            }).join('\n');

            return {
                success: results.some(r => r.res && r.res.success),
                message: `⚡ **Completed ${results.length} tasks on your TV:**\n${bullets}`
            };
        }

        // 1. Set IP Address
        if (intent.action === 'SET_IP') {
            const ok = this.setRokuIP(intent.ip);
            if (ok) {
                const test = await this.getDeviceInfo();
                if (test) {
                    return {
                        success: true,
                        message: `✅ **Roku IP Updated!** Connected to **${test.friendlyName}** successfully.`
                    };
                }
                return {
                    success: true,
                    message: `📍 **Roku IP Updated!** Configuration saved.`
                };
            }
            return { success: false, message: `❌ Failed to save Roku IP.` };
        }

        // 2. Discover Roku on network
        if (intent.action === 'DISCOVER') {
            const disc = await this.discoverRoku(3500);
            if (disc.found) {
                const info = await this.getDeviceInfo();
                return {
                    success: true,
                    message: `📡 **Roku TV Discovered!** Found **${info?.friendlyName || 'Roku TV'}**.`
                };
            }
            return {
                success: false,
                message: `🔍 Scanned local network, but no Roku SSDP broadcast was received.`
            };
        }

        // 3. Status Query
        if (intent.action === 'STATUS') {
            const [info, activeApp] = await Promise.all([
                this.getDeviceInfo(),
                this.getActiveApp()
            ]);

            if (!info && !activeApp) {
                return {
                    success: false,
                    message: `⚠️ **Roku TV Unreachable**: Could not connect to your Roku TV.\nEnsure your TV is powered on and connected to the same Wi-Fi network.`
                };
            }

            const appText = activeApp ? `Currently running: **${activeApp.name}**` : 'Home Screen';
            const powerText = info?.powerMode ? `Power state: **${info.powerMode}**` : 'Connected';
            let msg = `📺 **${info?.friendlyName || 'Roku TV'}**\n• **Power Status:** ${powerText}\n• **Active App:** ${appText}`;

            if (isOwner && Object.keys(this.guestAccess).length > 0) {
                const guestList = Object.entries(this.guestAccess)
                    .map(([id, tries]) => `<@${id}> (${tries} try${tries > 1 ? 's' : ''})`)
                    .join(', ');
                msg += `\n• **Guest Passes:** ${guestList}`;
            }

            return {
                success: true,
                message: msg
            };
        }

        // 3b. Access List Query
        if (intent.action === 'ACCESS_LIST') {
            const guestEntries = Object.entries(this.guestAccess);
            let guestText = 'No active guest passes.';
            if (guestEntries.length > 0) {
                guestText = guestEntries.map(([id, val]) => {
                    const tries = typeof val === 'number' ? val : (val?.tries || 0);
                    const scopes = this.formatAllowedScopes(typeof val === 'object' ? val.allowedActions : null);
                    return `• <@${id}> — **${tries}** ${tries === 1 ? 'try' : 'tries'} remaining | Scopes: *${scopes}*`;
                }).join('\n');
            }
            return {
                success: true,
                message: `📺 **Roku TV Access Authorization**:\n• **Owner:** <@${AUTHORIZED_USER_ID}> (🌟 Full Access)\n${guestEntries.length > 0 ? guestText : '• ' + guestText}`
            };
        }

        // 4. Power Controls
        if (intent.action === 'POWER_ON') {
            const res = await this.powerOn();
            if (res.ok) return { success: true, message: `⚡ Turning on your **Roku TV**!` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'POWER_OFF') {
            const res = await this.powerOff();
            if (res.ok) return { success: true, message: `🌙 Turning off your **Roku TV**! Goodnight!` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'POWER_TOGGLE') {
            const res = await this.togglePower();
            if (res.ok) return { success: true, message: `🔘 Toggled power on your **Roku TV**!` };
            return this.buildErrorResponse(res);
        }

        // 5. Volume Controls
        if (intent.action === 'SET_VOLUME') {
            const target = Math.min(100, Math.max(0, parseInt(intent.targetVolume || intent.level || intent.amount, 10) || 20));
            const cfg = this.loadConfig();
            const currentVol = typeof cfg.estimatedVolume === 'number' ? cfg.estimatedVolume : 20;
            const diff = target - currentVol;
            if (diff > 0) {
                await this.volumeUp(Math.min(15, diff));
            } else if (diff < 0) {
                await this.volumeDown(Math.min(15, Math.abs(diff)));
            } else {
                await this.keypress('VolumeUp');
                await new Promise(r => setTimeout(r, 100));
                await this.keypress('VolumeDown');
            }
            cfg.estimatedVolume = target;
            this.saveConfig(cfg);
            return {
                success: true,
                message: `🔊 Adjusted volume to **${target}** on your Roku TV!`
            };
        }

        if (intent.action === 'VOLUME_UP') {
            const amt = intent.amount || 3;
            const res = await this.volumeUp(amt);
            if (res.ok) return { success: true, message: `🔊 Turned up the volume on your Roku TV (+${amt})!` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'VOLUME_DOWN') {
            const amt = intent.amount || 3;
            const res = await this.volumeDown(amt);
            if (res.ok) return { success: true, message: `🔉 Turned down the volume on your Roku TV (-${amt})!` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'MUTE' || intent.action === 'UNMUTE') {
            const res = await this.mute();
            if (res.ok) return { success: true, message: `🔇 Toggled mute on your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        // 6. Playback
        if (intent.action === 'PAUSE' || intent.action === 'PLAY') {
            const res = await this.play();
            const actionText = intent.action === 'PAUSE' ? 'Paused' : 'Playing / Resumed';
            if (res.ok) return { success: true, message: `⏯️ **${actionText}** playback on your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'REPLAY') {
            const res = await this.replay();
            if (res.ok) return { success: true, message: `⏪ Replayed the last scene on your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'FAST_FORWARD') {
            const res = await this.fastForward();
            if (res.ok) return { success: true, message: `⏩ Fast-forwarded playback on your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        // 7. Navigation
        if (intent.action === 'HOME') {
            const res = await this.home();
            if (res.ok) return { success: true, message: `🏠 Returned to the **Home Screen** on your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'BACK') {
            const res = await this.back();
            if (res.ok) return { success: true, message: `↩️ Pressed **Back** on your Roku TV.` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'SELECT') {
            const res = await this.select();
            if (res.ok) return { success: true, message: `👌 Pressed **OK / Select** on your Roku TV.` };
            return this.buildErrorResponse(res);
        }

        if (['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(intent.action)) {
            const key = intent.action.charAt(0) + intent.action.slice(1).toLowerCase();
            const res = await this.keypress(key);
            if (res.ok) return { success: true, message: `🎯 Pressed **${key}** on your Roku remote.` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'INFO') {
            const res = await this.info();
            if (res.ok) return { success: true, message: `⭐ Pressed **Options / Info (*)** on your Roku TV.` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'REWIND') {
            const res = await this.rewind();
            if (res.ok) return { success: true, message: `⏪ Rewound playback on your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        // 8. Launch App
        if (intent.action === 'LAUNCH_APP') {
            const res = await this.launchApp(intent.appName);
            if (res.ok) {
                if (res.message) {
                    return { success: true, message: res.message };
                }
                return { success: true, message: `🚀 Launched **${res.appName}** on your Roku TV!` };
            }
            if (res.error) {
                return { success: false, message: `⚠️ ${res.error}` };
            }
            return this.buildErrorResponse(res);
        }

        // 9. Search
        if (intent.action === 'SEARCH') {
            const res = await this.search(intent.query);
            if (res.ok) return { success: true, message: `🔍 Searched for **"${intent.query}"** on your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        // 10. Type Text
        if (intent.action === 'TYPE') {
            const res = await this.typeText(intent.text);
            if (res.ok) return { success: true, message: `⌨️ Typed **"${intent.text}"** into your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        // 11. Switch Input
        if (intent.action === 'SWITCH_INPUT') {
            const res = await this.switchInput(intent.input);
            if (res.ok) return { success: true, message: `🔌 Switched input to **${intent.input.toUpperCase()}** on your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        // 12. Channel Controls
        if (intent.action === 'CHANNEL_UP') {
            const res = await this.channelUp();
            if (res.ok) return { success: true, message: `📺 Changed channel up on your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'CHANNEL_DOWN') {
            const res = await this.channelDown();
            if (res.ok) return { success: true, message: `📺 Changed channel down on your Roku TV!` };
            return this.buildErrorResponse(res);
        }

        // 13. System Restart
        if (intent.action === 'RESTART') {
            const res = await this.restart();
            if (res.ok) {
                return {
                    success: true,
                    message: `🔄 **Roku TV Reboot Triggered**: Dispatched hardware restart sequence to your Roku TV (\`${this.ip}\`). It will reboot momentarily!`
                };
            }
            return this.buildErrorResponse(res);
        }

        // 14. Write / Display Message on Screen
        if (intent.action === 'WRITE_MESSAGE') {
            const textToWrite = intent.messageText || intent.text;
            const res = await this.writeMessage(textToWrite);
            if (res.ok) {
                return {
                    success: true,
                    message: `✍️ **Message Displayed on TV Screen**: Successfully displayed \`"${textToWrite}"\` on your Roku TV!`
                };
            }
            return this.buildErrorResponse(res);
        }

        if (intent.action === 'TV_HELP') {
            return {
                success: true,
                message: this.getTvHelpGuide()
            };
        }

        if (intent.action === 'UNKNOWN_TV_ACTION') {
            return {
                success: false,
                message: `📺 I recognized you want to control your TV, but wasn't certain what command to run for \`"${intent.rawQuery || 'your request'}"\`.\nTry asking me to **turn on/off**, **set volume to 25**, **mute**, **pause/play**, **open Crunchyroll**, or say **"tv help"** to see everything I can do!`
            };
        }

        return { success: false, message: `Unrecognized Roku action.` };
    }

    buildErrorResponse(res) {
        if (res && res.status === 404) {
            return {
                success: false,
                message: `⚠️ That channel or app was not found on your Roku TV.`
            };
        }
        return {
            success: false,
            message: `⚠️ Could not reach your Smart TV. Please ensure the TV is powered on and connected to the local network.`
        };
    }

    /**
     * 🛡️ Privacy Sanitizer: Strips private IP addresses, ports, MACs, and hardware IDs
     */
    sanitizeMessage(text) {
        if (!text || typeof text !== 'string') return text;
        let clean = text;
        if (this.ip) {
            clean = clean.split(this.ip).join('');
        }
        // Remove parenthesized IP addresses like "( 10.0.0.245 )" or "(10.0.0.245)" or empty parentheses "( )"
        clean = clean.replace(/\(\s*(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?)?\s*\)/g, '');
        // Scrub any remaining raw IP addresses
        clean = clean.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g, '');
        // Scrub IPv6 addresses
        clean = clean.replace(/\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g, '');
        // Scrub port :8060
        clean = clean.replace(/:8060\b/g, '');
        // Scrub MAC addresses (e.g. 84:c8:a0:cc:f2:a9)
        clean = clean.replace(/\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b/g, '');
        // Scrub known serial numbers
        clean = clean.replace(/\bX01200U6J7EM\b/gi, '');
        // Scrub internal hardware model strings & model lines
        clean = clean.replace(/•\s*\*\*Model:\*\*[^\n]*\n?/gi, '');
        clean = clean.replace(/\b100133204\b/g, '');
        clean = clean.replace(/\bG829X\b/g, '');
        // Scrub !roku ip commands
        clean = clean.replace(/!roku\s+ip\s+<[^>]+>/gi, '');
        clean = clean.replace(/!roku\s+ip\s+\S+/gi, '');
        // Clean up any stray empty parentheses
        clean = clean.replace(/\(\s*\)/g, '');
        // Clean up any double spaces left behind
        clean = clean.replace(/[ \t]{2,}/g, ' ');
        return clean.trim();
    }
}

module.exports = new RokuController();
