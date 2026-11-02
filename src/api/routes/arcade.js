const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const rateLimit = require('express-rate-limit');

const leaderboardPath = path.join(__dirname, '..', '..', '..', 'arcadeLeaderboard.json');

// In-memory cache for high-speed retrieval
let leaderboardCache = [];
let isLoaded = false;

async function loadLeaderboard() {
    if (isLoaded) return leaderboardCache;
    try {
        const raw = await fs.readFile(leaderboardPath, 'utf8');
        leaderboardCache = JSON.parse(raw);
    } catch (_) {
        leaderboardCache = [
            { id: '1214048435632603137', username: 'Vaz', avatar: null, score: 28540, wave: 14, maxCombo: 42, crystals: 185, date: new Date().toISOString() },
            { id: '1366229304257544213', username: 'Demi', avatar: null, score: 21900, wave: 11, maxCombo: 35, crystals: 140, date: new Date().toISOString() },
            { id: 'guest_1', username: 'CyberPilot_X', avatar: null, score: 16400, wave: 8, maxCombo: 24, crystals: 98, date: new Date().toISOString() }
        ];
        await saveLeaderboard();
    }
    isLoaded = true;
    return leaderboardCache;
}

async function saveLeaderboard() {
    try {
        await fs.writeFile(leaderboardPath, JSON.stringify(leaderboardCache, null, 2), 'utf8');
    } catch (e) {
        console.error('[Arcade] Failed to save leaderboard:', e.message);
    }
}

// Rate limiter for score submissions to prevent spamming
const scoreSubmitLimiter = rateLimit({
    windowMs: 15 * 1000,
    max: 10,
    message: { error: 'Too many score submissions. Please wait a few seconds.' }
});

/**
 * GET /api/arcade/leaderboard
 * Returns top 25 high scores
 */
router.get('/leaderboard', async (req, res) => {
    try {
        const list = await loadLeaderboard();
        const sorted = [...list].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 25);
        res.json({
            success: true,
            totalEntries: list.length,
            leaderboard: sorted
        });
    } catch (err) {
        console.error('[Arcade Leaderboard Error]:', err);
        res.status(500).json({ error: 'Failed to retrieve arcade leaderboard.' });
    }
});

/**
 * POST /api/arcade/score
 * Submit game score & award Nora XP
 */
router.post('/score', scoreSubmitLimiter, async (req, res) => {
    try {
        const { score, wave, maxCombo, crystals, guestName } = req.body;
        const finalScore = Math.max(0, parseInt(score, 10) || 0);
        const finalWave = Math.max(1, parseInt(wave, 10) || 1);
        const finalCombo = Math.max(1, parseInt(maxCombo, 10) || 1);
        const finalCrystals = Math.max(0, parseInt(crystals, 10) || 0);

        if (finalScore <= 0) {
            return res.status(400).json({ error: 'Score must be greater than zero.' });
        }

        // Authenticate user if token provided
        let authUser = null;
        const authHeader = req.headers.authorization;
        const token = (authHeader && authHeader.startsWith('Bearer ')) 
            ? authHeader.split(' ')[1] 
            : (req.body.token || null);

        if (token) {
            try {
                const { getDiscordUser } = require('../../utils/discordAuth');
                authUser = await getDiscordUser(token).catch(() => null);
            } catch (_) {}
        }

        const list = await loadLeaderboard();
        let xpAwarded = 0;

        const userId = authUser ? authUser.id : `guest_${Date.now()}`;
        const username = authUser ? authUser.username : (String(guestName || 'CyberPilot').trim().slice(0, 24) || 'Guest Pilot');
        const avatar = authUser && authUser.avatar ? `https://cdn.discordapp.com/avatars/${authUser.id}/${authUser.avatar}.png` : null;

        // Calculate XP reward: base on score, wave, and crystals collected (capped at 500 XP per game)
        if (authUser) {
            xpAwarded = Math.min(500, Math.max(15, Math.floor(finalScore / 60) + (finalWave * 12) + (finalCrystals * 2)));
            try {
                const NoraLeveling = require('../../utils/noraLeveling');
                const UserLevel = require('../../database/models/UserLevel');
                
                // Find any existing guild leveling record to award progression XP
                const userLevels = await UserLevel.findAll({ where: { userId: authUser.id }, limit: 5 });
                if (userLevels && userLevels.length > 0) {
                    for (const ul of userLevels) {
                        await NoraLeveling.addExperience(ul, xpAwarded);
                        await ul.save();
                    }
                }
            } catch (xpErr) {
                console.warn('[Arcade XP Award Error]:', xpErr.message);
            }
        }

        // Check if user already has an entry on leaderboard
        const existingIdx = list.findIndex(e => e.id === userId && authUser);
        let isNewHigh = false;

        if (existingIdx !== -1) {
            if (finalScore > list[existingIdx].score) {
                list[existingIdx] = {
                    id: userId,
                    username,
                    avatar,
                    score: finalScore,
                    wave: Math.max(list[existingIdx].wave || 1, finalWave),
                    maxCombo: Math.max(list[existingIdx].maxCombo || 1, finalCombo),
                    crystals: (list[existingIdx].crystals || 0) + finalCrystals,
                    date: new Date().toISOString()
                };
                isNewHigh = true;
            }
        } else {
            list.push({
                id: userId,
                username,
                avatar,
                score: finalScore,
                wave: finalWave,
                maxCombo: finalCombo,
                crystals: finalCrystals,
                date: new Date().toISOString()
            });
            isNewHigh = true;
        }

        // Sort & prune to top 100
        list.sort((a, b) => (b.score || 0) - (a.score || 0));
        if (list.length > 100) list.splice(100);

        await saveLeaderboard();

        const userRank = list.findIndex(e => e.id === userId) + 1;

        res.json({
            success: true,
            score: finalScore,
            rank: userRank > 0 ? userRank : list.length,
            isNewHigh,
            xpAwarded,
            authenticated: Boolean(authUser),
            username
        });
    } catch (err) {
        console.error('[Arcade Score Submission Error]:', err);
        res.status(500).json({ error: 'Failed to process score submission.' });
    }
});

module.exports = router;

