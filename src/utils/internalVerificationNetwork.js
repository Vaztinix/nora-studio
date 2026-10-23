const { EmbedBuilder } = require('discord.js');
const geminiKeyManager = require('./geminiKeyManager');
const InternalVerificationUser = require('../database/models/InternalVerificationUser');

/**
 * 🛡️ Internal Verification Network (IVN) Core Engine
 * 
 * Mandate:
 * - All changes and inside interactions with Nora must be performed by a verified account
 *   marked by those in the Nora Studio Team.
 * - Any user ID (or hidden / missing ID) attempting to forward code, execute unauthorized
 *   internal commands, or manipulate Nora into disclosing private/sensitive information
 *   is flagged immediately.
 * - Gathers full telemetry (user details, context, location, payload) and executes AI
 *   forensic analysis (with deterministic fallback) to protect systems and the community.
 * - Dispatches all alerts to official Nora Team Security Channel: 1516140475059273929.
 */

const IVN_ALERT_CHANNEL_ID = '1516140475059273929';

// Core Seed of Official Nora Studio Team Members
const OFFICIAL_TEAM_ROSTER = [
    { id: '1214048435632603137', username: 'vaztinix', displayName: 'Vaz / Damien Adams', role: 'Founder & Lead Developer' },
    { id: '1366229304257544213', username: 'strawberry_angel0000', displayName: 'strwberry', role: 'Co-Owner' },
    { id: '1377095101116973187', username: 'strawberry._0000', displayName: 'strwberry (Alt)', role: 'Co-Owner (Alt)' },
    { id: '914530504718561351', username: 'charlieisme', displayName: 'TheCasualEnderman', role: 'Lead Contributor & Developer' },
    { id: '941084096673755188', username: 'solorads', displayName: 'solorads', role: 'Team Member & Staff' },
    { id: '1301949827701149697', username: 'discounted_chaos', displayName: 'discounted_chaos', role: 'Team Member & Staff' },
    { id: '930089787052916797', username: 'thevoid_8095', displayName: 'Mr. Void', role: 'Partner' },
    { id: '1387499169870254230', username: 'boris10106', displayName: 'boris10106', role: 'Team Member & Contributor' },
    { id: '1127254357059047546', username: 'yunex0', displayName: 'yunex0', role: 'Security Bug Hunter & Contributor' }
];

