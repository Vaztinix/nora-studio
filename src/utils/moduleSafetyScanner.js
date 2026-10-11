const { GoogleGenerativeAI } = require('@google/generative-ai');
const geminiKeyManager = require('./geminiKeyManager');

/**
 * 🛡️ Module Safety Scanner using Gemini AI + Heuristic Heuristics
 * Scans community JavaScript modules submitted via IDTK for:
 * - Malicious token grabbers / environment exfiltration
 * - Arbitrary remote code execution (eval, new Function, child_process)
 * - Inappropriate content, hate speech, or abuse
 * - Discord TOS violations or unauthorized destructive operations
 */

const STATIC_DISALLOWED_PATTERNS = [
    { pattern: /process\.env\.(DISCORD_TOKEN|BOT_TOKEN|TOKEN|API_KEY|GEMINI_API_KEY)/i, reason: 'Attempting to access sensitive environment tokens or secrets' },
    { pattern: /client\.token/i, reason: 'Attempting to access Discord bot token directly' },
    { pattern: /child_process/i, reason: 'Executing unauthorized system sub-processes' },
    { pattern: /require\s*\(\s*['"]fs['"]\s*\)/i, reason: 'Unauthorized direct filesystem access' },
    { pattern: /(http:\/\/|https:\/\/)[a-zA-Z0-9.-]+\/api\/webhooks\//i, reason: 'Hardcoded external webhook URLs detected' },
    { pattern: /eval\s*\(/i, reason: 'Use of dangerous eval() construct' }
];

async function runStaticHeuristicScan(code) {
    const issues = [];
    for (const rule of STATIC_DISALLOWED_PATTERNS) {
        if (rule.pattern.test(code)) {
            issues.push(rule.reason);
        }
    }
    return issues;
}

async function scanModuleSafetyWithGemini(code, metadata = {}) {
    const staticIssues = await runStaticHeuristicScan(code);
    
    // Attempt Gemini AI deep analysis
    const keys = geminiKeyManager.getRotatedAvailableKeys();
    let geminiReport = null;

    if (keys.length > 0) {
        for (const key of keys) {
            try {
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({
                    model: 'gemini-2.5-flash',
                    generationConfig: {
                        temperature: 0.1,
                        responseMimeType: 'application/json'
                    }
                });

                const prompt = `You are the lead security auditor for Nora Discord Bot's Internal Developer Toolkit (IDTK).
Inspect the following community JavaScript module submitted for the Server Module Hub.

Module Name: "${metadata.name || 'Untitled'}"
Category: "${metadata.category || 'Utility'}"
Description: "${metadata.description || 'None'}"

Target JavaScript Code:
\`\`\`javascript
${code}
\`\`\`

Strictly analyze the code for:
1. Malicious intents (stealing bot tokens, exfiltrating data, accessing process.env, token grabbers).
2. Remote exploit vectors (dangerous eval, unauthorized network tunneling, disguised payloads).
3. Inappropriate content (profanity, hate speech, harassment, malware distribution).
4. System stability risks (infinite loops, memory leaks, crash exploits).

Respond ONLY with valid JSON matching this exact structure:
{
    "isSafe": boolean,
    "verdict": "SAFE" | "CAUTION" | "UNSAFE",
    "safetyScore": number (0 to 100),
    "flaggedIssues": ["array of issue strings, empty if safe"],
    "summary": "Concise 1-2 sentence security review summary",
    "recommendation": "APPROVE" | "NEEDS_REVIEW" | "REJECT"
}`;

                const result = await model.generateContent(prompt);
                const responseText = result.response.text();
                geminiKeyManager.reportSuccess(key, responseText);
                
                try {
                    geminiReport = JSON.parse(responseText.trim());
                    break;
                } catch (pe) {
                    console.warn('[SafetyScanner] Failed to parse Gemini JSON response:', pe.message);
                }
            } catch (err) {
                console.warn(`[SafetyScanner] Gemini key failed: ${err.message}`);
                geminiKeyManager.reportQuotaLimit(key, err);
            }
        }
    }

    // Combine static heuristics and Gemini AI findings
    const allIssues = new Set(staticIssues);
    let finalScore = 100;
    let finalVerdict = 'SAFE';
    let summary = 'Automated security scan completed with no critical vulnerabilities detected.';

    if (geminiReport) {
        if (Array.isArray(geminiReport.flaggedIssues)) {
            geminiReport.flaggedIssues.forEach(iss => allIssues.add(iss));
        }
        finalScore = typeof geminiReport.safetyScore === 'number' ? geminiReport.safetyScore : 90;
        finalVerdict = geminiReport.verdict || (allIssues.size > 0 ? 'CAUTION' : 'SAFE');
        if (geminiReport.summary) summary = geminiReport.summary;
    } else {
        // Fallback when Gemini is unavailable
        if (staticIssues.length > 0) {
            finalScore = Math.max(20, 100 - staticIssues.length * 30);
            finalVerdict = finalScore < 60 ? 'UNSAFE' : 'CAUTION';
            summary = `Static heuristic scanner identified ${staticIssues.length} potential security concerns.`;
        }
    }

    if (staticIssues.length > 0 && finalScore > 50) {
        finalScore = Math.min(finalScore, 40);
        finalVerdict = 'UNSAFE';
        summary = `Critical security rule violation detected in module code.`;
    }

    const isSafe = finalVerdict === 'SAFE' && allIssues.size === 0 && finalScore >= 80;

    return {
        isSafe,
        verdict: finalVerdict,
        safetyScore: finalScore,
        flaggedIssues: Array.from(allIssues),
        summary,
        auditTimestamp: new Date().toISOString()
    };
}

module.exports = {
    scanModuleSafetyWithGemini,
    runStaticHeuristicScan
};
