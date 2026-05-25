/**
 * Nora System Security Logic - V17.1 Hardening Unit
 * This utility provides the proxy layers and sanitizer logic for user protection.
 */

// 🌐 Secure Proxy Domain (Your Cloudflare-protected gateway)
const SAFE_LINK_PREFIX = 'https://nora.ink/safe-link?url=';

module.exports = {
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
