/**
 * Utility to format announcement templates with member/guild placeholders.
 * 
 * Placeholders:
 * - {user}: mentions the user (<@userId>)
 * - {username}: plain username
 * - {id}: user ID
 * - {guild}: guild name
 * - {membercount}: guild member count
 * - {level}: user level (for level up alerts)
 * 
 * @param {string} template 
 * @param {Object} member - GuildMember or user object with guild context
 * @param {number|string} [level=null] - Optional level milestone
 * @returns {string} formatted string
 */
function formatMessage(template, member, level = null) {
    if (!template) return '';
    
    const guild = member.guild;
    
    // Resolve user ID and username from direct User or GuildMember structure
    let userId = '';
    let username = '';
    
    if (member.user) {
        userId = member.user.id || member.id || '';
        username = member.user.username || '';
    } else {
        userId = member.id || '';
        username = member.username || '';
    }
    
    return template
        .replace(/{user}/g, `<@${userId}>`)
        .replace(/{username}/g, username)
        .replace(/{id}/g, userId)
        .replace(/{guild}/g, guild ? guild.name : '')
        .replace(/{membercount}/g, guild ? guild.memberCount : '')
        .replace(/{level}/g, level !== null ? String(level) : '');
}

module.exports = {
    formatMessage
};
