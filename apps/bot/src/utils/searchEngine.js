const axios = require('axios');

/**
 * Nora Search Engine - Privacy First
 * Uses DuckDuckGo's Lite API to fetch real-time knowledge without tracking.
 */
async function searchWeb(query) {
    try {
        // We use the JSON API (DuckDuckGo Instant Answer or similar) 
        // fallback to a clean search if no instant answer.
        const response = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
        
        if (response.data.AbstractText) {
            return response.data.AbstractText;
        }

        if (response.data.RelatedTopics && response.data.RelatedTopics.length > 0) {
            return response.data.RelatedTopics[0].Text;
        }

        return null;
    } catch (error) {
        console.error('[Search Engine] Failure:', error.message);
        return null;
    }
}

module.exports = { searchWeb };
