require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function test(tools) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        tools: tools
    });
    try {
        const result = await model.generateContent("Who won the super bowl 2024?");
        console.log("Success with tools:", JSON.stringify(tools));
    } catch(e) {
        console.log("Failed with tools:", JSON.stringify(tools), e.message);
    }
}

async function run() {
    await test([{ googleSearch: {} }]);
    await test([{ googleSearchRetrieval: { dynamicRetrievalConfig: { mode: 'MODE_DYNAMIC', dynamicThreshold: 0.3 } } }]);
    await test([{ googleSearchRetrieval: {} }]);
    await test(undefined);
}
run();
