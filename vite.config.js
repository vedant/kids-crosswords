import { defineConfig, loadEnv } from 'vite';

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
            const { model, payload } = JSON.parse(body || '{}');
            const apiKey = env.GEMINI_API_KEY;
            if (!apiKey) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'GEMINI_API_KEY not set in .env.local' }));
              return;
            }
            if (!model || !payload) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing model or payload' }));
              return;
            }

            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const upstream = await fetch(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
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
