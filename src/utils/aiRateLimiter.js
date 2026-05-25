const userRequests = new Map();

// We limit to 5 per minute per user to guarantee the global 15 RPM is not completely saturated by one person.
const MAX_REQUESTS = 5; 
const TIME_WINDOW_MS = 60 * 1000;

// 🧹 Memory Sweep: Clean old data every 15 mins to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of userRequests.entries()) {
        const fresh = data.filter(t => (now - t) < TIME_WINDOW_MS);
        if (fresh.length === 0) userRequests.delete(key);
        else userRequests.set(key, fresh);
    }
}, 15 * 60 * 1000);

function checkRateLimit(userId, isPremium = false) {
    const now = Date.now();
    const windowMs = isPremium ? (TIME_WINDOW_MS / 2) : TIME_WINDOW_MS;
    
    if (!userRequests.has(userId)) {
        userRequests.set(userId, []);
    }
    
    const timestamps = userRequests.get(userId);
    const recentRequests = timestamps.filter(ts => (now - ts) < windowMs);
    
    if (recentRequests.length >= MAX_REQUESTS) {
        userRequests.set(userId, recentRequests); 
        return false; // Hit Limit
    }
    
    recentRequests.push(now);
    userRequests.set(userId, recentRequests);
    return true; // Allowed
}

module.exports = { checkRateLimit };
