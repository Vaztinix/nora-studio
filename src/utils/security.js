/**
 * Nora System Security Logic - V18.0 Hardening Unit
 * Provides proxy layers, sanitizer logic, and AES-256-GCM encryption for sensitive database fields.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// 🔐 AES-256-GCM Encryption for sensitive database fields (bot tokens, etc.)
// ─────────────────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY_HEX_LENGTH = 64; // 32 bytes = 256-bit

/**
 * Ensures an ENCRYPTION_KEY exists in the environment.
 * If missing, a cryptographically secure key is auto-generated and appended to .env
 */
function initEncryptionKey() {
    if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length === ENCRYPTION_KEY_HEX_LENGTH) {
        return; // Already initialized
    }

    const newKey = crypto.randomBytes(32).toString('hex');
    process.env.ENCRYPTION_KEY = newKey;

    // Append to .env file so it persists across restarts
    try {
        const envPath = path.join(__dirname, '../../.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            if (!content.includes('ENCRYPTION_KEY=')) {
                fs.appendFileSync(envPath, `\nENCRYPTION_KEY=${newKey}\n`);
                console.log('[Security] Auto-generated ENCRYPTION_KEY and saved to .env');
            }
        }
    } catch (e) {
        console.warn('[Security] Could not persist ENCRYPTION_KEY to .env:', e.message);
    }
}

// Initialize on module load
initEncryptionKey();

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a colon-separated string: iv:authTag:ciphertext (all hex-encoded)
 * @param {string} plaintext
 * @returns {string} encrypted string or original value if encryption fails
 */
function encrypt(plaintext) {
    if (!plaintext) return plaintext;

    // If already encrypted (contains our format iv:authTag:data), skip
    if (isEncrypted(plaintext)) return plaintext;

    try {
        const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
        const iv = crypto.randomBytes(12); // 96-bit IV for GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (e) {
        console.error('[Security] Encryption failed:', e.message);
        return plaintext; // Fail-open: return original to prevent data loss
    }
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Supports legacy plain-text values (returns them as-is for backwards compatibility).
 * @param {string} ciphertext
 * @returns {string} decrypted plaintext or original value if not encrypted
 */
function decrypt(ciphertext) {
    if (!ciphertext) return ciphertext;

    // Legacy plain-text token support: if not in our format, return as-is
    if (!isEncrypted(ciphertext)) return ciphertext;

    try {
        const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
        const parts = ciphertext.split(':');
        if (parts.length !== 3) return ciphertext;

        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('[Security] Decryption failed:', e.message);
        return ciphertext; // Fail-open: return ciphertext to avoid data loss
    }
}

/**
 * Checks if a string is in our encrypted format (iv:authTag:data).
 * @param {string} str
 * @returns {boolean}
 */
function isEncrypted(str) {
    if (typeof str !== 'string') return false;
    const parts = str.split(':');
    // iv=24 hex chars (12 bytes), authTag=32 hex chars (16 bytes), data=variable
    return parts.length === 3 && parts[0].length === 24 && parts[1].length === 32;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🌐 Secure Proxy Domain (Your Cloudflare-protected gateway)
// ─────────────────────────────────────────────────────────────────────────────

const SAFE_LINK_PREFIX = 'https://nora.ink/safe-link?url=';

module.exports = {
    encrypt,
    decrypt,
    isEncrypted,
    initEncryptionKey,

    /**
     * Prepend the safe-link proxy to external URLs.
     * Prevents IP logging and malicious tracking before the user lands.
     */
    secureLink: (url) => {
        if (!url) return '';
        // If it's already secured or an internal Discord link, don't double-proxy.
        if (url.includes('nora.ink') || url.includes('discord.com/api')) return url;
        return `${SAFE_LINK_PREFIX}${encodeURIComponent(url)}`;
    },

    /**
     * Sanitizes strings to prevent common Discord.js / Terminal escape sequences.
     */
    sanitize: (str) => {
        if (typeof str !== 'string') return str;
        return str.replace(/[`|@]/g, ''); // Basic injection prevention
    },

    /**
     * Validates external URLs to prevent SSRF (Server-Side Request Forgery).
     * Rejects non-HTTP/HTTPS protocols and private/loopback/metadata IP ranges.
     * @param {string} urlStr
     * @returns {boolean}
     */
    validateExternalUrl: (urlStr) => {
        if (!urlStr || typeof urlStr !== 'string') return false;
        try {
            const parsed = new URL(urlStr);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return false;
            }

            const hostname = parsed.hostname.toLowerCase().trim();

            // Block loopback, local, and metadata IP addresses/hostnames
            if (
                hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname === '0.0.0.0' ||
                hostname === '::1' ||
                hostname === '169.254.169.254' ||
                hostname.endsWith('.local') ||
                hostname.endsWith('.internal')
            ) {
                return false;
            }

            // Block private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16)
            const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
            if (ipMatch) {
                const [, p1, p2] = ipMatch.map(Number);
                if (p1 === 10) return false;
                if (p1 === 172 && p2 >= 16 && p2 <= 31) return false;
                if (p1 === 192 && p2 === 168) return false;
                if (p1 === 169 && p2 === 254) return false;
                if (p1 === 127) return false;
                if (p1 === 0) return false;
            }

            return true;
        } catch (e) {
            return false;
        }
    },

    /**
     * Generates a cryptographically secure random hex string.
     * Replaces insecure Math.random() usage for tokens and secrets.
     * @param {number} bytes
     * @returns {string}
     */
    secureRandomString: (bytes = 16) => {
        return crypto.randomBytes(bytes).toString('hex');
    },

    /**
     * Ensures an input parameter is a non-empty string to prevent Type Confusion attacks.
     * @param {*} val
     * @param {string} fallback
     * @returns {string}
     */
    ensureString: (val, fallback = '') => {
        if (typeof val === 'string') return val;
        if (typeof val === 'number') return String(val);
        return fallback;
    },

    /**
     * Escapes HTML entities to prevent DOM XSS vulnerabilities.
     * @param {string} str
     * @returns {string}
     */
    escapeHtml: (str) => {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    /**
     * Validates an external URL to prevent Server-Side Request Forgery (SSRF).
     * Rejects non-HTTP(S) protocols and private/internal IP ranges.
     * @param {string} urlStr
     * @returns {boolean}
     */
    validateExternalUrl: (urlStr) => {
        try {
            if (!urlStr || typeof urlStr !== 'string') return false;
            const parsed = new URL(urlStr);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return false;
            }
            const host = parsed.hostname.toLowerCase();
            if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '[::1]' || host === '169.254.169.254') {
                return false;
            }
            if (/^(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host)) {
                return false;
            }
            if (/^(fc00|fd00|fe80)/i.test(host)) {
                return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }
};
