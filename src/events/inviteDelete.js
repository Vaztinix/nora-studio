const { Events } = require('discord.js');
const { handleInviteDelete } = require('../utils/inviteTracker');

module.exports = {
    name: Events.InviteDelete,
    async execute(invite) {
        try {
            handleInviteDelete(invite);
        } catch (err) {
            console.error('[InviteDelete Handler Error]:', err.message);
        }
    }
};
