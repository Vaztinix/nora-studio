const fs = require('fs');

function checkScriptInHtml(filePath, label) {
    const html = fs.readFileSync(filePath, 'utf8');
    const scriptBlocks = html.split('<script');
    if (scriptBlocks.length < 4) {
        console.log(`[${label}] Could not find script block #3.`);
        return;
    }

    const block = scriptBlocks[3];
    const closingIdx = block.indexOf('</script>');
    const rawContent = closingIdx !== -1 ? block.substring(0, closingIdx) : block;
    const firstGt = rawContent.indexOf('>');
    const scriptContent = firstGt !== -1 ? rawContent.substring(firstGt + 1) : rawContent;

    try {
        new Function(scriptContent);
        console.log(`[${label}] Script #3 parsed successfully - no syntax errors!`);
    } catch (e) {
        console.log(`[${label}] SYNTAX ERROR in Script #3: ${e.message}`);
    }
}

checkScriptInHtml('src/web/dashboard.html', 'SRC');
checkScriptInHtml('dist/dashboard.html', 'DIST');
