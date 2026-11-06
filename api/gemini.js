const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Hardcoded cheapest Gemini Flash-Lite models in the backend (with automatic fallback chain)
const BACKEND_TEXT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
];

const BACKEND_IMAGE_MODELS = [
  'gemini-3.1-flash-lite-image',
  'gemini-2.5-flash-image',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server API key not configured' });
  }

  let bodyObj = req.body;
  if (typeof bodyObj === 'string') {
    try {
      bodyObj = JSON.parse(bodyObj);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON request body' });
    }
  }

  const { task, payload } = bodyObj || {};
  if (!payload) {
    return res.status(400).json({ error: 'Missing payload in request body' });
  }

  // Always enforce the backend's hardcoded cheapest Gemini Flash-Lite models
  const modalities = payload?.generationConfig?.responseModalities || [];
  const isImageTask =
    task === 'image' ||
    (Array.isArray(modalities) && modalities.includes('IMAGE'));

  const candidateModels = isImageTask ? BACKEND_IMAGE_MODELS : BACKEND_TEXT_MODELS;

  let lastStatus = 502;
  let lastBody = JSON.stringify({ error: 'Failed to reach Gemini API' });

  for (const modelName of candidateModels) {
    try {
      const geminiUrl = `${GEMINI_API_BASE}/${modelName}:generateContent?key=${apiKey}`;
      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await geminiRes.text();
      if (geminiRes.ok) {
        return res
          .status(200)
          .setHeader('Content-Type', 'application/json')
          .setHeader('X-Gemini-Model', modelName)
          .send(data);
      }

      lastStatus = geminiRes.status;
      lastBody = data;
      console.warn(`Gemini model ${modelName} returned ${geminiRes.status}, trying fallback if available...`);
    } catch (err) {
      console.error(`Gemini proxy error for ${modelName}:`, err);
      lastStatus = 502;
      lastBody = JSON.stringify({ error: String(err.message || err) });
    }
  }

  return res
    .status(lastStatus)
    .setHeader('Content-Type', 'application/json')
    .send(lastBody);
}
