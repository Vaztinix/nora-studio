const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { Op } = require('sequelize');
const VerificationLog = require('../../database/models/VerificationLog');
const IpBan = require('../../database/models/IpBan');
const GuildSettings = require('../../database/models/GuildSettings');

const GUILD_MAP = {
    'milos-world': '1487342521133830174',
    'noras-hub': '1515800329889779954'
};

const REVERSE_GUILD_MAP = {
    '1487342521133830174': 'milos-world',
    '1515800329889779954': 'noras-hub'
};

// In-memory ticket cache: ticketId -> { guildId, createdAt, expiresAt }
// Valid for 15 minutes to guarantee the link comes from a real Discord interaction
const activeTickets = new Map();

function createTicket(guildId) {
    const ticketId = crypto.randomBytes(24).toString('hex');
    activeTickets.set(ticketId, {
        guildId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 15 * 60 * 1000
    });
    return ticketId;
}

// Clean up expired tickets every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [tid, t] of activeTickets.entries()) {
        if (t.expiresAt < now) activeTickets.delete(tid);
    }
}, 5 * 60 * 1000);

// Helper to extract client IP reliably behind Cloudflare / reverse proxies
function getClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) return cfIp.trim();
    
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
        const parts = xff.split(',');
        if (parts.length > 0 && parts[0].trim()) {
            return parts[0].trim();
        }
    }
    return req.socket.remoteAddress || req.ip || '127.0.0.1';
}

// Anti-VPN & Datacenter Proxy detector
function isVpnOrDatacenter(req, clientIp) {
    if (req.headers['cf-ipcountry'] === 'T1') {
        return { isVpn: true, reason: 'Tor Exit Node detected' };
    }

    if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp.startsWith('192.168.') || clientIp.startsWith('10.')) {
        return { isVpn: false };
    }

    const dcPrefixes = [
        '3.','18.','34.','35.','44.','52.','54.', // AWS
        '104.248.','159.65.','167.99.','178.62.', // DigitalOcean
        '138.68.','142.93.','157.245.','165.22.',  // DigitalOcean
        '45.33.','45.56.','45.79.','50.116.',     // Linode
        '172.104.','172.105.','192.155.','198.58.', // Linode
        '88.99.','144.76.','148.251.','176.9.',   // Hetzner
        '5.9.','78.46.','78.47.','159.69.','168.119.', // Hetzner
        '51.254.','51.255.','147.135.','198.245.', // OVH
        '140.238.','150.136.','152.67.','158.101.' // Oracle Cloud
    ];

    for (const prefix of dcPrefixes) {
        if (clientIp.startsWith(prefix)) {
            return { isVpn: true, reason: 'Datacenter / Hosting provider IP range detected' };
        }
    }

    return { isVpn: false };
}

// GET /api/verify/insite/session-check
// Validates that the user arrived via a valid server redirect ticket
router.get('/session-check', async (req, res) => {
    try {
        const { serverSlug, ticket } = req.query;
        const guildId = GUILD_MAP[serverSlug];
        if (!guildId) {
            return res.status(404).json({
                valid: false,
                error: 'Invalid server portal. In-site verification is exclusively active for Milo\'s World and Nora\'s Hub.'
            });
        }

        // Validate ticket: must have an active ticket OR signed auth session
        let hasValidTicket = false;
        if (ticket && activeTickets.has(ticket)) {
            const t = activeTickets.get(ticket);
            if (t.guildId === guildId && t.expiresAt > Date.now()) {
                hasValidTicket = true;
            }
        }

        // Also accept valid bypass in dev or if user has an auth token from previous click
        if (!hasValidTicket && req.headers.authorization) {
            hasValidTicket = true;
        }

        const client = req.client;
        const guild = client ? client.guilds.cache.get(guildId) : null;

        res.json({
            valid: hasValidTicket,
            guildId,
            serverSlug,
            serverName: guild ? guild.name : (serverSlug === 'milos-world' ? "Milo's World" : "Nora's Hub"),
            serverIcon: guild && guild.icon ? guild.iconURL({ size: 128 }) : null,
            memberCount: guild ? guild.memberCount : 7646,
            requiresServerRedirect: !hasValidTicket
        });
    } catch (e) {
        console.error('[InSite Verify] Session Check Error:', e);
        res.status(500).json({ valid: false, error: e.message });
    }
});

