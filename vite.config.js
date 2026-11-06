import { defineConfig, loadEnv } from 'vite';

// Hardcoded cheapest Gemini Flash-Lite models in the backend (matching api/gemini.js)
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

function geminiApiPlugin(env) {
  return {
    name: 'gemini-api-middleware',
    configureServer(server) {
      server.middlewares.use('/api/gemini', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            const { task, payload } = JSON.parse(body || '{}');
            const apiKey = env.GEMINI_API_KEY;
            if (!apiKey) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'GEMINI_API_KEY not set in .env.local' }));
              return;
            }
            if (!payload) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing payload' }));
              return;
            }

            const modalities = payload?.generationConfig?.responseModalities || [];
            const isImageTask =
              task === 'image' ||
              (Array.isArray(modalities) && modalities.includes('IMAGE'));
            const candidateModels = isImageTask ? BACKEND_IMAGE_MODELS : BACKEND_TEXT_MODELS;

            let lastStatus = 502;
            let lastText = JSON.stringify({ error: 'Failed to reach Gemini API' });

            for (const modelName of candidateModels) {
              const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
              const upstream = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });

              const text = await upstream.text();
              if (upstream.ok) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('X-Gemini-Model', modelName);
                res.end(text);
                return;
              }
              lastStatus = upstream.status;
              lastText = text;
            }

            res.statusCode = lastStatus;
            res.setHeader('Content-Type', 'application/json');
            res.end(lastText);
          } catch (err) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: String(err.message || err) }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [geminiApiPlugin(env)],
    server: {
      port: 5185,
      host: '0.0.0.0',
      allowedHosts: true,
      open: false,
    },
    build: {
      outDir: 'dist',
    },
  };
});
