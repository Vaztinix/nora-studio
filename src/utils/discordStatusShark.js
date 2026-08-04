/**
 * Discord API Outage Monitor ("Status Shark")
 * 
 * Features:
 * - Polls https://discordstatus.com/api/v2/summary.json every interval (default 60s)
 * - Isolates the "API" component status
 * - Deduplicates alerts (Anti-flapping logic: only 1 alert on DOWN, 1 alert on RECOVERY)
 * - Tracks exact timestamp when API goes DOWN
 * - Calculates precise, human-readable outage duration on recovery
 * - Sends rich Discord Embeds via Webhook (Red for Outage, Green for Recovery)
 * - Supports custom webhook username ("Status Shark") and avatar URL
 */

const axios = require('axios');

// Configuration (Loaded from environment variables with safe defaults)
const CONFIG = {
  WEBHOOK_URL: process.env.DISCORD_STATUS_WEBHOOK_URL || '',
  CHECK_INTERVAL_MS: parseInt(process.env.STATUS_CHECK_INTERVAL_MS, 10) || 60000,
  STATUS_PAGE_URL: process.env.DISCORD_STATUS_URL || 'https://discordstatus.com/api/v2/summary.json',
  USERNAME: 'Status Shark',
  AVATAR_URL: process.env.STATUS_SHARK_AVATAR_URL || 'https://nora.vaztinix.com/nora.png', // Nora Avatar Image URL
  CHANNEL_ID: '1533291837173792859'
};

/**
 * State Manager abstraction (Can be in-memory or database-backed)
 */
class StatusStateStore {
  constructor(initialState = { isDown: false, downSince: null }) {
    this.state = { ...initialState };
  }

  get() {
    return { ...this.state };
  }

  set(newState) {
    this.state = { ...this.state, ...newState };
  }
}

/**
 * Format dynamic duration into human-readable string
 * @param {number} ms - Outage duration in milliseconds
 * @returns {string} e.g. "14 minutes and 32 seconds" or "2 hours, 5 minutes and 10 seconds"
 */
function formatDuration(ms) {
  if (!ms || ms < 0) return '0 seconds';

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds > 1 ? 's' : ''}`);

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Format status slug (e.g. partial_outage -> Partial Outage)
 */
function formatStatusName(status) {
  if (!status) return 'Unknown';
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Send Discord Webhook Payload
 */
async function sendWebhookPayload(embed) {
  if (!CONFIG.WEBHOOK_URL) {
    console.warn('[Status Shark] WEBHOOK_URL is not configured in environment. Skipping webhook execution.');
    return;
  }

  const payload = {
    username: CONFIG.USERNAME,
    avatar_url: CONFIG.AVATAR_URL,
    embeds: [embed]
  };

  try {
    await axios.post(CONFIG.WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    console.log(`[Status Shark] Successfully posted webhook alert: "${embed.title}"`);
  } catch (err) {
    console.error('[Status Shark] Failed to send webhook alert:', err.response?.data || err.message);
  }
}

/**
 * Main Check Task
 */
async function checkDiscordStatus(stateStore) {
  try {
    const response = await axios.get(CONFIG.STATUS_PAGE_URL, { timeout: 10000 });
    const components = response.data?.components || [];
    
    // Isolate the "API" component
    const apiComponent = components.find(c => c.name === 'API');

    if (!apiComponent) {
      console.warn('[Status Shark] Could not locate "API" component in Discord status response.');
      return;
    }

    const currentStatus = apiComponent.status; // 'operational', 'partial_outage', 'major_outage', 'degraded_performance'
    const isCurrentlyOperational = currentStatus === 'operational';
    const currentState = stateStore.get();
    const now = Date.now();

    // State Tracking & Deduplication logic
    
    // CASE 1: Status turned DOWN (operational -> outage/degraded)
    if (!isCurrentlyOperational && !currentState.isDown) {
      const downTimestamp = now;
      stateStore.set({
        isDown: true,
        downSince: downTimestamp,
        lastStatus: currentStatus
      });

      const readableStatus = formatStatusName(currentStatus);
      const unixTimestamp = Math.floor(downTimestamp / 1000);

      // Webhook Payload - Outage Notification (Red Banner #ED4245)
      const embed = {
        title: '🚨 Discord API Outage Detected',
        description: `The **Discord API** system status has changed from operational to **${readableStatus}**.`,
        color: 0xED4245, // Red
        fields: [
          {
            name: 'Current Status',
            value: `\`${readableStatus}\``,
            inline: true
          },
          {
            name: 'Outage Started At',
            value: `<t:${unixTimestamp}:F> (<t:${unixTimestamp}:R>)`,
            inline: true
          },
          {
            name: 'Target Channel',
            value: `<#${CONFIG.CHANNEL_ID}>`,
            inline: true
          }
        ],
        footer: {
          text: 'Status Shark • Discord API Monitoring Service'
        },
        timestamp: new Date(downTimestamp).toISOString()
      };

      await sendWebhookPayload(embed);
    }
    
    // CASE 2: Status RECOVERED (outage -> operational)
    else if (isCurrentlyOperational && currentState.isDown) {
      const recoveryTimestamp = now;
      const downSince = currentState.downSince || recoveryTimestamp;
      const durationMs = recoveryTimestamp - downSince;
      const formattedDuration = formatDuration(durationMs);

      // Reset state flag to UP
      stateStore.set({
        isDown: false,
        downSince: null,
        lastStatus: 'operational'
      });

      const unixDown = Math.floor(downSince / 1000);
      const unixUp = Math.floor(recoveryTimestamp / 1000);

      // Webhook Payload - Recovery Notification (Green Banner #57F287)
      const embed = {
        title: '✅ Discord API Systems Recovered',
        description: `The **Discord API** has fully recovered and is back to **Operational** status.`,
        color: 0x57F287, // Green
        fields: [
          {
            name: 'Total Outage Duration',
            value: `**${formattedDuration}**`,
            inline: false
          },
          {
            name: 'Outage Began',
            value: `<t:${unixDown}:F>`,
            inline: true
          },
          {
            name: 'Recovery Time',
            value: `<t:${unixUp}:F>`,
            inline: true
          }
        ],
        footer: {
          text: 'Status Shark • Discord API Monitoring Service'
        },
        timestamp: new Date(recoveryTimestamp).toISOString()
      };

      await sendWebhookPayload(embed);
    }

    // CASE 3: Operational & No Change OR Still Down & No Change -> Do nothing (Deduplicated)

  } catch (error) {
    console.error('[Status Shark] Error querying Discord Statuspage API:', error.message);
  }
}

/**
 * Start Cron/Worker Service
 */
function startMonitoring(initialState) {
  const store = new StatusStateStore(initialState);

  console.log(`[Status Shark] Service started. Checking every ${CONFIG.CHECK_INTERVAL_MS / 1000}s...`);

  // Execute immediately on boot
  checkDiscordStatus(store);

  // Interval execution
  const intervalId = setInterval(() => {
    checkDiscordStatus(store);
  }, CONFIG.CHECK_INTERVAL_MS);

  return { store, intervalId };
}

// Module Exports
module.exports = {
  checkDiscordStatus,
  StatusStateStore,
  formatDuration,
  startMonitoring,
  CONFIG
};

// Standalone runner when executed directly (`node discordStatusShark.js`)
if (require.main === module) {
  startMonitoring();
}
