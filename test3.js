require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function test(modelName, tools) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
        model: modelName,
        tools: tools
    });
    try {
        const result = await model.generateContent("Who won the super bowl 2024?");
        console.log("Success with", modelName);
    } catch(e) {
        console.log("Failed with", modelName, e.message);
    }
}

async function run() {
    await test('gemini-1.5-flash-latest');
    await test('gemini-1.5-pro');
    await test('gemini-2.0-flash');
    await test('gemini-1.5-flash-8b');
    await test('gemini-2.0-flash', [{ googleSearch: {} }]);
}
run();
