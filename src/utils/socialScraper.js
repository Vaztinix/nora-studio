const axios = require('axios');
const xml2js = require('xml2js');
const ContentFeed = require('../database/models/ContentFeed');

// In-memory cache to prevent duplicate alerts
const alertsCache = new Set();

// Common headers to mimic a real browser
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

async function getYoutubeChannelId(handle) {
    try {
        // Clean the handle - remove @ if present
        const cleanHandle = handle.replace(/^@/, '');
        const res = await axios.get(`https://www.youtube.com/@${cleanHandle}`, {
            headers: BROWSER_HEADERS
        });
        const html = res.data;
        const match = html.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
        return match ? match[1] : null;
    } catch (e) {
        console.error(`Error resolving YouTube handle @${handle}:`, e.message);
        return null;
    }
}

/**
 * Check if a video ID is a YouTube Short by trying the /shorts/ URL.
 * Returns true if the video is a Short.
 */
async function isYoutubeShort(videoId) {
    try {
        const res = await axios.get(`https://www.youtube.com/shorts/${videoId}`, {
            headers: BROWSER_HEADERS,
            maxRedirects: 0,
            validateStatus: (status) => status < 400
        });
        // If we get a 200 on /shorts/{id}, it IS a short
        return true;
    } catch (e) {
        // 303/302 redirect to /watch?v= means it's NOT a short, or 404
        if (e.response && (e.response.status === 303 || e.response.status === 302)) {
            const location = e.response.headers?.location || '';
            if (location.includes('/watch?v=')) return false;
        }
        return false;
    }
}

/**
 * Scrape the latest Short from a YouTube channel using the @handle format.
 * YouTube now uses /@handle/shorts instead of /channel/{id}/shorts.
 */
async function scrapeLatestShort(handle, channelId) {
    try {
        const cleanHandle = handle.replace(/^@/, '');
        // Try @handle/shorts first (modern YouTube format)
        let res;
        try {
            res = await axios.get(`https://www.youtube.com/@${cleanHandle}/shorts`, {
                headers: BROWSER_HEADERS
            });
        } catch (e) {
            // Fallback to /channel/ path if @handle fails
            if (channelId) {
                res = await axios.get(`https://www.youtube.com/channel/${channelId}/shorts`, {
                    headers: BROWSER_HEADERS
                });
            } else {
                throw e;
            }
        }

        const html = res.data;
        const shortIdMatch = html.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
        if (!shortIdMatch) return null;
        const id = shortIdMatch[1];

        // Try to extract title from ytInitialData inside HTML
        let title = 'a new Short';
        // Try multiple patterns YouTube uses for titles
        const titlePatterns = [
            /"title":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"/,
            /"title":\s*\{\s*"accessibility":\s*\{\s*"accessibilityData":\s*\{\s*"label":\s*"([^"]+)"/,
            /"title":\s*"([^"]+)"/
        ];
        for (const pattern of titlePatterns) {
            const titleMatch = html.match(pattern);
            if (titleMatch && titleMatch[1] && titleMatch[1] !== 'Shorts') {
                title = titleMatch[1];
                break;
            }
        }

        return {
            id,
            title,
            link: `https://youtube.com/shorts/${id}`
        };
    } catch (e) {
        console.error(`[Social Scraper] Error scraping shorts for @${handle}:`, e.message);
        return null;
    }
}

/**
 * Check if a YouTube channel is currently live using the @handle format.
 * YouTube now uses /@handle/live instead of /channel/{id}/live.
 */
