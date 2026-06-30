const axios = require('axios');
const { prisma } = require('@nora/database');

const activePromises = new Map(); // username -> Promise

// Exponential backoff logic
async function fetchWithBackoff(fn, retries = 3, delay = 1000) {
    try {
        return await fn();
    } catch (err) {
        if (retries <= 0) throw err;
        console.warn(`Roblox API failed. Retrying in ${delay}ms...`, err.message);
        await new Promise(r => setTimeout(r, delay));
        return fetchWithBackoff(fn, retries - 1, delay * 2);
    }
}

async function lookupRobloxProfile(username) {
    const cached = await prisma.robloxCache.findUnique({
        where: { username: username.toLowerCase() }
    });

    if (cached && cached.expiresAt > new Date()) {
        return cached;
    }

    // Request Deduplication
    if (activePromises.has(username.toLowerCase())) {
        return activePromises.get(username.toLowerCase());
    }

    const fetchPromise = (async () => {
        try {
            // 1. Username to UserId
            const userResponse = await fetchWithBackoff(() => axios.post('https://users.roblox.com/v1/usernames/users', {
                usernames: [username],
                excludeBannedUsers: true
            }));

            const userData = userResponse.data.data[0];
            if (!userData) throw new Error(`Roblox username "${username}" not found.`);

            const userId = userData.id.toString();
            const displayName = userData.displayName;

            // 2. Fetch User Avatar
            let avatarUrl = "https://images.rbxcdn.com/26c599b8d273ed868b449b828eb71d2b.png";
            try {
                const avatarResponse = await fetchWithBackoff(() => axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`));
                avatarUrl = avatarResponse.data.data[0]?.imageUrl || avatarUrl;
            } catch (e) {
                console.error("Failed to load Roblox avatar headshot, using placeholder:", e.message);
            }

            // 3. Fetch Group Membership Roles
            let rankName = "Guest";
            try {
                const groupResponse = await fetchWithBackoff(() => axios.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`));
                rankName = groupResponse.data.data[0]?.role.name || rankName;
            } catch (e) {
                console.error("Failed to load Roblox group rank, defaulting to Guest:", e.message);
            }

            const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins cache TTL

            const saved = await prisma.robloxCache.upsert({
                where: { username: username.toLowerCase() },
                update: {
                    robloxId: userId,
                    displayName,
                    avatarUrl,
                    rankName,
                    expiresAt
                },
                create: {
                    username: username.toLowerCase(),
                    robloxId: userId,
                    displayName,
                    avatarUrl,
                    rankName,
                    expiresAt
                }
            });

            return saved;
        } catch (err) {
            console.error(`Roblox API fetch failure for ${username}:`, err.message);
            
            // Fallback stale data
            if (cached) {
                return cached;
            }

            // Fallback structure
            return {
                robloxId: "0",
                displayName: username,
                avatarUrl: "https://images.rbxcdn.com/26c599b8d273ed868b449b828eb71d2b.png",
                rankName: "Unverified Guest",
                expiresAt: new Date(Date.now() + 60 * 1000)
            };
        } finally {
            activePromises.delete(username.toLowerCase());
        }
    })();

    activePromises.set(username.toLowerCase(), fetchPromise);
    return fetchPromise;
}

module.exports = { lookupRobloxProfile };
