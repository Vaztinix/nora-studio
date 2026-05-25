const sequelize = require('./src/database/db');
const UserLevel = require('./src/database/models/UserLevel');

const OLD_CONFIG = {
    getTotalXP: (lvl) => {
        let total = 0;
        for (let i = 0; i < lvl; i++) {
            total += 15 * Math.pow(i, 2) + 100 * i + 100;
        }
        return total;
    }
};

const NEW_CONFIG = {
    getTotalXP: (lvl) => {
        let total = 0;
        for (let i = 0; i < lvl; i++) {
            total += 10 * Math.pow(i, 2) + 50 * i + 100;
        }
        return total;
    }
};

(async () => {
    try {
        console.log("Starting XP Adjustment...");
        const users = await UserLevel.findAll();
        let modified = 0;

        for (const user of users) {
            const lvl = user.level || 0;
            const currentXp = user.totalXp || user.xp || 0;

            const oldStart = OLD_CONFIG.getTotalXP(lvl);
            const oldNext = OLD_CONFIG.getTotalXP(lvl + 1);
            
            // Calculate progress (0 to 1) within the current level
            let progress = 0;
            if (oldNext > oldStart) {
                progress = (currentXp - oldStart) / (oldNext - oldStart);
            }
            if (progress < 0) progress = 0;
            if (progress > 1) progress = 1;

            const newStart = NEW_CONFIG.getTotalXP(lvl);
            const newNext = NEW_CONFIG.getTotalXP(lvl + 1);

            const newXp = Math.floor(newStart + progress * (newNext - newStart));

            // Only update if it significantly changed
            if (user.totalXp !== newXp || user.xp !== newXp) {
                user.totalXp = newXp;
                user.xp = newXp;
                await user.save();
                modified++;
            }
        }
        
        console.log(`XP Adjustment Complete. Modified ${modified} users.`);
        process.exit(0);
    } catch (error) {
        console.error("Failed to adjust XP:", error);
        process.exit(1);
    }
})();
