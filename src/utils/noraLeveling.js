const UserLevel = require('../database/models/UserLevel');

/**
 * Nora Leveling Core — centralizes all XP math and database sync.
 */

const NORA_CONFIG = {
    COOLDOWN: 15000, // 15s cooldown for text
    XP_RANGE: [15, 25], // XP reward range
    VOICE_TICK: 300000, // 5 minute tick
    VOICE_XP: 150, 
    // Nora Standard Curve: 15*L^2 + 100*L + 100
    getXPNeeded: (lvl) => 15 * Math.pow(lvl, 2) + 100 * lvl + 100,
    getTotalXP: (lvl) => {
        let total = 0;
        for (let i = 0; i < lvl; i++) {
            total += 15 * Math.pow(i, 2) + 100 * i + 100;
        }
        return total;
    }
};

module.exports = {
    getXPForLevel: (level) => NORA_CONFIG.getXPNeeded(level),
    getTotalXPForLevel: (level) => NORA_CONFIG.getTotalXP(level),
    
    checkCooldown: (lastMs) => {
        const now = Date.now();
        return (now - lastMs >= NORA_CONFIG.COOLDOWN);
    },

    getMediumXP: () => NORA_CONFIG.VOICE_XP,
    getVoiceInterval: () => NORA_CONFIG.VOICE_TICK,

    getOrInitializeUser: async (userId, guildId) => {
        try {
            // findOrCreate is atomic — eliminates the race condition where two users
            // message at the same time, both find no record, and both try to INSERT,
            // causing a unique constraint crash for one of them.
            const [user, created] = await UserLevel.findOrCreate({
                where: { userId, guildId },
                defaults: { xp: 0, level: 0, totalXp: 0, dailyXp: 0, weeklyXp: 0 }
            });
            if (created) console.log(`[XP System] New record created for: ${userId}`);
            return user;
        } catch (e) {
            console.error('[XP System] Init failed for', userId, '—', e.message);
            // Last-resort: try a plain lookup in case create partially succeeded
            try {
                return await UserLevel.findOne({ where: { userId, guildId } }) || null;
            } catch (_) {
                return null;
            }
        }
    },

    addExperience: async (userRecord, manualXp = null, multiplier = 1.0) => {
        if (!userRecord) return { xpGained: 0, didLevelUp: false, newLevel: 0 };
        
        let xpGained = manualXp !== null ? manualXp : Math.floor(Math.random() * (NORA_CONFIG.XP_RANGE[1] - NORA_CONFIG.XP_RANGE[0] + 1)) + NORA_CONFIG.XP_RANGE[0];
        
        // 3000+ Users Global Event: 50% XP Boost for 14 Days (Until May 1, 2026)
        const EVENT_BOOST_EXPIRY = new Date('2026-05-01T13:53:43-04:00').getTime();
        const globalBoost = Date.now() < EVENT_BOOST_EXPIRY ? 1.5 : 1.0;
        
        xpGained = Math.floor(xpGained * multiplier * globalBoost);
        
        // Cumulative XP Math — Both 'xp' and 'totalXp' are now synchronized as Lifetime Totals.
        let totalXp = (userRecord.totalXp || userRecord.xp || 0) + xpGained;
        let currentLevel = userRecord.level || 0;
        
        let didLevelUp = false;
        let nextGoal = NORA_CONFIG.getTotalXP(currentLevel + 1);

        // Recursive leveling (jump protection)
        while (totalXp >= nextGoal) {
            currentLevel++;
            didLevelUp = true;
            nextGoal = NORA_CONFIG.getTotalXP(currentLevel + 1);
        }

        // Auto-reset rolling daily and weekly XP if last active was too long ago
        const lastActiveTime = userRecord.lastMessageTimestamp ? new Date(userRecord.lastMessageTimestamp).getTime() : 0;
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        const sevenDaysMs = 7 * oneDayMs;

        if (now - lastActiveTime > sevenDaysMs) {
            userRecord.weeklyXp = 0;
        }
        if (now - lastActiveTime > oneDayMs) {
            userRecord.dailyXp = 0;
        }

        userRecord.xp = totalXp;
        userRecord.totalXp = totalXp;
        userRecord.weeklyXp = (userRecord.weeklyXp || 0) + xpGained;
        userRecord.dailyXp = (userRecord.dailyXp || 0) + xpGained;
        userRecord.level = currentLevel;
        userRecord.lastMessageTimestamp = new Date();

        return { xpGained, didLevelUp, newLevel: currentLevel };
    }
};
