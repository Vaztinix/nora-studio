const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { Op } = require('sequelize');

const CommunityModule = require('../../database/models/CommunityModule');
const Notification = require('../../database/models/Notification');
const Session = require('../../database/models/Session');
const UserPrefs = require('../../database/models/UserPrefs');
const { scanModuleSafetyWithGemini } = require('../../utils/moduleSafetyScanner');

// Helper: Authenticate Discord User
const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Discord login required' });
    }
    const token = authHeader.split(' ')[1];
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    try {
        let session = await Session.findByPk(tokenHash);
        if (session && new Date() > new Date(session.expiresAt)) {
            await session.destroy();
            session = null;
        }

        let user = null;
        if (session) {
            const [prefs] = await UserPrefs.findOrCreate({ where: { userId: session.userId } });
            if (prefs.isTerminated || (prefs.tempBlacklistExpiresAt && new Date() < new Date(prefs.tempBlacklistExpiresAt))) {
                await session.destroy();
                return res.status(403).json({ error: 'Terminated', reason: prefs.terminationReason || 'Violation of terms.' });
            }

            const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${session.discordToken || token}` }
            }).catch(() => null);
            if (!userRes) {
                await session.destroy();
                return res.status(401).json({ error: 'Unauthorized: Invalid token' });
            }
            user = userRes.data;
        } else {
            const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${token}` }
            }).catch(() => null);
            if (!userRes) {
                return res.status(401).json({ error: 'Unauthorized: Invalid token' });
            }
            user = userRes.data;
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('[ModulesAuth] Error:', err);
        return res.status(500).json({ error: 'Internal server error verifying authorization' });
    }
};