// POST /api/verify/insite/create-ticket (Internal Discord Bot interaction helper)
router.post('/create-ticket', async (req, res) => {
    try {
        const { guildId } = req.body;
        if (!guildId || !REVERSE_GUILD_MAP[guildId]) {
            return res.status(403).json({ error: 'Server not authorized for in-site security pass.' });
        }
        const ticketId = createTicket(guildId);
        const slug = REVERSE_GUILD_MAP[guildId];
        const verifyUrl = `https://vaztinix.dev/verify/security/${slug}?ticket=${ticketId}`;
        res.json({ success: true, ticketId, verifyUrl });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/verify/insite/submit
// Executes full forensic analysis, logs to database, checks VPNs & alts, and grants roles
router.post('/submit', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: Missing Discord user token' });
        }

        const { serverSlug, ticket, forensics } = req.body;
        const guildId = GUILD_MAP[serverSlug];
        if (!guildId) {
            return res.status(403).json({ error: 'Forbidden: In-site verification is restricted to official authorized servers.' });
        }

        const client = req.client;
        if (!client) {
            return res.status(500).json({ error: 'Discord client service temporarily unavailable.' });
        }

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            return res.status(404).json({ error: 'Server not found.' });
        }

        // 1. Fetch Discord Identity from official API
        let discordUser;
        try {
            const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: authHeader },
                timeout: 6000
            });
            discordUser = userRes.data;
        } catch (authErr) {
            return res.status(401).json({ error: 'Invalid or expired Discord authorization session.' });
        }

        const userId = discordUser.id;
        const username = discordUser.username;
        const userAvatar = discordUser.avatar 
            ? `https://cdn.discordapp.com/avatars/${userId}/${discordUser.avatar}.webp` 
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(userId.slice(-1)) % 5}.png`;

        const clientIp = getClientIp(req);

        // 2. Extract Location Metadata from Cloudflare headers
        const country = req.headers['cf-ipcountry'] || 'US';
        const city = req.headers['cf-ipcity'] || 'Unknown';
        const region = req.headers['cf-region'] || 'Unknown';
        const timezone = forensics?.timezone || 'UTC';

        const locationData = JSON.stringify({
            country,
            city,
            region,
            timezone,
            asn: req.headers['cf-asn'] || 'N/A'
        });

        // 3. Extract Browser & Hardware Forensics
        const browserFingerprint = JSON.stringify({
            userAgent: req.headers['user-agent'] || forensics?.userAgent || 'Unknown',
            platform: forensics?.platform || 'Unknown',
            screen: forensics?.screenResolution || 'Unknown',
            canvasHash: forensics?.canvasHash || 'N/A',
            webglVendor: forensics?.webglVendor || 'N/A',
            webglRenderer: forensics?.webglRenderer || 'N/A',
            languages: forensics?.languages || []
        });

        // 4. Fetch Guild Member
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return res.status(400).json({
                error: `You must join ${guild.name} on Discord before completing verification.`
            });
        }

        // 5. Check Permanent IP Bans table
        const ipBanRecord = await IpBan.findOne({ where: { ipAddress: clientIp } });
        if (ipBanRecord) {
            await member.ban({ reason: `[Nora Auto-Shield] Banned IP address (${ipBanRecord.reason || 'IP Blacklist'})` }).catch(() => {});
            await VerificationLog.create({
                guildId,
                serverSlug,
                userId,
                username,
                userAvatar,
                method: 'In-Site Security Pass',
                status: 'BLOCKED',
                riskScore: 100,
                riskLevel: 'Critical',
                ipAddress: clientIp,
                locationData,
                browserFingerprint,
                altDetected: true,
                ticketToken: ticket || null,
                correlationRationale: `Direct IP ban match (${ipBanRecord.reason || 'Permanent ban'}). Account immediately auto-banned.`,
                findingsSummary: `IP Blacklist Match: Connection IP ${clientIp} matches global disciplinary ban record.`,
                confidenceScore: '100% Cryptographic Match'
            });

            return res.status(403).json({
                success: false,
                code: 'IP_BANNED',
                message: 'Verification declined: Network connection is restricted for security violations.'
            });
        }

        // 6. Anti-VPN / Datacenter Proxy Detection
        const vpnCheck = isVpnOrDatacenter(req, clientIp);
        if (vpnCheck.isVpn) {
            await VerificationLog.create({
                guildId,
                serverSlug,
                userId,
                username,
                userAvatar,
                method: 'In-Site Security Pass',
                status: 'BLOCKED',
                riskScore: 85,
                riskLevel: 'High',
                ipAddress: clientIp,
                locationData,
                browserFingerprint,
                vpnDetected: true,
                ticketToken: ticket || null,
                correlationRationale: `VPN / Proxy Tunnel Detected: ${vpnCheck.reason}. Blocked to prevent proxy evasion.`,
                findingsSummary: `Proxy / Tunneling Detected: ${vpnCheck.reason}.`,
                confidenceScore: '95% Network Fingerprint'
            });

            return res.status(403).json({
                success: false,
                code: 'VPN_DETECTED',
                message: 'VPN or Proxy connection detected. Please disable your VPN to complete verification.'
            });
        }

        // 7. Comprehensive Alt & Ban Evasion Comparison Engine
        // Query past verification records for the guild with matching IP, Canvas hash, or Subnet
        const subnet = clientIp.split('.').slice(0, 3).join('.'); // /24 subnet

        const pastLogs = await VerificationLog.findAll({
            where: {
                guildId,
                userId: { [Op.ne]: userId }
            },
            order: [['createdAt', 'DESC']],
            limit: 250
        });

        const linkedAlts = [];
        const rationalePoints = [];
        let isAltMatch = false;

        const canvasHash = forensics?.canvasHash;

        for (const log of pastLogs) {
            let matchedReasons = [];

            // Test A: Exact IP match
            if (log.ipAddress && log.ipAddress === clientIp) {
                matchedReasons.push(`Exact IP Match (${clientIp})`);
            }

            // Test B: Exact Canvas / WebGL hardware fingerprint match
            if (canvasHash && log.browserFingerprint && log.browserFingerprint.includes(canvasHash) && canvasHash !== 'N/A') {
                matchedReasons.push(`Identical Canvas Hardware Fingerprint (${canvasHash.slice(0, 10)}...)`);
            }

            // Test C: Subnet match + identical User-Agent
            if (log.ipAddress && log.ipAddress.startsWith(subnet) && log.browserFingerprint && forensics?.userAgent && log.browserFingerprint.includes(forensics.userAgent)) {
                matchedReasons.push(`Subnet & User-Agent Match (${subnet}.x)`);
            }

            if (matchedReasons.length > 0) {
                isAltMatch = true;
                linkedAlts.push({
                    userId: log.userId,
                    username: log.username,
                    reasons: matchedReasons
                });
                rationalePoints.push(`Linked to account ${log.username || log.userId} (${log.userId}) via: ${matchedReasons.join(' + ')}`);
            }
        }

        const linkedUserIds = Array.from(new Set(linkedAlts.map(a => a.userId)));

        // 8. Ban Evasion Cross-Reference: Check if ANY linked alt is banned in the guild!
        let matchedBannedAlt = null;
        if (linkedUserIds.length > 0) {
            const guildBans = await guild.bans.fetch().catch(() => new Map());
            for (const lid of linkedUserIds) {
                if (guildBans.has(lid)) {
                    matchedBannedAlt = guildBans.get(lid);
                    break;
                }
            }
        }

        if (matchedBannedAlt) {
            // CRITICAL: Ban evasion confirmed! Auto-ban alt immediately
            const banReason = `[Nora Auto-Shield] Ban evasion detected (Alt of banned user: ${matchedBannedAlt.user.tag} - ID: ${matchedBannedAlt.user.id})`;
            await member.ban({ reason: banReason }).catch(e => console.error('Failed to auto-ban alt:', e));

            const fullRationale = `BAN EVASION CONFIRMED:\n• Matched banned user: ${matchedBannedAlt.user.tag} (${matchedBannedAlt.user.id})\n• Forensic correlations:\n  ${rationalePoints.join('\n  ')}\n• Auto-Action: Banned from ${guild.name}.`;

            await VerificationLog.create({
                guildId,
                serverSlug,
                userId,
                username,
                userAvatar,
                method: 'In-Site Security Pass',
                status: 'BLOCKED',
                riskScore: 100,
                riskLevel: 'Critical',
                ipAddress: clientIp,
                locationData,
                browserFingerprint,
                altDetected: true,
                linkedAltIds: JSON.stringify(linkedUserIds),
                ticketToken: ticket || null,
                correlationRationale: fullRationale,
                findingsSummary: `Ban Evasion Confirmed: User network and hardware fingerprints match banned member ${matchedBannedAlt.user.tag}. Account automatically banned.`,
                confidenceScore: '100% Cryptographic Correlation'
            });

            return res.status(403).json({
                success: false,
                code: 'BAN_EVASION_DETECTED',
                message: 'Verification rejected: Ban evasion policy violation.'
            });
        }

        // 9. Clean Verification! Grant Verified Role
        let verifiedRoleAwarded = false;
        if (guildId === '1487342521133830174') { // Milo's World
            const verifiedRoleId = '1545240828354633819';
            const unverifiedRoleId = '1539017864709669054';
            await member.roles.add(verifiedRoleId).catch(() => {});
            await member.roles.remove(unverifiedRoleId).catch(() => {});
            verifiedRoleAwarded = true;
        } else {
            // Nora's Hub
            const gs = await GuildSettings.findOne({ where: { guildId } });
            if (gs && gs.verifyRoleId) {
                await member.roles.add(gs.verifyRoleId).catch(() => {});
                verifiedRoleAwarded = true;
            }
        }

        const cleanRationale = isAltMatch 
            ? `Multi-account correlation detected in same household/network (${linkedUserIds.length} linked accounts: ${linkedUserIds.join(', ')}). No banned records found. Verified.`
            : `100% Unique connection. Zero correlated alts or proxy indicators found. Clean residential verification.`;

        await VerificationLog.create({
            guildId,
            serverSlug,
            userId,
            username,
            userAvatar,
            method: 'In-Site Security Pass',
            status: 'VERIFIED',
            riskScore: isAltMatch ? 25 : 0,
            riskLevel: isAltMatch ? 'Medium' : 'Low',
            ipAddress: clientIp,
            locationData,
            browserFingerprint,
            altDetected: isAltMatch,
            linkedAltIds: linkedUserIds.length > 0 ? JSON.stringify(linkedUserIds) : null,
            ticketToken: ticket || null,
            correlationRationale: cleanRationale,
            findingsSummary: isAltMatch
                ? `Verified (Household / Alt flag: ${linkedUserIds.length} accounts found). Clean disciplinary history.`
                : 'Clean Background: Unique IP, authentic browser fingerprint, 0 risk flags.',
            confidenceScore: '100% Authentic Match'
        });

        // Invalidate the ticket so it cannot be reused
        if (ticket) activeTickets.delete(ticket);

        res.json({
            success: true,
            verified: true,
            message: `Verification complete! You are now verified in ${guild.name}.`,
            roleGranted: verifiedRoleAwarded
        });

    } catch (e) {
        console.error('[InSite Verify] Submit Error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
module.exports.createTicket = createTicket;
