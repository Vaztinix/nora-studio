require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function test() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await response.json();
        const names = data.models.map(m => m.name);
        console.log("AVAILABLE MODELS:", names.join(', '));
    } catch(e) {
        console.log(e.message);
    }
}
test();
