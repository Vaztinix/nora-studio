const settingsCache = require('../../utils/settingsCache');

/**
 * Validates message interaction times against the bot's installation boundary.
 * Completely isolates pre-existing history to maintain strict data privacy compliance.
 */
async function processMessageEvent(incomingMessage) {
    // Ignore messages processed outside of formal server text spaces
    if (!incomingMessage.guild) return null;
    
    const targetGuildId = incomingMessage.guild.id;
    
    // Extract server configuration metadata from our cache layer
    const guildProfile = await settingsCache.get(targetGuildId);
    if (!guildProfile) return null;
    
    // Initialize installedAt if not set yet (safety fallback)
    if (!guildProfile.installedAt) {
        guildProfile.installedAt = new Date();
        await guildProfile.save();
    }
    
    // Extract essential timeline parameters
    const botJoinTimestamp = new Date(guildProfile.installedAt).getTime();
    const messageCreationTimestamp = new Date(incomingMessage.createdAt).getTime();
    
    // Enforce the forward-only timeline security boundary
    if (messageCreationTimestamp < botJoinTimestamp) {
        // Drop data silently. No tracking, no indexing, zero collection.
        return null; 
    }
    
    // Route data to the analytics pipeline if message was created post-installation
    return {
        guildId: targetGuildId,
        authorId: incomingMessage.author.id,
        content: incomingMessage.content,
        eligibleForUptime: true
    };
}

module.exports = {
    processMessageEvent
};
