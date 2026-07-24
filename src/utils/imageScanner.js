const Tesseract = require('tesseract.js');
const axios = require('axios');

// Dictionary of high-risk keywords often present in crypto/airdrop image scams
const SCAM_KEYWORDS = [
    'airdrop',
    'crypto',
    'eth giveaway',
    'giveaway',
    'claim now',
    'scan qr',
    'pancakeswap',
    'metamask',
    'trust wallet',
    'free tokens',
    'claim airdrop',
    'connect wallet'
];

// Regexes targeting fraudulent domain formats and malicious redirect patterns
const FRAUDULENT_DOMAIN_PATTERNS = [
    /https?:\/\/[a-z0-9\-]+(?:claim|airdrop|gift|giveaway|drop|wallet|token|pancake|meta)[a-z0-9\-]*\.(?:xyz|info|gift|cc|click|net|org|ru|top|pw)/i,
    /https?:\/\/(?:pancakeswap|metamask|trustwallet)\-[a-z0-9\-]+\.[a-z]+/i,
    /(?:claim|airdrop|scan|gift|now)\.(?:xyz|info|gift|cc|click)/i
];

/**
 * Scans an image URL or buffer using Tesseract OCR.
 * Checks for high-risk scam keywords and domain patterns.
 * @param {string|Buffer} imageSource - URL or Buffer of the image
 * @returns {Promise<{flagged: boolean, reason: string, text: string}>}
 */
async function scanImage(imageSource) {
    try {
        let buffer = imageSource;

        // If a URL is passed, download it to a Buffer
        if (typeof imageSource === 'string' && imageSource.startsWith('http')) {
            const response = await axios.get(imageSource, { responseType: 'arraybuffer', timeout: 5000 });
            buffer = Buffer.from(response.data);
        }

        // Run OCR text extraction
        const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
        if (!text) {
            return { flagged: false, reason: '', text: '' };
        }

        const cleanText = text.toLowerCase().trim();

        // 1. Keyword matching
        const matchedKeywords = [];
        for (const keyword of SCAM_KEYWORDS) {
            if (cleanText.includes(keyword)) {
                matchedKeywords.push(keyword.toUpperCase());
            }
        }

        // 2. Fraudulent domain checking
        const matchedDomains = [];
        for (const regex of FRAUDULENT_DOMAIN_PATTERNS) {
            const match = text.match(regex);
            if (match) {
                matchedDomains.push(match[0]);
            }
        }

        // Classification thresholds:
        // Flag if:
        // - We match a fraudulent domain regex, OR
        // - We match 2 or more scam keywords, OR
        // - We match a critical scam phrase (e.g. "ETH GIVEAWAY", "CLAIM NOW", "SCAN QR")
        let flagged = false;
        let reason = '';

        if (matchedDomains.length > 0) {
            flagged = true;
            reason = `Fraudulent URL/Domain pattern matched in OCR text: ${matchedDomains.join(', ')}`;
        } else if (matchedKeywords.length >= 2) {
            flagged = true;
            reason = `Multiple scam keywords flagged in OCR text: ${matchedKeywords.join(', ')}`;
        } else if (matchedKeywords.some(k => ['ETH GIVEAWAY', 'CLAIM NOW', 'SCAN QR', 'PANCAKESWAP', 'METAMASK'].includes(k))) {
            flagged = true;
            reason = `Critical scam keyword flagged in OCR text: ${matchedKeywords.join(', ')}`;
        }

        return {
            flagged,
            reason,
            text
        };
    } catch (error) {
        console.error('[OCR Image Scanner Error]:', error.message);
        return { flagged: false, reason: '', text: '' };
    }
}

module.exports = { scanImage };
