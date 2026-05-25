require('dotenv').config();
const { getBuiltInResponse } = require('./src/utils/builtInBrain.js');
const { searchWeb } = require('./src/utils/searchEngine.js');

async function test() {
    try {
        console.log("Testing searchWeb...");
        const s = await searchWeb("What is a black hole?");
        console.log("Search result:", s);
        
        console.log("Testing builtInBrain...");
        const b = await getBuiltInResponse("What is a black hole?", "No context");
        console.log("Built-in result:", b);
    } catch(e) {
        console.error("Error:", e);
    }
}
test();
