const fetch = require('node-fetch');

/**
 * Middleware to verify Discord Bearer Token and Guild Permissions
 */
const requireGuildPermission = async (req, res, next) => {
    // Determine the guildId from URL params or body
    const guildId = req.params.guildId || req.body.guildId;
    if (!guildId) {
        return res.status(400).json({ error: 'Missing guildId parameter.' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Fetch user's guilds from Discord
        const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        if (!response.ok) {
            return res.status(401).json({ error: 'Invalid or expired Discord token.' });
        }

        const guilds = await response.json();
        
        // Find the requested guild in the user's guild list
        const guild = guilds.find(g => g.id === guildId);
        
        if (!guild) {
            return res.status(403).json({ error: 'User is not in this guild or missing permissions.' });
        }

        // Check for ADMINISTRATOR (0x8) or MANAGE_GUILD (0x20)
        const permissions = BigInt(guild.permissions);
        const isAdmin = (permissions & BigInt(0x8)) === BigInt(0x8);
        const canManageGuild = (permissions & BigInt(0x20)) === BigInt(0x20);

        if (isAdmin || canManageGuild) {
            // User has permission, proceed to next middleware/handler
            req.userGuild = guild;
            next();
        } else {
            return res.status(403).json({ error: 'Insufficient permissions. You must have Administrator or Manage Server permissions.' });
        }
    } catch (error) {
        console.error('Discord Auth API Error:', error);
        return res.status(500).json({ error: 'Internal server error while verifying permissions.' });
    }
};

module.exports = { requireGuildPermission };