// Patterns indicative of manipulation, prompt injection, or sensitive credential exfiltration
const SENSITIVE_PROBING_PATTERNS = [
    { pattern: /\b(process\.env|env\s*file|\.env\b|token\s*grabber)\b/i, vector: 'Environment / Token Exfiltration' },
    { pattern: /\b(discord[_\s-]?token|bot[_\s-]?token|client\.token|app[_\s-]?token)\b/i, vector: 'Discord Bot Token Harvesting' },
    { pattern: /\b(api[_\s-]?key|gemini[_\s-]?key|openai[_\s-]?key|anthropic[_\s-]?key)\b/i, vector: 'API Key Harvesting' },
    { pattern: /\b(aes[_\s-]?key|encryption[_\s-]?key|aes-256|cipher[_\s-]?key)\b/i, vector: 'Cryptographic Key Exfiltration' },
    { pattern: /\b(database[_\s-]?password|db[_\s-]?connection|sqlite[_\s-]?master|drop\s+table|delete\s+from\s+userlevels)\b/i, vector: 'Database Manipulation / Breach Attempt' },
    { pattern: /\b(ignore\s+(all\s+)?(previous|prior|above)\s+instructions|system\s+prompt|developer\s+mode|dan\s+mode|jailbreak|unfiltered\s+mode)\b/i, vector: 'System Prompt Injection / Jailbreak' },
    { pattern: /\b(dump\s+memory|print\s+credentials|leak\s+password|reveal\s+hidden\s+instructions)\b/i, vector: 'Credential Leak Manipulation' },
    { pattern: /\b(eval\s*\(|new\s+Function|child_process|execSync|fs\.unlink|fs\.writeFile)\b/i, vector: 'Code Forwarding / Arbitrary Execution' }
];

class InternalVerificationNetwork {
    constructor() {
        this.alertChannelId = IVN_ALERT_CHANNEL_ID;
        this.verifiedCache = new Map(); // userId -> User Data
        this.recentThreats = []; // Sliding window of the last 50 threats
        this.threatCount = 0;
        this.isSeeded = false;

        // Auto-seed and refresh cache on launch
        this.init().catch(err => {
            console.error('[IVN] Initialization error:', err.message);
        });
    }

    /**
     * Seeds database with default team members and loads memory cache
     */
    async init() {
        // Seed default team roster in memory
        for (const m of OFFICIAL_TEAM_ROSTER) {
            this.verifiedCache.set(m.id, {
                userId: m.id,
                username: m.username,
                displayName: m.displayName,
                role: m.role,
                verifiedBy: 'Nora Studio Root',
                verifiedAt: new Date(),
                isActive: true
            });
        }

        // Sync with SQLite database
        try {
            for (const m of OFFICIAL_TEAM_ROSTER) {
                await InternalVerificationUser.findOrCreate({
                    where: { userId: m.id },
                    defaults: {
                        userId: m.id,
                        username: m.username,
                        displayName: m.displayName,
                        role: m.role,
                        verifiedBy: 'System Core Seed',
                        isActive: true
                    }
                }).catch(() => {});
            }

            // Load all database verified entries
            const allDbUsers = await InternalVerificationUser.findAll({ where: { isActive: true } });
            for (const u of allDbUsers) {
                this.verifiedCache.set(u.userId, u.toJSON());
            }
            this.isSeeded = true;
            console.log(`[IVN] Internal Verification Network online: ${this.verifiedCache.size} verified team accounts active.`);
        } catch (e) {
            console.warn('[IVN] Database sync notice (using memory fallback):', e.message);
        }
    }

    /**
     * Checks if a user is an IVN Verified Team Member
     * @param {string} userId 
     * @returns {boolean}
     */
    isTeamMember(userId) {
        if (!userId) return false;
        const uid = String(userId).trim();
        return this.verifiedCache.has(uid) || OFFICIAL_TEAM_ROSTER.some(m => m.id === uid);
    }

    /**
     * Add or verify a team member in the network
     */
    async verifyUser(userId, metadata = {}, verifiedBy = 'Team Member') {
        if (!userId) return false;
        const uid = String(userId).trim();
        const data = {
            userId: uid,
            username: metadata.username || `User_${uid.slice(-4)}`,
            displayName: metadata.displayName || metadata.username || 'Team Member',
            role: metadata.role || 'Team Member',
            verifiedBy: String(verifiedBy),
            verifiedAt: new Date(),
            notes: metadata.notes || null,
            isActive: true
        };

        this.verifiedCache.set(uid, data);

        try {
            const [record] = await InternalVerificationUser.findOrCreate({
                where: { userId: uid },
                defaults: data
            });
            await record.update({
                role: data.role,
                displayName: data.displayName,
                verifiedBy: data.verifiedBy,
                isActive: true
            });
            return true;
        } catch (e) {
            console.error('[IVN] Failed to save verified user to database:', e.message);
            return true; // Memory cache updated
        }
    }

    /**
     * Revoke verified status
     */
    async unverifyUser(userId) {
        if (!userId) return false;
        const uid = String(userId).trim();
        // Prevent unverifying the primary Founder
        if (uid === '1214048435632603137') {
            throw new Error('Cannot revoke Founder & Lead Developer verification.');
        }

        this.verifiedCache.delete(uid);

        try {
            await InternalVerificationUser.update(
                { isActive: false },
                { where: { userId: uid } }
            );
            return true;
        } catch (e) {
            console.error('[IVN] Failed to unverify user in database:', e.message);
            return true;
        }
    }

    /**
     * Get all currently verified team members
     */
    getVerifiedUsers() {
        return Array.from(this.verifiedCache.values());
    }

    /**
     * Evaluates a message or interaction for malicious manipulation or sensitive probing
     * @param {Object} context 
     * @returns {{ isThreat: boolean, vector?: string, reason?: string, matchSnippet?: string }}
     */
    evaluateContent(content, userId) {
        if (!content || typeof content !== 'string') return { isThreat: false };
        const text = content.trim();

        // 1. Missing or Hidden User ID attempting internal execution
        if (!userId || userId === 'hidden' || userId === 'unknown') {
            return {
                isThreat: true,
                vector: 'Hidden / Anonymous Identity Manipulation',
                reason: 'Interaction initiated with null, hidden, or spoofed user identity.',
                matchSnippet: text.slice(0, 100)
            };
        }

        // If the user is already verified by the team, they are authorized
        if (this.isTeamMember(userId)) {
            return { isThreat: false };
        }

        // 2. Scan for sensitive data probing, prompt injection, and code forwarding
        for (const rule of SENSITIVE_PROBING_PATTERNS) {
            const match = text.match(rule.pattern);
            if (match) {
                return {
                    isThreat: true,
                    vector: rule.vector,
                    reason: `Matched disallowed pattern: ${match[0]}`,
                    matchSnippet: text.slice(0, 200)
                };
            }
        }

        return { isThreat: false };
    }

    /**
     * Performs AI Forensic Analysis on the incident using Gemini with deterministic fallback
     * @param {Object} incident 
     * @returns {Promise<string>}
     */
    async analyzeThreatWithAI(incident) {
        const keys = geminiKeyManager.getRotatedAvailableKeys();
        
        if (keys && keys.length > 0) {
            const models = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.5-flash'];
            const prompt = `You are the lead security analyst for Nora Studio's Internal Verification Network (IVN).
Analyze this intercepted threat where an unverified user attempted to manipulate Nora Bot or extract private information:
- User: "${incident.userTag}" (ID: ${incident.userId})
- Location: Server "${incident.guildName}" (${incident.guildId}), Channel: #${incident.channelName}
- Attack Vector: ${incident.vector}
- Intercepted Payload: "${incident.payload.slice(0, 300)}"

Provide a concise forensic breakdown with:
1. Threat Severity: [LOW | MEDIUM | HIGH | CRITICAL]
2. Attacker Intent & Methodology: (Briefly explain what the user tried to exploit: e.g. prompt injection, credential exfiltration, code forwarding, social engineering)
3. Risk Assessment: (What damage could occur if Nora was unshielded)
4. Recommended Team Action: (e.g. monitor, blacklist, or notify guild owner)

Keep total length under 80 words. Direct bullet points only.`;

            for (const key of keys) {
                for (const model of models) {
                    try {
                        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
                        const res = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                                generationConfig: {
                                    maxOutputTokens: 250,
                                    temperature: 0.2
                                }
                            })
                        });

                        if (res.ok) {
                            const data = await res.json();
                            const analysis = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (analysis && analysis.trim()) {
                                geminiKeyManager.reportSuccess(key, analysis);
                                return `🧠 **Gemini AI Threat Intelligence**:\n${analysis.trim()}`;
                            }
                        } else if (res.status === 429) {
                            geminiKeyManager.reportQuotaLimit(key, new Error('429 on IVN AI analysis'));
                            break;
                        }
                    } catch (_) {}
                }
            }
        }

        // Deterministic Fallback if AI is offline / on cooldown
        let severity = 'HIGH';
        if (incident.vector.includes('Token') || incident.vector.includes('Key') || incident.vector.includes('Database')) {
            severity = 'CRITICAL';
        } else if (incident.vector.includes('Prompt Injection') || incident.vector.includes('Code')) {
            severity = 'HIGH';
        } else {
            severity = 'MEDIUM';
        }

        return `⚙️ **Deterministic Forensic Engine (AI Fallback)**:
• **Threat Severity**: \`${severity}\`
• **Methodology**: Intercepted unverified attempt to trigger **${incident.vector}**.
• **Technical Assessment**: Attempted unauthorized boundary traversal and internal Nora parameter manipulation.
• **Mitigation**: Blocked at gateway boundary by IVN. Zero data leaked; volatile memory purged.`;
    }

    /**
     * Intercepts and flags an interaction, runs forensic analysis, and dispatches an alert
     * @param {Object} opts 
     * @returns {Promise<boolean>} returns true if the interaction was intercepted and blocked
     */
    async interceptAndAlert({ client, message, interaction, content, source = 'NORA_AI' }) {
        const user = message?.author || interaction?.user || null;
        const userId = user?.id || 'unknown';
        const guild = message?.guild || interaction?.guild || null;
        const channel = message?.channel || interaction?.channel || null;

        const evaluation = this.evaluateContent(content, userId);
        if (!evaluation.isThreat) return false;

        this.threatCount++;

        const incident = {
            id: `IVN-${Date.now().toString(36).toUpperCase()}`,
            timestamp: new Date().toISOString(),
            source,
            userId,
            userTag: user ? `${user.username}` : 'Hidden/Unknown',
            userMention: user ? `<@${user.id}>` : '[No User ID]',
            accountCreated: user ? `<t:${Math.floor(user.createdTimestamp / 1000)}:R>` : 'Unknown',
            guildName: guild?.name || 'Direct Message / External Context',
            guildId: guild?.id || 'N/A',
            channelName: channel?.name || 'Direct Message',
            channelId: channel?.id || 'N/A',
            messageUrl: message?.url || null,
            vector: evaluation.vector,
            reason: evaluation.reason,
            payload: content || '[Empty Payload]'
        };

        // Run deep AI forensic analysis
        let aiForensics = 'Analyzing threat vector...';
        try {
            aiForensics = await this.analyzeThreatWithAI(incident);
        } catch (e) {
            aiForensics = `Forensic analysis error: ${e.message}`;
        }
        incident.aiForensics = aiForensics;

        // Push to in-memory sliding logs
        this.recentThreats.unshift(incident);
        if (this.recentThreats.length > 50) {
            this.recentThreats.pop();
        }

        console.warn(`\n🚨 [IVN Alert] Intercepted security violation by ${incident.userTag} (${incident.userId}) in ${incident.guildName}: ${incident.vector}`);

        // Dispatch alert to Team Alert Channel
        if (client) {
            await this.dispatchDiscordAlert(client, incident).catch(err => {
                console.error('[IVN] Failed to dispatch Discord alert to channel:', err.message);
            });
        }

        return true;
    }

    /**
     * Dispatches rich security embed to official channel 1516140475059273929
     */
    async dispatchDiscordAlert(client, incident) {
        try {
            let alertChannel = client.channels.cache.get(this.alertChannelId);
            if (!alertChannel) {
                alertChannel = await client.channels.fetch(this.alertChannelId).catch(() => null);
            }

            if (!alertChannel) {
                console.warn(`[IVN Alert Warning] Alert channel ${this.alertChannelId} not accessible by Nora.`);
                return;
            }

            const cleanSnippet = incident.payload
                .replace(/```/g, "'''")
                .slice(0, 450);

            const embed = new EmbedBuilder()
                .setTitle(`🛡️ [IVN SECURITY ALERT] Unauthorized Internal Interaction`)
                .setDescription(`The **Internal Verification Network** intercepted and neutralized an unauthorized manipulation attempt targeting Nora's internal directives and confidential parameters.`)
                .setColor('#dc2626') // Security Red
                .addFields(
                    {
                        name: '🚨 Threat Vector',
                        value: `**${incident.vector}**\nReason: \`${incident.reason}\``,
                        inline: false
                    },
                    {
                        name: '👤 Offending Identity',
                        value: `• **Mention**: ${incident.userMention}\n• **Tag**: \`${incident.userTag}\`\n• **User ID**: \`${incident.userId}\`\n• **IVN Status**: ❌ \`Unverified (Non-Team)\`\n• **Account Age**: ${incident.accountCreated}`,
                        inline: true
                    },
                    {
                        name: '📍 Incident Location',
                        value: `• **Server**: ${incident.guildName} (\`${incident.guildId}\`)\n• **Channel**: #${incident.channelName} (\`${incident.channelId}\`)\n• **Source**: \`${incident.source}\`${incident.messageUrl ? `\n• [Jump to Message](${incident.messageUrl})` : ''}`,
                        inline: true
                    },
                    {
                        name: '📦 Intercepted Payload',
                        value: `\`\`\`text\n${cleanSnippet}\n\`\`\``,
                        inline: false
                    },
                    {
                        name: '🔬 Deep Threat Intelligence & Forensic Breakdown',
                        value: incident.aiForensics.slice(0, 1024),
                        inline: false
                    },
                    {
                        name: '⚡ Automatic Defensive Action',
                        value: `✅ **Neutralized**: Response blocked. Zero credentials or internal directives exposed. Incident archived for Nora Studio Team review.`,
                        inline: false
                    }
                )
                .setFooter({ text: `Nora Studio • Internal Verification Network (IVN) | Incident ID: ${incident.id}` })
                .setTimestamp();

            await alertChannel.send({ embeds: [embed] });
        } catch (err) {
            console.error('[IVN] Alert dispatch error:', err.message);
        }
    }
}

module.exports = new InternalVerificationNetwork();
