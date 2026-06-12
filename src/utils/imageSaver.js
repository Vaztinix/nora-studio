const fs = require('fs');
const path = require('path');

/**
 * Decodes a base64 image string, saves it to the local uploads directory,
 * and returns the hosted URL. If the input is not base64, returns it as-is.
 * @param {string} base64Data 
 * @param {string} prefix 
 * @returns {string} The public hosted URL or the original string
 */
function saveBase64Image(base64Data, prefix = 'img') {
    if (!base64Data || typeof base64Data !== 'string') return base64Data;
    
    // Match base64 data URL format
    const matches = base64Data.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) {
        return base64Data;
    }
    
    const mimeType = matches[1];
    let ext = 'png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
        ext = 'jpg';
    } else if (mimeType.includes('gif')) {
        ext = 'gif';
    } else if (mimeType.includes('webp')) {
        ext = 'webp';
    } else if (mimeType.includes('svg')) {
        ext = 'svg';
    }
    
    const data = matches[2];
    const buffer = Buffer.from(data, 'base64');
    
    // Save directory: src/web/uploads/
    const uploadsDir = path.join(__dirname, '../web/uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = path.join(uploadsDir, filename);
    
    fs.writeFileSync(filePath, buffer);
    
    const API_BASE = (process.env.API_BASE_URL || 'https://api.vaztinix.dev').replace(/\/$/, '');
    return `${API_BASE}/uploads/${filename}`;
}

module.exports = { saveBase64Image };
