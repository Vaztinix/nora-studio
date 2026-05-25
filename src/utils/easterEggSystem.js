const { EmbedBuilder } = require('discord.js');
const EasterEgg = require('../database/models/EasterEgg');

const EGG_CLUES = {
    1: "Leaderboard Participant",
    2: "AI Interaction",
    3: "Directory Exploration",
    4: "Guessing Game Participant",
    5: "Network Expansion",
    6: "Info Gathering",
    7: "Counting Milestone",
    8: "Bunny Hunter",
    9: "Rank Check",
    10: "Interaction Testing"
};

const TOTAL_EGGS = 10;
const ROLE_ID = '1488270214545014856';

/**
 * Event deactivated. Logic remains as a stub to prevent breaking command references.
 */
async function checkAndAwardEgg(interactionOrMessage, eggId) {
    // Event has concluded.
    return;
}

async function checkAndAwardGoldenEgg(message) {
    // Event has concluded.
    return;
}

module.exports = { checkAndAwardEgg, checkAndAwardGoldenEgg, EGG_CLUES, TOTAL_EGGS, ROLE_ID };
