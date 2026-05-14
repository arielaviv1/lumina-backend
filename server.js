// server.js — Lumina backend
// Receives eye images + vitals, sends to Claude API, returns analysis
 
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
 
const app = express();
const PORT = process.env.PORT || 3000;
 
// Configure CORS explicitly — allow any origin, all methods, all headers
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));
 
// Handle preflight requests for all routes
app.options('*', cors());
 
// Allow large image uploads (up to 10MB)
app.use(express.json({ limit: '10mb' }));
 
// Initialize Claude client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
 
// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Lumina API is running' });
});
 
// ========== ENDPOINT 1: Analyze eye image ==========
app.post('/analyze-eye', async (req, res) => {
  try {
    const { image, mediaType } = req.body;
 
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }
 
    console.log(`Received image: ${mediaType}, ${Math.round(image.length / 1024)}KB base64`);
 
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType || 'image/jpeg',
              data: image,
            },
          },
          {
            type: 'text',
            text: `You are a visual screening assistant. Analyze this eye image and assess visible signs of:
1. Anemia (pale conjunctiva)
2. Jaundice (yellow sclera)
3. Hypertension (vessel patterns, redness)
4. Conjunctivitis (redness, inflammation, discharge)
5. Dry eye (irritation, tear film irregularities, redness)
6. Fatigue (under-eye darkness, puffiness, tired appearance)
7. Allergies (watery, itchy-looking, swollen lids)
8. Arcus senilis (grayish-white ring around iris — cholesterol marker)
 
Respond with ONLY a valid JSON object in this exact format (no markdown, no extra text):
{
  "is_eye_image": true,
  "image_quality": "good",
  "anemia": {"risk": "low", "confidence": 80, "finding": "observation"},
  "jaundice": {"risk": "low", "confidence": 85, "finding": "observation"},
  "hypertension": {"risk": "low", "confidence": 75, "finding": "observation"},
  "infection": {"risk": "low", "confidence": 90, "finding": "observation"},
  "dryeye": {"risk": "low", "confidence": 80, "finding": "observation"},
  "fatigue": {"risk": "low", "confidence": 75, "finding": "observation"},
  "allergies": {"risk": "low", "confidence": 80, "finding": "observation"},
  "arcus": {"risk": "low", "confidence": 85, "finding": "observation"},
  "overall": "summary in one sentence"
}
 
Use "low", "medium", or "high" for risk. If not an eye image, set is_eye_image to false.`,
          },
        ],
      }],
    });
 
    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();
 
    console.log(`Claude responded: ${text.slice(0, 100)}...`);
 
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end > start) {
        parsed = JSON.parse(text.slice(start, end + 1));
      } else {
        throw new Error(`Could not parse Claude response: ${text}`);
      }
    }
 
    res.json({ success: true, results: parsed });
 
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Analysis failed',
    });
  }
});
 
// ========== ENDPOINT 2: Synthesize all measurements ==========
app.post('/synthesize', async (req, res) => {
  try {
    const { eyeResults, heartRate, pupilResult, eyelidResult, colorResult } = req.body;
 
    if (!eyeResults) {
      return res.status(400).json({ error: 'Need eyeResults' });
    }
 
    console.log(`Synthesizing: HR=${heartRate}, pupil=${!!pupilResult}, eyelid=${!!eyelidResult}, color=${!!colorResult}`);
 
    // Build eye findings summary
    const indicators = ['anemia', 'jaundice', 'hypertension', 'infection',
                        'dryeye', 'fatigue', 'allergies', 'arcus'];
    const eyeFindings = indicators
      .filter(k => eyeResults[k])
      .map(k => `- ${k}: risk=${eyeResults[k].risk}, confidence=${eyeResults[k].confidence}%, finding="${eyeResults[k].finding}"`)
      .join('\n');
 
    // Build vitals summary (only what was measured)
    let vitalsSummary = '';
    if (typeof heartRate === 'number') {
      let hrZone = 'normal range (60-100 BPM)';
      if (heartRate < 60) hrZone = 'low (bradycardia)';
      else if (heartRate > 100) hrZone = 'elevated (tachycardia)';
      vitalsSummary += `\n- Heart rate: ${heartRate} BPM (${hrZone})`;
    }
    if (pupilResult) {
      vitalsSummary += `\n- Pupil response: ${pupilResult.zone} (${pupilResult.responseTimeMs}ms reaction time)`;
    }
    if (eyelidResult) {
      vitalsSummary += `\n- Lower eyelid pallor index: ${eyelidResult.pallorIndex}/100 (${eyelidResult.zone})`;
    }
    if (colorResult) {
      vitalsSummary += `\n- Color vision test: ${colorResult.correct}/${colorResult.total} (${colorResult.zone})`;
    }
 
    if (!vitalsSummary) {
      vitalsSummary = '\n(No vitals were measured this session)';
    }
 
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `You are a wellness screening assistant. A user just completed a Lumina screening:
 
EYE SCAN FINDINGS:
${eyeFindings}
 
Eye summary: "${eyeResults.overall}"
 
MEASURED VITALS:${vitalsSummary}
 
TASK: Write a single combined wellness insight (2-3 sentences) that:
1. Synthesizes the visual eye findings AND any measured vitals together
2. Notes patterns where vitals reinforce or contradict eye signals (e.g., visible anemia signs + low pallor index = stronger signal)
3. Suggests ONE most useful next step if appropriate
4. Stays warm, calm, non-alarming. Wellness-framed, not diagnostic.
 
Respond with ONLY a valid JSON object (no markdown):
{
  "synthesis": "your 2-3 sentence combined insight",
  "next_step": "one short suggested next step, or empty string if everything looks fine",
  "overall_risk": "low"
}
 
Use "low", "medium", or "high" for overall_risk.`,
        }],
      }],
    });
 
    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();
 
    console.log(`Synthesis: ${text.slice(0, 100)}...`);
 
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end > start) {
        parsed = JSON.parse(text.slice(start, end + 1));
      } else {
        throw new Error(`Could not parse Claude response: ${text}`);
      }
    }
 
    res.json({ success: true, synthesis: parsed });
 
  } catch (error) {
    console.error('Synthesis error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Synthesis failed',
    });
  }
});
 
app.listen(PORT, () => {
  console.log(`✓ Lumina API running on port ${PORT}`);
  console.log(`✓ POST /analyze-eye for eye image analysis`);
  console.log(`✓ POST /synthesize for combined eye + HR insight`);
});
