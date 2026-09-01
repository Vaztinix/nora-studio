const { Events } = require('discord.js');
const { handleInviteCreate } = require('../utils/inviteTracker');

module.exports = {
    name: Events.InviteCreate,
    async execute(invite) {
        try {
            handleInviteCreate(invite);
        } catch (err) {
            console.error('[InviteCreate Handler Error]:', err.message);
        }
    }
};
