const axios = require('axios');
const { AttachmentBuilder } = require('discord.js');

/**
 * 🎨 Nora AI Image Generator
 * Generates high-quality AI images using Pollinations / Flux with prompt enhancement.
 */

/**
 * Check if the text is asking to generate or draw an image
 * @param {string} text 
 * @returns {boolean}
 */
function isImageGenerationPrompt(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase().trim();
    
    // Explicit trigger phrases
    const triggers = [
        /^(?:draw|generate|create|paint|render|make)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|artwork|drawing|render|art|illustration)\s+(?:of\s+|about\s+)?(.+)/i,
        /^(?:can you\s+)?(?:draw|generate|create|paint|make)\s+(?:me\s+)?(.+)\s+as\s+(?:an?\s+)?(?:image|picture|photo|drawing|art)/i,
        /^(?:draw|paint|illustrate)\s+(.+)/i,
        /^\/(?:imagine|draw|generate)\s+(.+)/i
    ];

    for (const regex of triggers) {
        const match = lower.match(regex);
        if (match && match[1] && match[1].trim().length > 2) {
            // Avoid false positives for code or math
            if (!match[1].startsWith('a conclusion') && !match[1].startsWith('a function') && !match[1].startsWith('a chart')) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Extract clean subject prompt for image generator
 * @param {string} text 
 * @returns {string}
 */
function extractImageSubject(text) {
    let clean = text.replace(/<@!?\d+>/g, '').trim();
    const triggers = [
        /^(?:draw|generate|create|paint|render|make)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|artwork|drawing|render|art|illustration)\s+(?:of\s+|about\s+)?/i,
        /^(?:can you\s+)?(?:draw|generate|create|paint|make)\s+(?:me\s+)?/i,
        /^(?:draw|paint|illustrate)\s+/i,
        /^\/(?:imagine|draw|generate)\s+/i
    ];

    for (const regex of triggers) {
        clean = clean.replace(regex, '');
    }

    clean = clean.replace(/\s+as\s+(?:an?\s+)?(?:image|picture|photo|drawing|art)$/i, '');
    return clean.trim() || text.trim();
}

/**
 * Generate an image from a text prompt
 * @param {string} prompt 
 * @returns {Promise<{ buffer: Buffer, filename: string, enhancedPrompt: string }>}
 */
async function generateAIImage(prompt) {
    const rawSubject = extractImageSubject(prompt);
    const safePrompt = encodeURIComponent(rawSubject.substring(0, 300));
    const seed = Math.floor(Math.random() * 1000000);

    // Primary endpoint: Pollinations Flux Model
    const endpoints = [
        `https://image.pollinations.ai/prompt/${safePrompt}?model=flux&width=1024&height=1024&nologo=true&seed=${seed}`,
        `https://image.pollinations.ai/prompt/${safePrompt}?model=turbo&width=1024&height=1024&nologo=true&seed=${seed}`,
        `https://image.pollinations.ai/prompt/${safePrompt}?width=1024&height=1024&nologo=true&seed=${seed}`
    ];

    let lastError = null;
    for (const url of endpoints) {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 25000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NoraBot/1.0'
                }
            });

            if (response.status === 200 && response.data && response.data.length > 1000) {
                const filename = `nora_art_${Date.now()}.png`;
                return {
                    buffer: Buffer.from(response.data),
                    filename,
                    enhancedPrompt: rawSubject
                };
            }
        } catch (err) {
            lastError = err;
            console.warn(`[AI Image Generator] Endpoint failed (${err.message}), trying next fallback...`);
        }
    }

    throw lastError || new Error('Failed to generate image from all image services');
}

module.exports = {
    isImageGenerationPrompt,
    extractImageSubject,
    generateAIImage
};