// Helper: Verify Owner Authorization
const requireOwner = async (req, res, next) => {
    await requireAuth(req, res, async () => {
        const APP_OWNER_IDS = ['1214048435632603137', '1366229304257544213'];
        let isOwner = APP_OWNER_IDS.includes(req.user.id);
        
        if (!isOwner && req.client && req.client.application) {
            try {
                const app = await req.client.application.fetch();
                if (app.owner && (app.owner.id === req.user.id || (app.owner.members && app.owner.members.has(req.user.id)))) {
                    isOwner = true;
                }
            } catch (e) {}
        }

        if (!isOwner) {
            return res.status(403).json({ error: 'Forbidden: Owner-only access required' });
        }
        next();
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// 🌐 PUBLIC / COMMUNITY MODULE HUB (SMH) ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/modules — List published modules
router.get('/', async (req, res) => {
    try {
        const { search, category, sort = 'popular', page = 1, limit = 20 } = req.query;
        const whereClause = { status: 'APPROVED' };

        if (category && category !== 'all') {
            whereClause.category = category;
        }

        if (search && search.trim()) {
            const query = `%${search.trim()}%`;
            whereClause[Op.or] = [
                { name: { [Op.like]: query } },
                { summary: { [Op.like]: query } },
                { authorTag: { [Op.like]: query } },
                { tags: { [Op.like]: query } }
            ];
        }

        let order = [['installCount', 'DESC'], ['likesCount', 'DESC']];
        if (sort === 'newest') {
            order = [['createdAt', 'DESC']];
        } else if (sort === 'rating') {
            order = [['likesCount', 'DESC'], ['installCount', 'DESC']];
        } else if (sort === 'name') {
            order = [['name', 'ASC']];
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const { count, rows } = await CommunityModule.findAndCountAll({
            where: whereClause,
            order,
            limit: parseInt(limit),
            offset
        });

        res.json({
            modules: rows,
            total: count,
            page: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit))
        });
    } catch (e) {
        console.error('[API Modules GET] Error:', e);
        res.status(500).json({ error: 'Failed to fetch community modules', details: e.message });
    }
});

// GET /api/modules/featured — Featured hub modules
router.get('/featured', async (req, res) => {
    try {
        const featured = await CommunityModule.findAll({
            where: { status: 'APPROVED', isFeatured: true },
            limit: 6,
            order: [['installCount', 'DESC']]
        });
        res.json({ modules: featured });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/modules/categories — Categories & counts
router.get('/categories', async (req, res) => {
    try {
        const categories = [
            { id: 'all', name: 'All Modules', icon: 'fa-cubes' },
            { id: 'moderation', name: 'Moderation & Security', icon: 'fa-shield-alt' },
            { id: 'ai_prompts', name: 'AI & Prompts', icon: 'fa-brain' },
            { id: 'utility', name: 'Server Utility', icon: 'fa-tools' },
            { id: 'games', name: 'Fun & Games', icon: 'fa-gamepad' },
            { id: 'leveling', name: 'Leveling & XP', icon: 'fa-chart-line' },
            { id: 'integrations', name: 'Webhooks & APIs', icon: 'fa-network-wired' }
        ];

        const counts = {};
        for (const cat of categories) {
            if (cat.id === 'all') {
                counts[cat.id] = await CommunityModule.count({ where: { status: 'APPROVED' } });
            } else {
                counts[cat.id] = await CommunityModule.count({ where: { status: 'APPROVED', category: cat.id } });
            }
        }

        res.json({ categories, counts });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/modules/my — User's authored IDTK modules
router.get('/my', requireAuth, async (req, res) => {
    try {
        const modules = await CommunityModule.findAll({
            where: { authorId: req.user.id },
            order: [['updatedAt', 'DESC']]
        });
        res.json({ modules });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/modules/:id — Single module detail
router.get('/:id', async (req, res) => {
    try {
        const moduleItem = await CommunityModule.findOne({
            where: {
                [Op.or]: [
                    { id: isNaN(req.params.id) ? -1 : parseInt(req.params.id) },
                    { moduleId: req.params.id }
                ]
            }
        });

        if (!moduleItem) {
            return res.status(404).json({ error: 'Module not found' });
        }

        res.json({ module: moduleItem });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 🛠️ IDTK STUDIO: CODE TESTING, VALIDATION & SUBMISSION
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/modules/validate — Live test & Gemini AI safety scan without saving
router.post('/validate', requireAuth, async (req, res) => {
    try {
        const { code, name, category, description } = req.body;
        if (!code || typeof code !== 'string' || !code.trim()) {
            return res.status(400).json({ error: 'JavaScript code is required.' });
        }

        const safetyReport = await scanModuleSafetyWithGemini(code, { name, category, description });
        res.json({
            valid: safetyReport.isSafe,
            safety: safetyReport
        });
    } catch (e) {
        console.error('[API Modules Validate] Error:', e);
        res.status(500).json({ error: 'Validation failed', details: e.message });
    }
});

// POST /api/modules/submit — Submit or update module for Owner review
router.post('/submit', requireAuth, async (req, res) => {
    try {
        const {
            name,
            summary,
            description,
            category = 'utility',
            tags = [],
            version = '1.0.0',
            code,
            configSchema = {},
            permissions = []
        } = req.body;

        if (!name || !name.trim()) return res.status(400).json({ error: 'Module name is required.' });
        if (!summary || !summary.trim()) return res.status(400).json({ error: 'Short summary is required.' });
        if (!code || !code.trim()) return res.status(400).json({ error: 'JavaScript program code is required.' });

        // Run Gemini AI Code Safety & Quality Audit
        console.log(`[IDTK] Running Gemini AI safety audit for submission "${name}" by user ${req.user.username} (${req.user.id})...`);
        const safetyReport = await scanModuleSafetyWithGemini(code, { name, category, description });

        const authorAvatarUrl = req.user.avatar 
            ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(req.user.discriminator || '0') % 5}.png`;

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'module';
        const generatedModuleId = `${slug}-${Date.now().toString(36)}`;

        const newModule = await CommunityModule.create({
            moduleId: generatedModuleId,
            authorId: req.user.id,
            authorTag: req.user.username + (req.user.discriminator && req.user.discriminator !== '0' ? `#${req.user.discriminator}` : ''),
            authorAvatar: authorAvatarUrl,
            name: name.trim(),
            summary: summary.trim(),
            description: (description || '').trim(),
            category: category || 'utility',
            tags: JSON.stringify(Array.isArray(tags) ? tags : []),
            version: version || '1.0.0',
            code: code.trim(),
            configSchema: JSON.stringify(configSchema || {}),
            permissions: JSON.stringify(Array.isArray(permissions) ? permissions : []),
            status: 'PENDING',
            aiSafetyScore: safetyReport.safetyScore,
            aiSafetyVerdict: safetyReport.verdict,
            aiSafetyReport: JSON.stringify(safetyReport)
        });

        // Notify the developer that their submission has been received & queued for Owner Review
        await Notification.create({
            userId: req.user.id,
            title: `Module Submitted: ${newModule.name}`,
            content: `Your module "${newModule.name}" (v${newModule.version}) was successfully scanned by Gemini AI (Safety Score: ${safetyReport.safetyScore}/100) and forwarded to vaztinix.dev/owner for administrator review.`,
            type: safetyReport.isSafe ? 'info' : 'warning',
            isSpecial: false
        }).catch(err => console.error('[Notification Create] Error:', err));

        res.json({
            success: true,
            module: newModule,
            safety: safetyReport,
            message: 'Module successfully scanned and submitted for owner review.'
        });
    } catch (e) {
        console.error('[API Modules Submit] Error:', e);
        res.status(500).json({ error: 'Failed to submit module', details: e.message });
    }
});

// POST /api/modules/:id/like — Like/upvote a module
router.post('/:id/like', requireAuth, async (req, res) => {
    try {
        const moduleItem = await CommunityModule.findOne({
            where: {
                [Op.or]: [
                    { id: isNaN(req.params.id) ? -1 : parseInt(req.params.id) },
                    { moduleId: req.params.id }
                ]
            }
        });

        if (!moduleItem) return res.status(404).json({ error: 'Module not found' });
        await moduleItem.increment('likesCount', { by: 1 });
        res.json({ success: true, likesCount: moduleItem.likesCount + 1 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/modules/:id/install — Install module to user server
router.post('/:id/install', requireAuth, async (req, res) => {
    try {
        const { guildId } = req.body;
        const moduleItem = await CommunityModule.findOne({
            where: {
                [Op.or]: [
                    { id: isNaN(req.params.id) ? -1 : parseInt(req.params.id) },
                    { moduleId: req.params.id }
                ]
            }
        });

        if (!moduleItem) return res.status(404).json({ error: 'Module not found' });
        await moduleItem.increment('installCount', { by: 1 });

        // Record user notification
        await Notification.create({
            userId: req.user.id,
            title: `Module Installed: ${moduleItem.name}`,
            content: `"${moduleItem.name}" (v${moduleItem.version}) has been connected to your server environment.`,
            type: 'success'
        }).catch(() => {});

        res.json({ success: true, message: `Module ${moduleItem.name} installed successfully!`, installCount: moduleItem.installCount + 1 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 👑 OWNER REVIEW DESK ENDPOINTS (vaztinix.dev/owner)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/modules/admin/pending — Get all pending submissions
router.get('/admin/pending', requireOwner, async (req, res) => {
    try {
        const pending = await CommunityModule.findAll({
            where: { status: 'PENDING' },
            order: [['createdAt', 'ASC']]
        });
        res.json({ modules: pending });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/modules/admin/all — Get all submissions
router.get('/admin/all', requireOwner, async (req, res) => {
    try {
        const allModules = await CommunityModule.findAll({
            order: [['updatedAt', 'DESC']]
        });
        res.json({ modules: allModules });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/modules/admin/:id/approve — Accept submission and notify author
router.post('/admin/:id/approve', requireOwner, async (req, res) => {
    try {
        const moduleItem = await CommunityModule.findOne({
            where: {
                [Op.or]: [
                    { id: isNaN(req.params.id) ? -1 : parseInt(req.params.id) },
                    { moduleId: req.params.id }
                ]
            }
        });

        if (!moduleItem) return res.status(404).json({ error: 'Module not found' });

        moduleItem.status = 'APPROVED';
        moduleItem.reviewedBy = req.user.username;
        moduleItem.reviewedAt = new Date();
        moduleItem.declineReason = null;
        await moduleItem.save();

        // Dispatch Notification directly to author's notifications feed
        await Notification.create({
            userId: moduleItem.authorId,
            title: `🎉 Module Approved: ${moduleItem.name}`,
            content: `Your module "${moduleItem.name}" (v${moduleItem.version}) has been accepted by the Nora Administration Team! It is now published and installable on the Server Module Hub.`,
            type: 'success',
            isSpecial: true,
            isOwnerAction: true
        });

        console.log(`[Owner Review] Module "${moduleItem.name}" APPROVED by ${req.user.username}. Author ${moduleItem.authorId} notified.`);

        res.json({
            success: true,
            message: `Module "${moduleItem.name}" has been approved and published to the Server Module Hub!`,
            module: moduleItem
        });
    } catch (e) {
        console.error('[Owner Approve] Error:', e);
        res.status(500).json({ error: 'Failed to approve module', details: e.message });
    }
});

// POST /api/modules/admin/:id/decline — Decline submission with reason and notify author
router.post('/admin/:id/decline', requireOwner, async (req, res) => {
    try {
        const { reason } = req.body;
        const moduleItem = await CommunityModule.findOne({
            where: {
                [Op.or]: [
                    { id: isNaN(req.params.id) ? -1 : parseInt(req.params.id) },
                    { moduleId: req.params.id }
                ]
            }
        });

        if (!moduleItem) return res.status(404).json({ error: 'Module not found' });

        moduleItem.status = 'DECLINED';
        moduleItem.reviewedBy = req.user.username;
        moduleItem.reviewedAt = new Date();
        moduleItem.declineReason = reason || 'The submission did not meet community quality or security guidelines.';
        await moduleItem.save();

        // Dispatch Notification directly to author's notifications feed
        await Notification.create({
            userId: moduleItem.authorId,
            title: `❌ Module Declined: ${moduleItem.name}`,
            content: `Your module submission "${moduleItem.name}" (v${moduleItem.version}) was declined during administrator review.\n\nReason: ${moduleItem.declineReason}`,
            type: 'error',
            isSpecial: true,
            isOwnerAction: true
        });

        console.log(`[Owner Review] Module "${moduleItem.name}" DECLINED by ${req.user.username}. Reason: ${moduleItem.declineReason}`);

        res.json({
            success: true,
            message: `Module "${moduleItem.name}" declined. Notification sent to developer.`,
            module: moduleItem
        });
    } catch (e) {
        console.error('[Owner Decline] Error:', e);
        res.status(500).json({ error: 'Failed to decline module', details: e.message });
    }
});

module.exports = router;