async function scrapeLiveStatus(handle, channelId) {
    try {
        const cleanHandle = handle.replace(/^@/, '');
        let res;
        try {
            res = await axios.get(`https://www.youtube.com/@${cleanHandle}/live`, {
                headers: BROWSER_HEADERS,
                maxRedirects: 5
            });
        } catch (e) {
            // Fallback to /channel/ path if @handle fails
            if (channelId) {
                res = await axios.get(`https://www.youtube.com/channel/${channelId}/live`, {
                    headers: BROWSER_HEADERS,
                    maxRedirects: 5
                });
            } else {
                throw e;
            }
        }
        
        const responseUrl = res.request?.res?.responseUrl || '';
        const path = res.request?.path || '';
        const isLiveUrl = responseUrl.includes('watch?v=') || responseUrl.includes('/live/') || path.includes('watch?v=') || path.includes('/live/');
        
        if (!isLiveUrl) return null;

        let id = '';
        if (responseUrl.includes('watch?v=')) {
            id = responseUrl.split('watch?v=')[1].split('&')[0];
        } else if (responseUrl.includes('/live/')) {
            id = responseUrl.split('/live/')[1].split('?')[0];
        } else if (path.includes('watch?v=')) {
            id = path.split('watch?v=')[1].split('&')[0];
        } else if (path.includes('/live/')) {
            id = path.split('/live/')[1].split('?')[0];
        }

        if (!id) return null;

        // Verify this is actually a live stream, not just a past video
        const html = res.data;
        const isActuallyLive = html.includes('"isLive":true') || 
                               html.includes('"isLiveNow":true') ||
                               html.includes('"liveBadge"') ||
                               html.includes('"LIVE"');
        
        if (!isActuallyLive) return null;

        // Extract stream title
        let title = 'Live Stream';
        const titleMatch = html.match(/<title>(.+?)<\/title>/);
        if (titleMatch && titleMatch[1]) {
            title = titleMatch[1].replace(' - YouTube', '');
        }

        return {
            id,
            title,
            link: `https://youtube.com/watch?v=${id}`
        };
    } catch (e) {
        // A 404 or redirect to channel main page means they are offline
        return null;
    }
}

