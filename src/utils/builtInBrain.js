const { GoogleGenerativeAI } = require('@google/generative-ai');

const getBuiltInResponse = async (promptText, context = '', imageAttachments = null) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return "My built-in brain is disconnected! (Missing Gemini API Key)";

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        
        const engineeredPrompt = `You are Nora Standard Core V10. You are running on the Built-In Google Gemini Engine. 
        Be concise, highly intelligent, and Discord-ready. DO NOT use emojis.
        
        ${context ? `### Deep Server Knowledge:\n${context}` : ''}
        
        User message: "${promptText || 'Analyze the context/image.'}"`;

        const parts = [engineeredPrompt];

        if (imageAttachments && imageAttachments.size > 0) {
            for (const [id, attachment] of imageAttachments) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s safety timeout

                    const res = await fetch(attachment.url, { signal: controller.signal });
                    clearTimeout(timeoutId);

                    const arrayBuffer = await res.arrayBuffer();
                    parts.push({
                        inlineData: {
                            data: Buffer.from(arrayBuffer).toString('base64'),
                            mimeType: attachment.contentType
                        }
                    });
                } catch (e) {
                    console.error('[System AI] Image fetch timeout or fault:', e.message);
                }
            }
        }

        const result = await model.generateContent(parts);
        const text = result.response.text();
        return text.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');
    } catch (error) {
        console.error('Built-in AI Error:', error);
        return "I'm having trouble accessing my built-in multimodal visual engine.";
    }
};

module.exports = { getBuiltInResponse };
