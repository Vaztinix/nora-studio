const axios = require('axios');

/**
 * 🌐 Nora Multi-Source Web Search Engine
 * Privacy-first real-time web intelligence querying Wikipedia, DuckDuckGo, and Tech News.
 */
function stripHtmlTags(str) {
    if (!str || typeof str !== 'string') return '';
    let prev;
    let clean = str;
    do {
        prev = clean;
        clean = clean.replace(/<[^>]*>/g, '');
    } while (clean !== prev);
    return clean.trim();
}

async function searchWeb(query) {
    if (!query || typeof query !== 'string' || query.trim().length < 2) return null;
    const cleanQuery = query.trim().replace(/^nora\s+/i, '').replace(/^(?:search(?:\s+the\s+web)?(?:\s+for)?|look\s+up|google)\s+/i, '').trim();
    if (!cleanQuery) return null;

    const results = [];

    // 1. Wikipedia Encyclopedia Knowledge
    try {
        const wikiRes = await axios.get('https://en.wikipedia.org/w/api.php', {
            params: {
                action: 'query',
                list: 'search',
                srsearch: cleanQuery,
                utf8: 1,
                format: 'json',
                srlimit: 2
            },
            timeout: 4000,
            headers: { 'User-Agent': 'NoraBot/2.0 (https://vaztinix.dev; contact@vaztinix.dev)' }
        });
        const items = wikiRes.data?.query?.search || [];
        for (const item of items) {
            results.push({
                source: 'Wikipedia',
                title: item.title,
                snippet: stripHtmlTags(item.snippet)
            });
        }
    } catch (e) {}

    // 2. DuckDuckGo Instant Answer
    try {
        const ddgRes = await axios.get('https://api.duckduckgo.com/', {
            params: {
                q: cleanQuery,
                format: 'json',
                no_html: 1,
                skip_disambig: 1
            },
            timeout: 4000
        });
        if (ddgRes.data?.AbstractText) {
            results.push({
                source: 'DuckDuckGo Instant Answer',
                title: ddgRes.data.Heading || cleanQuery,
                snippet: ddgRes.data.AbstractText
            });
        }
    } catch (e) {}

    // 3. Current Tech Discussions & News
    try {
        const hnRes = await axios.get('https://hn.algolia.com/api/v1/search', {
            params: {
                query: cleanQuery,
                tags: 'story',
                hitsPerPage: 2
            },
            timeout: 4000
        });
        const hits = hnRes.data?.hits || [];
        for (const hit of hits) {
            if (hit.title) {
                results.push({
                    source: 'Web & Tech News',
                    title: hit.title,
                    snippet: hit.story_text ? hit.story_text.slice(0, 150) : `Reference: ${hit.url || ''}`
                });
            }
        }
    } catch (e) {}

    if (results.length === 0) return null;

    return results.map(r => `• [${r.source}] **${r.title}**: ${r.snippet}`).join('\n');
}

function isSearchQuery(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase().trim();
    return /\b(search(\s+the\s+web)?(\s+for)?|look\s+up|google|who\s+is|what\s+is\s+the\s+latest|latest\s+news|what\s+happened\s+with|tell\s+me\s+about|wikipedia)\b/i.test(lower);
}

module.exports = { searchWeb, isSearchQuery };