async function checkYoutube(feed, client) {
    try {
        const handle = feed.publicHandle;
        let channelId = feed.channelId;

        // Resolve channel ID if we don't have one
        if (!channelId || !channelId.startsWith('UC')) {
            channelId = await getYoutubeChannelId(handle);
            if (channelId) {
                await feed.update({ channelId });
            }
        }
        if (!channelId) {
            console.error(`[Social Scraper] Could not resolve channel ID for @${handle}`);
            return;
        }

        // Parse state JSON
        let lastIds = { video: null, short: null, live: null };
        if (feed.lastVideoId) {
            try {
                lastIds = JSON.parse(feed.lastVideoId);
            } catch (e) {
                // Backward compatibility: treat lastVideoId as the video id
                lastIds = { video: feed.lastVideoId, short: null, live: null };
            }
        }

        // Parse alert templates
        let templates = { video: '', short: '', live: '' };
        if (feed.alertTemplate) {
            try {
                const parsed = JSON.parse(feed.alertTemplate);
                templates.video = parsed.video || '';
                templates.short = parsed.short || '';
                templates.live = parsed.live || '';
            } catch (e) {
                // Backward compatibility: use alertTemplate for all
                templates.video = feed.alertTemplate;
                templates.short = feed.alertTemplate;
                templates.live = feed.alertTemplate;
            }
        }

        const guild = client.guilds.cache.get(feed.guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(feed.targetChannelId);
        if (!channel) return;

        // 1. Check Standard Videos via RSS feed
        try {
            const res = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
            const parser = new xml2js.Parser();
            const result = await parser.parseStringPromise(res.data);
            
            if (result.feed && result.feed.entry && result.feed.entry.length > 0) {
                const latest = result.feed.entry[0];
                const videoId = latest['yt:videoId'][0];
                const title = latest.title[0];
                const author = latest.author[0].name[0];
                const link = latest.link[0].$.href;

                // Check if this video is actually a Short
                const videoIsShort = await isYoutubeShort(videoId);

                if (videoIsShort) {
                    // This RSS entry is actually a Short
                    if (!lastIds.short) {
                        lastIds.short = videoId;
                        await feed.update({ lastVideoId: JSON.stringify(lastIds) });
                    } else if (lastIds.short !== videoId) {
                        lastIds.short = videoId;
                        await feed.update({ lastVideoId: JSON.stringify(lastIds) });

                        const alertMsg = (templates.short || '{creator} uploaded a new Short! 🩳 Link: {link}')
                            .replace(/{creator}/g, author)
                            .replace(/{link}/g, `https://youtube.com/shorts/${videoId}`)
                            .replace(/{title}/g, title);
                        await channel.send(alertMsg).catch(() => {});
                    }
                } else {
                    // Regular video
                    if (!lastIds.video) {
                        lastIds.video = videoId;
                        await feed.update({ lastVideoId: JSON.stringify(lastIds) });
                    } else if (lastIds.video !== videoId) {
                        lastIds.video = videoId;
                        await feed.update({ lastVideoId: JSON.stringify(lastIds) });

                        const alertMsg = (templates.video || '{creator} uploaded a new video! 🎬 Link: {link}')
                            .replace(/{creator}/g, author)
                            .replace(/{link}/g, link)
                            .replace(/{title}/g, title);
                        await channel.send(alertMsg).catch(() => {});
                    }
                }
            }
        } catch (e) {
            console.error(`[Social Scraper] Error checking RSS for @${handle}:`, e.message);
        }

        // 2. Also scrape shorts tab directly as a secondary check
        // This catches shorts that may not yet appear in RSS
        try {
            const latestShort = await scrapeLatestShort(handle, channelId);
            if (latestShort && latestShort.id !== lastIds.short) {
                if (!lastIds.short) {
                    lastIds.short = latestShort.id;
                    await feed.update({ lastVideoId: JSON.stringify(lastIds) });
                } else {
                    lastIds.short = latestShort.id;
                    await feed.update({ lastVideoId: JSON.stringify(lastIds) });

                    const author = handle;
                    const alertMsg = (templates.short || '{creator} uploaded a new Short! 🩳 Link: {link}')
                        .replace(/{creator}/g, author)
                        .replace(/{link}/g, latestShort.link)
                        .replace(/{title}/g, latestShort.title);
                    await channel.send(alertMsg).catch(() => {});
                }
            }
        } catch (e) {
            console.error(`[Social Scraper] Error scraping Shorts for @${handle}:`, e.message);
        }

        // 3. Check Live Stream using @handle
        try {
            const activeStream = await scrapeLiveStatus(handle, channelId);
            if (activeStream) {
                if (!lastIds.live) {
                    lastIds.live = activeStream.id;
                    await feed.update({ lastVideoId: JSON.stringify(lastIds) });
                } else if (lastIds.live !== activeStream.id) {
                    lastIds.live = activeStream.id;
                    await feed.update({ lastVideoId: JSON.stringify(lastIds) });

                    const author = handle;
                    const alertMsg = (templates.live || '{creator} is LIVE! 🔴 Link: {link}')
                        .replace(/{creator}/g, author)
                        .replace(/{link}/g, activeStream.link)
                        .replace(/{title}/g, activeStream.title);
                    await channel.send(alertMsg).catch(() => {});
                }
            }
        } catch (e) {
            console.error(`[Social Scraper] Error checking Live stream for @${handle}:`, e.message);
        }

    } catch (e) {
        console.error(`Error checking YouTube feed for ${feed.publicHandle}:`, e.message);
    }
}

async function checkTwitch(feed, client) {
    try {
        const res = await axios.get(`https://decapi.me/twitch/uptime/${feed.publicHandle}`);
        const data = res.data;
        
        const isOffline = data.includes('offline') || data.includes('not exist');
        
        if (isOffline) {
            if (feed.isLive) {
                await feed.update({ isLive: false });
            }
            return;
        }

        // Streamer is live!
        if (feed.isLive) return; // Already alerted for this stream session
        
        await feed.update({ isLive: true });

        const guild = client.guilds.cache.get(feed.guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(feed.targetChannelId);
        if (!channel) return;

        const link = `https://twitch.tv/${feed.publicHandle}`;
        const message = feed.alertTemplate
            .replace(/{creator}/g, feed.publicHandle)
            .replace(/{link}/g, link)
            .replace(/{title}/g, 'Live Stream');
            
        await channel.send(message);
    } catch (e) {
        console.error(`Error checking Twitch feed for ${feed.publicHandle}:`, e.message);
    }
}

async function pollFeeds(client) {
    try {
        const feeds = await ContentFeed.findAll();
        for (const feed of feeds) {
            if (feed.platform === 'YOUTUBE') {
                await checkYoutube(feed, client);
            } else if (feed.platform === 'TWITCH') {
                await checkTwitch(feed, client);
            }
        }
    } catch (e) {
        console.error('Error polling feeds:', e);
    }
}

function init(client) {
    // Initial delay to let bot startup fully
    setTimeout(() => {
        pollFeeds(client);
        setInterval(() => pollFeeds(client), 60 * 1000); // 1 minute
    }, 10000);
}

module.exports = { init, pollFeeds, checkYoutube, checkTwitch, getYoutubeChannelId };
