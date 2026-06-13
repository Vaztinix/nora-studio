const axios = require('axios');
const xml2js = require('xml2js');
const ContentFeed = require('../database/models/ContentFeed');

// In-memory cache to prevent duplicate alerts
const alertsCache = new Set();

async function getYoutubeChannelId(handle) {
    try {
        const res = await axios.get(`https://www.youtube.com/@${handle}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const html = res.data;
        const match = html.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
        return match ? match[1] : null;
    } catch (e) {
        console.error(`Error resolving YouTube handle @${handle}:`, e.message);
        return null;
    }
}

async function checkYoutube(feed, client) {
    try {
        let channelId = feed.channelId || feed.publicHandle;
        if (!channelId || !channelId.startsWith('UC')) {
            channelId = await getYoutubeChannelId(feed.publicHandle);
            if (channelId) {
                await feed.update({ channelId });
            }
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
        
        // Persistent check to prevent alerts for old videos or duplicate alerts on restart
        if (!feed.lastVideoId) {
            // First scan: save state without alerting
            await feed.update({ lastVideoId: videoId });
            return;
        }

        if (feed.lastVideoId === videoId) return;
        
        await feed.update({ lastVideoId: videoId });

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
        setInterval(() => pollFeeds(client), 60 * 1000); // 1 minute
    }, 10000);
}

module.exports = { init, pollFeeds, checkYoutube, checkTwitch, getYoutubeChannelId };
