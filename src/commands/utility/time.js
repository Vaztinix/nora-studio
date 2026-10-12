const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Common timezone offsets in minutes relative to UTC
 */
const TIMEZONE_OFFSETS = {
    // North America
    'pst': -8 * 60,
    'pdt': -7 * 60,
    'mst': -7 * 60,
    'mdt': -6 * 60,
    'cst': -6 * 60,
    'cdt': -5 * 60,
    'est': -5 * 60,
    'edt': -4 * 60,
    'ast': -4 * 60,
    'nst': -3.5 * 60,
    'hst': -10 * 60,
    'akst': -9 * 60,
    'akdt': -8 * 60,

    // Europe & Africa
    'utc': 0,
    'gmt': 0,
    'wet': 0,
    'bst': 1 * 60,
    'cet': 1 * 60,
    'cest': 2 * 60,
    'eet': 2 * 60,
    'eest': 3 * 60,
    'msk': 3 * 60, // Moscow Standard Time (UTC+3, No DST)

    // Asia & Pacific
    'ist': 5.5 * 60, // India (UTC+5:30)
    'wib': 7 * 60,
    'ict': 7 * 60,
    'cst_china': 8 * 60,
    'sgt': 8 * 60,
    'pht': 8 * 60,
    'jst': 9 * 60, // Japan (UTC+9)
    'kst': 9 * 60, // Korea (UTC+9)
    'acst': 9.5 * 60,
    'aest': 10 * 60,
    'aedt': 11 * 60,
    'nzst': 12 * 60,
    'nzdt': 13 * 60
};

const MSK_OFFSET_MINUTES = 3 * 60; // UTC+3

function parseTimeString(timeStr) {
    if (!timeStr) return null;
    const clean = timeStr.trim().toLowerCase();
    const match = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3];

    if (minutes < 0 || minutes >= 60) return null;

    if (meridiem) {
        if (hours < 1 || hours > 12) return null;
        if (meridiem === 'pm' && hours < 12) hours += 12;
        if (meridiem === 'am' && hours === 12) hours = 0;
    } else {
        if (hours < 0 || hours >= 24) return null;
    }

    return { hours, minutes };
}

