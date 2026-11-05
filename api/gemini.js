const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server API key not configured' });
  }

  const { model, payload } = req.body || {};
  if (!model || !payload) {
    return res.status(400).json({ error: 'Missing model or payload in request body' });
  }

  try {
    const geminiUrl = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await geminiRes.text();
    res.status(geminiRes.status)
      .setHeader('Content-Type', 'application/json')
      .send(data);
  } catch (err) {
    console.error('Gemini proxy error:', err);
    res.status(502).json({ error: 'Failed to reach Gemini API' });
  }
}
