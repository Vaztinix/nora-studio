const express = require('express');
const router = express.Router();
const StatusFlag = require('../../database/models/StatusFlag');

module.exports = function(client) {
    /**
     * GET /api/status/public
     * Returns live shard metrics, health summary, and active/recent incident flags
     */
    router.get('/public', async (req, res) => {
        try {
            const flags = await StatusFlag.findAll({
                order: [['createdAt', 'DESC']],
                limit: 25
            }).catch(() => []);

            const activeFlags = flags.filter(f => !f.isResolved);
            
            // Determine system status
            let systemStatus = 'operational';
            let statusText = 'All Systems Operational';

            if (activeFlags.some(f => f.severity === 'outage')) {
                systemStatus = 'outage';
                statusText = 'Partial Service Outage Reported';
            } else if (activeFlags.some(f => f.severity === 'degraded') || (client && client.ws && client.ws.ping > 250)) {
                systemStatus = 'degraded';
                statusText = 'Degraded Gateway Performance';
            } else if (activeFlags.some(f => f.severity === 'maintenance')) {
                systemStatus = 'maintenance';
                statusText = 'Scheduled Maintenance Underway';
            }

            // Gather shard metrics
            const shardCount = (client && client.options && client.options.shardCount) ? client.options.shardCount : 1;
            const shards = [];

            const totalGuilds = client && client.guilds ? client.guilds.cache.size : 0;
            const totalMembers = client && client.guilds 
                ? client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0)
                : 0;

            const wsPing = client && client.ws ? Math.round(client.ws.ping) : 0;
            const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
            const uptimeSec = Math.floor(process.uptime());

            for (let i = 0; i < shardCount; i++) {
                shards.push({
                    id: i,
                    name: `Shard #${i}`,
                    status: (client && client.ws && client.ws.status === 0) ? 'READY' : 'CONNECTING',
                    pingMs: wsPing,
                    guilds: totalGuilds,
                    users: totalMembers,
                    uptimeSeconds: uptimeSec,
                    memoryUsedMB: heapMB,
                    memoryRssMB: rssMB,
                    lastPingTimestamp: Date.now()
                });
            }

            res.json({
                systemStatus,
                statusText,
                shards,
                incidents: flags,
                activeCount: activeFlags.length,
                updatedAt: new Date().toISOString()
            });
        } catch (err) {
            console.error('[Status API Error]:', err);
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /api/status/incidents
     */
    router.get('/incidents', async (req, res) => {
        try {
            const flags = await StatusFlag.findAll({
                order: [['createdAt', 'DESC']],
                limit: 50
            }).catch(() => []);
            res.json({ incidents: flags });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /api/status/incidents (Owner / Admin Key authorized)
     */
    router.post('/incidents', async (req, res) => {
        try {
            const { title, message, severity, shardId, author, apiKey } = req.body || {};
            const APP_OWNER_ID = '1214048435632603137';

            if (apiKey !== process.env.BOTBOARD_API_KEY && req.headers['x-owner-id'] !== APP_OWNER_ID) {
                return res.status(401).json({ error: 'Unauthorized status flag creation.' });
            }

            if (!title || !message) {
                return res.status(400).json({ error: 'Title and message required.' });
            }

            const flag = await StatusFlag.create({
                title,
                message,
                severity: severity || 'info',
                shardId: shardId || 0,
                author: author || 'System Flag',
                isResolved: false
            });

            res.json({ status: 'ok', flag });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * PATCH /api/status/incidents/:id/resolve
     */
    router.patch('/incidents/:id/resolve', async (req, res) => {
        try {
            const id = req.params.id;
            const { resolutionNote, apiKey } = req.body || {};
            const APP_OWNER_ID = '1214048435632603137';

            if (apiKey !== process.env.BOTBOARD_API_KEY && req.headers['x-owner-id'] !== APP_OWNER_ID) {
                return res.status(401).json({ error: 'Unauthorized incident resolution.' });
            }

            const flag = await StatusFlag.findByPk(id);
            if (!flag) {
                return res.status(404).json({ error: 'Status flag not found.' });
            }

            flag.isResolved = true;
            flag.resolvedAt = new Date();
            if (resolutionNote) flag.resolutionNote = resolutionNote;
            await flag.save();

            res.json({ status: 'ok', flag });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