function formatTime(hours, minutes, hour12 = true) {
    const adjustedH = ((hours % 24) + 24) % 24;
    const padMin = String(minutes).padStart(2, '0');

    if (!hour12) {
        return `${String(adjustedH).padStart(2, '0')}:${padMin}`;
    }

    const meridiem = adjustedH >= 12 ? 'PM' : 'AM';
    let h12 = adjustedH % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${padMin} ${meridiem}`;
}

function getMskLiveDate() {
    const now = new Date();
    const mskFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Moscow',
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true
    });
    const msk24Formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Moscow',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    });
    return {
        formatted: mskFormatter.format(now),
        time24: msk24Formatter.format(now),
        now
    };
}

module.exports = {
    category: 'utility',
    data: new SlashCommandBuilder()
        .setName('time')
        .setDescription('Check current time for Vaztinix in Moscow (MSK) or convert between timezones.')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .setDMPermission(true)
        .addSubcommand(sub =>
            sub.setName('vaz')
                .setDescription('Check current time for Vaztinix in Moscow, Russia (MSK, UTC+3).'))
        .addSubcommand(sub =>
            sub.setName('convert')
                .setDescription('Convert your time to Vaztinix\'s Moscow time (MSK).')
                .addStringOption(opt =>
                    opt.setName('time')
                        .setDescription('The time to convert (e.g., "8:00 PM", "15:30", "3pm")')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('from_timezone')
                        .setDescription('Your timezone abbreviation (e.g., EST, PST, GMT, CET, IST)')
                        .setRequired(true)
                        .addChoices(
                            { name: 'EST / EDT (Eastern US, UTC-5 / UTC-4)', value: 'edt' },
                            { name: 'CST / CDT (Central US, UTC-6 / UTC-5)', value: 'cdt' },
                            { name: 'MST / MDT (Mountain US, UTC-7 / UTC-6)', value: 'mdt' },
                            { name: 'PST / PDT (Pacific US, UTC-8 / UTC-7)', value: 'pdt' },
                            { name: 'GMT / UTC (Greenwich / UTC+0)', value: 'utc' },
                            { name: 'BST (British Summer Time, UTC+1)', value: 'bst' },
                            { name: 'CET / CEST (Central European, UTC+1 / UTC+2)', value: 'cest' },
                            { name: 'IST (India Standard Time, UTC+5:30)', value: 'ist' },
                            { name: 'SGT / PHT (Singapore / Philippines, UTC+8)', value: 'sgt' },
                            { name: 'JST / KST (Japan / Korea, UTC+9)', value: 'jst' },
                            { name: 'AEST / AEDT (Eastern Australia, UTC+10 / UTC+11)', value: 'aedt' }
                        )))
        .addSubcommand(sub =>
            sub.setName('world')
                .setDescription('Compare Moscow Time (MSK) across major global timezones.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand() || 'vaz';
        const mskData = getMskLiveDate();

        // ------------------------------------------
        // 1. SUBCOMMAND: /time vaz (Default)
        // ------------------------------------------
        if (subcommand === 'vaz') {
            const embed = new EmbedBuilder()
                .setColor(0xA855F7)
                .setTitle('🇷🇺 Vaztinix Current Time — Moscow, Russia')
                .setDescription(
                    `Here is the live local time for **Vaztinix** (<@1214048435632603137>)!\n\n` +
                    `⏰ **Current Time:** \`${mskData.formatted}\` (MSK, UTC+3)\n` +
                    `🌐 **24-Hour Format:** \`${mskData.time24} MSK\`\n\n` +
                    `*Vaztinix is a Russian developer based in Moscow who studies lots of English :3*`
                )
                .addFields(
                    { name: '🌍 Timezone', value: '`MSK (Moscow Standard Time)`\n`UTC+3` (No Daylight Saving)', inline: true },
                    { name: '📍 Location', value: 'Moscow, Russia 🇷🇺', inline: true },
                    { name: '💬 Language', value: 'Russian & English :3', inline: true }
                )
                .setFooter({ text: 'Use `/time convert` to convert your local time to MSK!' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Vaztinix YouTube').setStyle(ButtonStyle.Link).setURL('https://www.youtube.com/@Vaztinix'),
                new ButtonBuilder().setLabel('Nora Studio').setStyle(ButtonStyle.Link).setURL('https://vaztinix.dev')
            );

            return interaction.reply({ embeds: [embed], components: [row] });
        }

        // ------------------------------------------
        // 2. SUBCOMMAND: /time convert
        // ------------------------------------------
        if (subcommand === 'convert') {
            const rawTime = interaction.options.getString('time');
            const fromTz = (interaction.options.getString('from_timezone') || '').toLowerCase();

            const parsed = parseTimeString(rawTime);
            if (!parsed) {
                return interaction.reply({
                    content: '❌ Invalid time format! Please provide a time like `"8:00 PM"`, `"15:30"`, or `"3pm"`.',
                    ephemeral: true
                });
            }

            const fromOffset = TIMEZONE_OFFSETS[fromTz] ?? 0;
            // Difference in minutes to MSK (UTC+3)
            const diffMinutes = MSK_OFFSET_MINUTES - fromOffset;

            const totalOriginalMinutes = parsed.hours * 60 + parsed.minutes;
            const totalMskMinutes = totalOriginalMinutes + diffMinutes;

            const mskHours = Math.floor(totalMskMinutes / 60);
            const mskMins = totalMskMinutes % 60;

            const formattedOriginal = formatTime(parsed.hours, parsed.minutes);
            const formattedMsk = formatTime(mskHours, mskMins);
            const formattedMsk24 = formatTime(mskHours, mskMins, false);

            const hourDiff = (diffMinutes / 60).toFixed(1).replace('.0', '');
            const aheadBehind = diffMinutes >= 0 ? `${hourDiff} hours ahead of` : `${Math.abs(hourDiff)} hours behind`;

            let dayNote = '';
            if (totalMskMinutes >= 24 * 60) {
                dayNote = ' *(Next day in Moscow)*';
            } else if (totalMskMinutes < 0) {
                dayNote = ' *(Previous day in Moscow)*';
            }

            const embed = new EmbedBuilder()
                .setColor(0x6366F1)
                .setTitle('🔄 Timezone Conversion to Moscow (MSK)')
                .setDescription(
                    `Converted your time to **Vaztinix's time in Moscow, Russia**!\n\n` +
                    `🕒 **Your Time (${fromTz.toUpperCase()}):** \`${formattedOriginal}\`\n` +
                    `🇷🇺 **Vaztinix's Time (MSK):** **\`${formattedMsk}\`** (\`${formattedMsk24}\`)${dayNote}\n\n` +
                    `Moscow is **${aheadBehind}** your timezone.\n` +
                    `*Vaz is a Russian developer who studies lots of English :3*`
                )
                .addFields(
                    { name: '📍 Moscow Timezone', value: '`MSK (UTC+3)`', inline: true },
                    { name: '⏰ Right Now in Moscow', value: `\`${mskData.formatted}\``, inline: true }
                )
                .setFooter({ text: 'Nora Timezone Conversion Engine • MSK (UTC+3)' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        // ------------------------------------------
        // 3. SUBCOMMAND: /time world
        // ------------------------------------------
        if (subcommand === 'world') {
            const now = new Date();
            const formatForTz = (tz) => {
                return new Intl.DateTimeFormat('en-US', {
                    timeZone: tz,
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: true
                }).format(now);
            };

            const embed = new EmbedBuilder()
                .setColor(0x3B82F6)
                .setTitle('🌐 Global Time Matrix vs Moscow (MSK)')
                .setDescription(
                    `Current live clocks comparing world regions to **Vaztinix in Moscow, Russia**:\n\n` +
                    `🇷🇺 **Moscow (MSK / UTC+3):** **\`${formatForTz('Europe/Moscow')}\`** *(Vaztinix)*\n\n` +
                    `🇺🇸 **US Pacific (PST/PDT):** \`${formatForTz('America/Los_Angeles')}\` *(Moscow is +10h)*\n` +
                    `🇺🇸 **US Eastern (EST/EDT):** \`${formatForTz('America/New_York')}\` *(Moscow is +7h)*\n` +
                    `🇬🇧 **London (GMT/BST):** \`${formatForTz('Europe/London')}\` *(Moscow is +2h)*\n` +
                    `🇪🇺 **Central Europe (CET/CEST):** \`${formatForTz('Europe/Paris')}\` *(Moscow is +1h)*\n` +
                    `🇮🇳 **India (IST):** \`${formatForTz('Asia/Kolkata')}\` *(Moscow is -2.5h)*\n` +
                    `🇯🇵 **Tokyo (JST):** \`${formatForTz('Asia/Tokyo')}\` *(Moscow is -6h)*\n` +
                    `🇦🇺 **Sydney (AEST/AEDT):** \`${formatForTz('Australia/Sydney')}\` *(Moscow is -8h)*\n\n` +
                    `*Vaztinix lives in Moscow, Russia and studies lots of English :3*`
                )
                .setFooter({ text: 'Current Moscow Time • MSK (UTC+3)' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }
    }
};
