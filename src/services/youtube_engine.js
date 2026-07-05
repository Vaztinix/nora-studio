const express = require('express');
const Redis = require('ioredis');
const { google } = require('googleapis');
const xml2js = require('xml2js');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// Setup Redis instance (expects REDIS_URL in env, defaults to localhost)
// Safe options to prevent startup crash on offline local Redis
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    connectTimeout: 5000
});

let redisAvailable = false;
redis.on('connect', () => {
    redisAvailable = true;
    console.log('[YouTube Engine] Connected to Redis successfully.');
});
redis.on('error', (err) => {
    redisAvailable = false;
    // Log once to prevent spam
    if (!global.redisWarningLogged) {
        console.warn('[YouTube Engine] Redis connection failed, falling back to in-memory deduplication:', err.message);
        global.redisWarningLogged = true;
    }
});

const memoryDeduplicationSet = new Set();
// Periodically clean up memory Set to prevent leak (daily)
setInterval(() => {
    memoryDeduplicationSet.clear();
}, 24 * 60 * 60 * 1000);


// Setup YouTube Data API v3
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

// XML Parser instance for parsing incoming WebSub payloads
const xmlParser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

/**
 * Resolves a YouTube channel URL or Handle (e.g. @creatorname) to its canonical Channel ID (UC...)
 * @param {string} input - The channel URL or handle
 * @returns {Promise<string|null>} - Canonical Channel ID or null if not found
 */
async function resolveChannelId(input) {
    if (!input) return null;
    const cleanInput = input.trim();

    // If it's already a canonical Channel ID
    if (/^UC[a-zA-Z0-9_-]{22}$/.test(cleanInput)) {
        return cleanInput;
    }

    try {
        let handle = '';
        if (cleanInput.includes('youtube.com/')) {
            // URL parsing
            if (cleanInput.includes('/@')) {
                handle = '@' + cleanInput.split('/@')[1].split('/')[0].split('?')[0];
            } else if (cleanInput.includes('/channel/')) {
                const id = cleanInput.split('/channel/')[1].split('/')[0].split('?')[0];
                if (/^UC[a-zA-Z0-9_-]{22}$/.test(id)) return id;
            } else {
                const parts = cleanInput.replace(/\/$/, '').split('/');
                const lastPart = parts[parts.length - 1].split('?')[0];
                if (lastPart.startsWith('@')) {
                    handle = lastPart;
                } else {
                    handle = '@' + lastPart;
                }
            }
        } else {
            // Raw handle or user name
            handle = cleanInput.startsWith('@') ? cleanInput : `@${cleanInput}`;
        }

        if (!handle) return null;

        // Query the YouTube Data API
        const response = await youtube.channels.list({
            part: 'id',
            forHandle: handle
        });

        if (response.data.items && response.data.items.length > 0) {
            return response.data.items[0].id;
        }

        // Fallback: search for channel if handle lookup doesn't return anything
        const searchResponse = await youtube.search.list({
            part: 'snippet',
            q: handle,
            type: 'channel',
            maxResults: 1
        });

        if (searchResponse.data.items && searchResponse.data.items.length > 0) {
            return searchResponse.data.items[0].snippet.channelId;
        }

        return null;
    } catch (error) {
        console.error(`[YouTube Resolver] Error resolving handle/URL "${input}":`, error.message);
        return null;
    }
}

/**
 * Setup WebSub webhook router for Express
 * @param {import('discord.js').Client} client - The active Discord.js Client instance
 * @param {Function} getGuildSubscriptions - Function to fetch subscriptions: (channelId) => Promise<Array<{ guildId, targetChannelId, customMessage }>>
 * @returns {import('express').Router} - Express router
 */
