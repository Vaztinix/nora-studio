const fs = require('fs');
const srcHtml = fs.readFileSync('src/web/dashboard.html', 'utf8');

// Extract the main script block (Script #3, starts at line 3936)
const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
let match;
let idx = 0;
while ((match = scriptRegex.exec(srcHtml)) !== null) {
    idx++;
    if (idx === 3) break;
}

const scriptContent = match[1];
const scriptStartLine = srcHtml.substring(0, match.index).split('\n').length;

// Try to use acorn to parse the JavaScript
try {
    // Use Function constructor to check syntax
    new Function(scriptContent);
    console.log('Script #3 parsed successfully - no syntax errors!');
} catch (e) {
    console.log('SYNTAX ERROR in Script #3:');
    console.log('  Message: ' + e.message);
    
    // Try to find the line number from the error
    const lineMatch = e.message.match(/line (\d+)/i) || e.stack.match(/:(\d+):/);
    if (lineMatch) {
        const errorLine = parseInt(lineMatch[1]);
        const lines = scriptContent.split('\n');
        console.log('  Error at script line ' + errorLine + ' (dashboard.html line ' + (scriptStartLine + errorLine - 1) + ')');
        const start = Math.max(0, errorLine - 5);
        const end = Math.min(lines.length, errorLine + 5);
        for (let i = start; i < end; i++) {
            const marker = (i + 1 === errorLine) ? ' >>> ' : '     ';
            console.log(marker + (scriptStartLine + i) + ': ' + lines[i]);
        }
    }
}

// Also check the dist version
const distHtml = fs.readFileSync('dist/dashboard.html', 'utf8');
const distScriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
let distMatch;
let distIdx = 0;
while ((distMatch = distScriptRegex.exec(distHtml)) !== null) {
    distIdx++;
    if (distIdx === 3) break;
}

const distScriptContent = distMatch[1];
const distStartLine = distHtml.substring(0, distMatch.index).split('\n').length;

try {
    new Function(distScriptContent);
    console.log('\n[DIST] Script #3 parsed successfully - no syntax errors!');
} catch (e) {
    console.log('\n[DIST] SYNTAX ERROR in Script #3:');
    console.log('  Message: ' + e.message);
    
    const lineMatch = e.message.match(/line (\d+)/i) || e.stack.match(/<anonymous>:(\d+):/);
    if (lineMatch) {
        const errorLine = parseInt(lineMatch[1]);
        const lines = distScriptContent.split('\n');
        console.log('  Error at script line ' + errorLine + ' (dashboard.html line ~' + (distStartLine + errorLine - 1) + ')');
        const start = Math.max(0, errorLine - 3);
        const end = Math.min(lines.length, errorLine + 3);
        for (let i = start; i < end; i++) {
            const marker = (i + 1 === errorLine) ? ' >>> ' : '     ';
            console.log(marker + (distStartLine + i) + ': ' + lines[i]);
        }
    }
}
