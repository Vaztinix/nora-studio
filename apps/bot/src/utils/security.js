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
    }
};