function createWebSubRouter(client, getGuildSubscriptions) {
    const router = express.Router();

    // 1. GET Request: Google WebSub Subscription Verification (hub.challenge)
    router.get('/youtube/webhook', (req, res) => {
        const hubMode = req.query['hub.mode'];
        const hubTopic = req.query['hub.topic'];
        const hubChallenge = req.query['hub.challenge'];
        const hubLease = req.query['hub.lease_seconds'];

        if (hubMode === 'subscribe' || hubMode === 'unsubscribe') {
            console.log(`[WebSub Verification] Mode: ${hubMode}, Topic: ${hubTopic}, Lease: ${hubLease}s`);
            return res.status(200).send(hubChallenge);
        }

        return res.status(400).send('Bad Request');
    });

    // 2. POST Request: YouTube Notification Delivery (XML payload)
    router.post('/youtube/webhook', express.text({ type: ['application/atom+xml', 'application/xml', 'text/xml'] }), async (req, res) => {
        // Acknowledge receipt immediately to Google Hub (YAGPDB pattern)
        res.status(200).send('OK');

        const xmlBody = req.body;
        if (!xmlBody) return;

        try {
            const parsed = await xmlParser.parseStringPromise(xmlBody);
            
            // Extract Entry
            const entry = parsed.feed?.entry;
            if (!entry) return;

            const videoId = entry['yt:videoId'];
            const channelId = entry['yt:channelId'];
            const title = entry.title;
            const author = entry.author?.name || 'A creator';
            const published = entry.published;
            const updated = entry.updated;

            if (!videoId || !channelId) return;

            // Deduplication Check via Redis or Memory Fallback (24-hour expiration)
            const redisKey = `yt:video:${videoId}`;
            let isDuplicate = false;
            if (redisAvailable) {
                try {
                    const res = await redis.get(redisKey).catch(() => null);
                    isDuplicate = !!res;
                } catch (e) {
                    isDuplicate = memoryDeduplicationSet.has(videoId);
                }
            } else {
                isDuplicate = memoryDeduplicationSet.has(videoId);
            }

            if (isDuplicate) {
                console.log(`[YouTube Engine] Duplicate alert dropped for videoId: ${videoId} (${title})`);
                return;
            }

            // Store to prevent duplicates (expires in 24 hours / 86400 seconds)
            if (redisAvailable) {
                try {
                    await redis.set(redisKey, 'alerted', 'EX', 86400).catch(() => {});
                } catch (e) {
                    memoryDeduplicationSet.add(videoId);
                }
            } else {
                memoryDeduplicationSet.add(videoId);
            }

            console.log(`[YouTube Engine] Dispatching alert for videoId: ${videoId} | Channel: ${author} (${channelId})`);

            // Fetch guild subscriptions mapped to this YouTube channel ID
            const subscriptions = await getGuildSubscriptions(channelId);
            if (!subscriptions || subscriptions.length === 0) return;

            // Dispatch alert to each subscribed Discord server
            for (const sub of subscriptions) {
                try {
                    // Check if this video is already known/alerted for this feed
                    let lastIds = { video: null, short: null, live: null };
                    if (sub.lastVideoId) {
                        try {
                            lastIds = JSON.parse(sub.lastVideoId);
                        } catch (e) {
                            lastIds = { video: sub.lastVideoId, short: null, live: null };
                        }
                    }

                    if (videoId === lastIds.video || videoId === lastIds.short || videoId === lastIds.live) {
                        console.log(`[YouTube Engine] Skipping already alerted/known video ID ${videoId} for feed ${sub.id}`);
                        continue;
                    }

                    // Save video ID to feed's lastVideoId to prevent future spam
                    lastIds.video = videoId;
                    await sub.update({ lastVideoId: JSON.stringify(lastIds) });

                    const guild = client.guilds.cache.get(sub.guildId);
                    if (!guild) continue;

                    const channel = guild.channels.cache.get(sub.targetChannelId);
                    if (!channel) continue;

                    // Permission Checks
                    const botMember = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
                    if (!botMember) continue;

                    const permissions = channel.permissionsFor(botMember);
                    if (!permissions || 
                        !permissions.has(PermissionFlagsBits.ViewChannel) || 
                        !permissions.has(PermissionFlagsBits.SendMessages) || 
                        !permissions.has(PermissionFlagsBits.EmbedLinks)) {
                        console.error(`[YouTube Dispatcher] Missing permissions (ViewChannel/SendMessages/EmbedLinks) in channel ${sub.targetChannelId} for Guild ${sub.guildId}`);
                        continue;
                    }

                    // Format message payload
                    const videoLink = `https://youtube.com/watch?v=${videoId}`;
                    
                    // Parse alert templates
                    let templates = { video: '', short: '', live: '' };
                    if (sub.alertTemplate) {
                        try {
                            const parsed = JSON.parse(sub.alertTemplate);
                            templates.video = parsed.video || '';
                            templates.short = parsed.short || '';
                            templates.live = parsed.live || '';
                        } catch (e) {
                            templates.video = sub.alertTemplate;
                        }
                    }
                    
                    let content = templates.video || `**${author}** just uploaded a new video!\n${videoLink}`;
                    
                    // Support replacement parameters
                    content = content
                        .replace(/{creator}/g, author)
                        .replace(/{title}/g, title)
                        .replace(/{link}/g, videoLink);

                    // Send announcement
                    await channel.send({ content });
                } catch (dispatchError) {
                    console.error(`[YouTube Dispatcher] Failed sending alert to guild ${sub.guildId}, channel ${sub.targetChannelId}:`, dispatchError.message);
                }
            }
        } catch (error) {
            console.error('[YouTube Engine] Webhook Ingestion parsing error:', error);
        }
    });

    return router;
}

