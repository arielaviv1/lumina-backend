// server.js — Eye Health Analyzer backend
// Receives eye images from your app, sends to Claude API, returns analysis

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

// Initialize Claude client (API key comes from environment variable)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Eye Health Analyzer API is running' });
});

// Main analysis endpoint
app.post('/analyze-eye', async (req, res) => {
  try {
    const { image, mediaType } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    console.log(`Received image: ${mediaType}, ${Math.round(image.length / 1024)}KB base64`);

    // Call Claude API
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

    // Extract text from response
    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();

    console.log(`Claude responded: ${text.slice(0, 100)}...`);

    // Parse JSON response (with fallbacks for extra text)
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to find JSON inside the response
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

app.listen(PORT, () => {
  console.log(`✓ Eye Health API running on port ${PORT}`);
  console.log(`✓ POST eye images (base64) to /analyze-eye`);
});
