const axios = require('axios');
const geminiKeyManager = require('./geminiKeyManager');

/**
 * 🎨 Nora AI Image Generator - Powered Exclusively by Google Imagen 3
 * All non-Google third-party image generation services have been removed.
 * Strictly enforces Google's enterprise safety filters to prevent sexual, explicit, or inappropriate content.
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
 * Generate an image using Google's official Imagen 3 model via Google Gemini API
 * Strictly enforces Google safety filtering: blocks NSFW, sexual content, and harmful requests.
 * @param {string} prompt 
 * @returns {Promise<{ buffer: Buffer, filename: string, enhancedPrompt: string }>}
 */
async function generateAIImage(prompt) {
    const rawSubject = extractImageSubject(prompt);
    if (!rawSubject || rawSubject.length < 2) {
        throw new Error('Please specify what you would like Google Imagen to create.');
    }

    const availableKeys = geminiKeyManager.getRotatedAvailableKeys();
    if (!availableKeys || availableKeys.length === 0) {
        throw new Error('No Google Gemini API keys are currently available for image generation.');
    }

    let lastError = null;

    for (const apiKey of availableKeys) {
        try {
            // Google Imagen 3 generate endpoint
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
            
            const payload = {
                instances: [
                    { prompt: rawSubject }
                ],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: "1:1",
                    personGeneration: "ALLOW_ADULT",
                    safetyFilterLevel: "block_low_and_above"
                }
            };

            const response = await axios.post(endpoint, payload, {
                timeout: 35000,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'NoraBot-GoogleImagen/2.0'
                }
            });

            if (response.data && response.data.predictions && response.data.predictions[0]) {
                const prediction = response.data.predictions[0];
                const base64Data = prediction.bytesBase64Encoded;
                if (base64Data) {
                    const buffer = Buffer.from(base64Data, 'base64');
                    const filename = `nora_imagen_${Date.now()}.png`;
                    return {
                        buffer,
                        filename,
                        enhancedPrompt: rawSubject
                    };
                }
            }

            // If safety filter triggered or empty output
            if (response.data && response.data.error) {
                throw new Error(response.data.error.message || 'Google Safety Filter blocked this request');
            }
        } catch (err) {
            lastError = err;
            const msg = (err?.response?.data?.error?.message || err?.message || '').toLowerCase();
            
            if (msg.includes('safety') || msg.includes('blocked') || msg.includes('filtered') || msg.includes('prohibited')) {
                throw new Error('Google Safety Filters blocked this image request. Inappropriate or sexual content is strictly forbidden.');
            }

            console.warn(`[Google Imagen 3] Request failed with key ...${apiKey.slice(-6)}:`, err?.message || err);
        }
    }

    throw lastError || new Error('Google Imagen 3 was unable to generate the requested image.');
}

module.exports = {
    isImageGenerationPrompt,
    extractImageSubject,
    generateAIImage
};