/**
 * Automates WebSub Subscription / Renewal to the Google hub
 * @param {string} callbackUrl - Public webhook callback URL pointing to /youtube/webhook
 * @param {Array<string>} channelIds - List of active YouTube canonical Channel IDs
 */
async function manageWebSubSubscriptions(callbackUrl, channelIds) {
    const hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';

    for (const channelId of channelIds) {
        try {
            const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
            
            // Format parameters for application/x-www-form-urlencoded
            const params = new URLSearchParams();
            params.append('hub.callback', callbackUrl);
            params.append('hub.topic', topicUrl);
            params.append('hub.mode', 'subscribe');
            params.append('hub.verify', 'async');
            params.append('hub.lease_seconds', '432000'); // 5 days lease (Google auto renew recommendation)

            const response = await fetch(hubUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params
            });

            if (response.ok) {
                console.log(`[WebSub Manager] Subscription request sent for Channel: ${channelId}`);
            } else {
                const text = await response.text();
                console.error(`[WebSub Manager] Failed subscribing to Channel: ${channelId}. Status: ${response.status}. Response: ${text}`);
            }
        } catch (error) {
            console.error(`[WebSub Manager] Connection error subscribing to Channel ${channelId}:`, error.message);
        }
    }
}

function startPollingFallback(client, ContentFeed) {
    console.log('[YouTube Engine] Initialized fallback background polling scheduler.');
    // Run every 15 minutes
    setInterval(async () => {
        try {
            const feeds = await ContentFeed.findAll({ where: { platform: 'YOUTUBE' } });
            if (!feeds || feeds.length === 0) return;

            const grouped = {};
            feeds.forEach(f => {
                if (!grouped[f.channelId]) {
                    grouped[f.channelId] = [];
                }
                grouped[f.channelId].push(f);
            });

            for (const channelId in grouped) {
                if (!process.env.YOUTUBE_API_KEY) continue;
                const response = await youtube.search.list({
                    part: 'snippet',
                    channelId: channelId,
                    order: 'date',
                    type: 'video',
                    maxResults: 3
                }).catch(() => null);

                if (!response || !response.data || !response.data.items) continue;

                for (const item of response.data.items) {
                    const videoId = item.id?.videoId;
                    if (!videoId) continue;
                    const title = item.snippet?.title || 'New Video';
                    const author = item.snippet?.channelTitle || 'A Creator';

                    const redisKey = `yt:video:${videoId}`;
                    let isDuplicate = false;
                    if (redisAvailable) {
                        isDuplicate = !!(await redis.get(redisKey).catch(() => null));
                    } else {
                        isDuplicate = memoryDeduplicationSet.has(videoId);
                    }

                    if (isDuplicate) continue;

                    if (redisAvailable) {
                        await redis.set(redisKey, 'alerted', 'EX', 86400).catch(() => {});
                    } else {
                        memoryDeduplicationSet.add(videoId);
                    }

                    for (const sub of grouped[channelId]) {
                        try {
                            let lastIds = { video: null, short: null, live: null };
                            if (sub.lastVideoId) {
                                try {
                                    lastIds = JSON.parse(sub.lastVideoId);
                                } catch (e) {
                                    lastIds = { video: sub.lastVideoId, short: null, live: null };
                                }
                            }

                            if (videoId === lastIds.video || videoId === lastIds.short || videoId === lastIds.live) {
                                continue;
                            }

                            lastIds.video = videoId;
                            await sub.update({ lastVideoId: JSON.stringify(lastIds) });

                            const guild = client.guilds.cache.get(sub.guildId);
                            if (!guild) continue;

                            const channel = guild.channels.cache.get(sub.targetChannelId);
                            if (!channel) continue;

                            const videoLink = `https://youtube.com/watch?v=${videoId}`;
                            const content = `**${author}** just uploaded a new video!\n${videoLink}`;
                            
                            await channel.send({ content });
                        } catch (err) {
                            console.error(`[YouTube Poller Dispatcher Error]:`, err.message);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[YouTube Fallback Poller Error]:', e.message);
        }
    }, 900000);
}

module.exports = { resolveChannelId, createWebSubRouter, manageWebSubSubscriptions, startPollingFallback };
