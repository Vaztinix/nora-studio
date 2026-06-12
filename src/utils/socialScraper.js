const axios = require('axios');
const xml2js = require('xml2js');
const ContentFeed = require('../database/models/ContentFeed');

// In-memory cache to prevent duplicate alerts
const alertsCache = new Set();

async function getYoutubeChannelId(handle) {
    try {
        const res = await axios.get(`https://www.youtube.com/@${handle}`);
        const html = res.data;
        const match = html.match(/"channelId":"(UC[^"]+)"/);
        return match ? match[1] : null;
    } catch (e) {
        return null;
    }
}

async function checkYoutube(feed, client) {
    try {
        let channelId = feed.publicHandle;
        if (!channelId.startsWith('UC')) {
            channelId = await getYoutubeChannelId(feed.publicHandle);
        }
        if (!channelId) return;

        const res = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(res.data);
        
        if (!result.feed || !result.feed.entry || result.feed.entry.length === 0) return;
        
        const latest = result.feed.entry[0];
        const videoId = latest['yt:videoId'][0];
        const title = latest.title[0];
        const author = latest.author[0].name[0];
        const link = latest.link[0].$.href;
        
        const cacheKey = `yt-${feed.id}-${videoId}`;
        if (alertsCache.has(cacheKey)) return;
        alertsCache.add(cacheKey);

        const guild = client.guilds.cache.get(feed.guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(feed.targetChannelId);
        if (!channel) return;

        const message = feed.alertTemplate
            .replace('{creator}', author)
            .replace('{link}', link)
            .replace('{title}', title);
            
        await channel.send(message);
    } catch (e) {
        console.error(`Error checking YouTube feed for ${feed.publicHandle}:`, e.message);
    }
}

async function checkTwitch(feed, client) {
    try {
        // Zero-auth Twitch scraping using decapi public unofficial endpoint
        const res = await axios.get(`https://decapi.me/twitch/uptime/${feed.publicHandle}`);
        const data = res.data;
        
        // If it returns a string like "X is offline", they are offline.
        // If it returns a time duration, they are live.
        const cacheKey = `tw-${feed.id}-live`;
        
        if (data.includes('offline') || data.includes('not exist')) {
            alertsCache.delete(cacheKey);
            return;
        }

        // They are live!
        if (alertsCache.has(cacheKey)) return;
        alertsCache.add(cacheKey);

        const guild = client.guilds.cache.get(feed.guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(feed.targetChannelId);
        if (!channel) return;

        const link = `https://twitch.tv/${feed.publicHandle}`;
        const message = feed.alertTemplate
            .replace('{creator}', feed.publicHandle)
            .replace('{link}', link)
            .replace('{title}', 'Live Stream');
            
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
        setInterval(() => pollFeeds(client), 5 * 60 * 1000); // 5 minutes
    }, 10000);
}

module.exports = { init, pollFeeds };
