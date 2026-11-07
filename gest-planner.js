const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1. Generate Free Preview (Obfuscated / Partial output)
router.post('/api/public/generate-preview', async (req, res) => {
    try {
        const { type, className, subject, topic, term } = req.body;

        const systemInstruction = `You are an expert curriculum assistant strictly aligned with the Ugandan National Curriculum Development Centre (NCDC) secondary lower (Competency-Based Curriculum) and upper secondary standards. Return JSON only.`;

        const prompt = `Generate a NCDC-compliant ${type === 'lesson_plan' ? 'Lesson Plan' : 'Scheme of Work'} preview for:
        - Class: ${className}
        - Subject: ${subject}
        - Topic: ${topic}
        ${term ? `- Term: ${term}` : ''}

        Include:
        1. Topic & Sub-topic
        2. Competency / Key Learning Outcome
        3. Activity of Integration (for S1-S4) or Key Concepts (S5-S6)
        4. Brief outline of Step 1 and Step 2.

        Format JSON:
        {
          "topic": "",
          "competences": "",
          "activityOfIntegration": "",
          "previewSteps": ["Step 1 preview...", "Step 2 preview..."]
        }`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: 'application/json'
            }
        });

        const data = JSON.parse(response.text);
        res.json({ success: true, preview: data });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Preview generation failed.' });
    }
});

// 2. Initiate Mobile Money Payment Prompt (e.g. Flutterwave / Pesapal / MoMo API)
router.post('/api/public/initiate-payment', async (req, res) => {
    const { phoneNumber, network, docType, fullPromptDetails } = req.body;
    const ref = 'SEC-' + Date.now();

    // Store pending transaction
    // Trigger Mobile Money Push Notification (STK Push)
    /*
      Example Flutterwave payload:
      {
         tx_ref: ref,
         amount: "2000",
         currency: "UGX",
         network: network, // 'MTN' or 'AIRTEL'
         phone_number: phoneNumber,
         email: "guest@secondaryrecordsbox.com"
      }
    */

    res.json({
        success: true,
        reference: ref,
        message: `Prompt sent to ${phoneNumber}. Enter your ${network} Mobile Money PIN to authorize UGX 2,000.`
    });
});

// 3. Webhook / Callback to Unlock Full Download
router.post('/api/public/verify-payment', async (req, res) => {
    const { reference } = req.body;

    // Check DB status for reference. If completed, generate complete full document via Gemini API.
    res.json({
        success: true,
        unlocked: true,
        fullDocument: { /* Complete detailed NCDC Lesson Plan / Scheme */ }
    });
});

module.exports = router;