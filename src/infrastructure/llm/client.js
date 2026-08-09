// FILE: src/services/llmAPI.js
const MODELS = ['gemini-3.5-flash', 'deepseek-v4-flash', 'mimo-v2.5'];

export const getRandomModel = () => MODELS[Math.floor(Math.random() * MODELS.length)];

export const callAI = async (model, systemPrompt, userPrompt, requiresJson = true) => {
    try {
        // Lấy key an toàn cho cả môi trường Node.js và Vite
        const getEnv = (key) => (typeof process !== 'undefined' ? (process.env[key] || process.env[`VITE_${key}`]) : import.meta.env[`VITE_${key}`]);

        if (model === 'gemini-3.5-flash') {
            const apiKey = getEnv('GEMINI_API_KEY');
            if (!apiKey) throw new Error("Thiếu GEMINI_API_KEY");
            
            const bodyPayload = { 
                contents: [{ role: 'user', parts: [{ text: `[HƯỚNG DẪN HỆ THỐNG]: ${systemPrompt}\n\n[DỮ LIỆU ĐẦU VÀO]: ${userPrompt}` }] }] 
            };
            if (requiresJson) bodyPayload.generationConfig = { responseMimeType: "application/json" };

            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyPayload)
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.candidates[0].content.parts[0].text;
        }

        if (model === 'deepseek-v4-flash') {
            const apiKey = getEnv('DEEPSEEK_API_KEY');
            if (!apiKey) throw new Error("Thiếu DEEPSEEK_API_KEY");
            
            const bodyPayload = {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt + (requiresJson ? " You MUST output valid JSON." : "") },
                    { role: 'user', content: userPrompt }
                ],
                stream: false,
                thinking: { type: "enabled" } 
            };
            if (requiresJson) bodyPayload.response_format = { type: 'json_object' };

            const res = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(bodyPayload)
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.choices[0].message.content;
        }

        if (model === 'mimo-v2.5') {
            const apiKey = getEnv('MIMO_API_KEY');
            if (!apiKey) throw new Error("Thiếu MIMO_API_KEY");
            
            const bodyPayload = {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt + (requiresJson ? " Return only JSON, no explanations." : "") },
                    { role: 'user', content: userPrompt }
                ],
                stream: false,
                thinking: { type: "enabled" } // BẢN VÁ: Bật Deep Thinking cho MiMo
            };
            if (requiresJson) bodyPayload.response_format = { type: 'json_object' };

            const res = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(bodyPayload)
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.choices[0].message.content;
        }
    } catch (error) {
        console.error('[LLM CLIENT]', error.message);
        throw error;
    }
};
