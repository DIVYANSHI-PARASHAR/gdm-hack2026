import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Request, Response } from 'express';
import { isConfiguredSecret, loadDotEnv } from './env';
import {
  decideNextBossStrategy,
  sanitizeExchangeSummary,
} from './geminiDecisions';
import {
  clearHealthSession,
  createOAuthAuthorizationUrl,
  fetchSyncedMatchCalories,
  handleOAuthCallback,
  hasConnectedHealthSession,
  isGoogleHealthConfigured,
} from './googleHealth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

loadDotEnv(ROOT_DIR);

const SESSION_COOKIE_NAME = 'ip_health_sid';

function ensureMediaPipeWasmCopied(): void {
  const srcDir = path.join(
    ROOT_DIR,
    'node_modules',
    '@mediapipe',
    'tasks-vision',
    'wasm'
  );
  const destDir = path.join(ROOT_DIR, 'public', 'mediapipe', 'wasm');
  if (!fs.existsSync(srcDir)) return;
  if (fs.existsSync(path.join(destDir, 'vision_wasm_internal.wasm'))) return;

  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

function getOrSetSessionCookie(req: Request, res: Response): string {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[SESSION_COOKIE_NAME];
  if (existing && /^[a-f0-9]{32,64}$/.test(existing)) {
    return existing;
  }
  const sid = crypto.randomBytes(24).toString('hex');
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
  );
  return sid;
}

export function createApiApp(port: number = 5173): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/config', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[SESSION_COOKIE_NAME];
    res.json({
      geminiConfigured: isConfiguredSecret(process.env.GEMINI_API_KEY),
      googleHealthConfigured: isGoogleHealthConfigured(),
      googleHealthConnected: hasConnectedHealthSession(sid),
    });
  });

  app.post('/api/boss/strategy', async (req, res) => {
    const summary = sanitizeExchangeSummary(
      req.body as Record<string, unknown> | undefined
    );
    if (!summary) {
      res.status(400).json({ error: 'Invalid gameplay summary payload.' });
      return;
    }

    const decision = await decideNextBossStrategy(summary);
    res.json(decision);
  });

  app.get('/api/health/status', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[SESSION_COOKIE_NAME];
    res.json({
      configured: isGoogleHealthConfigured(),
      connected: hasConnectedHealthSession(sid),
    });
  });

  app.get('/api/health/oauth/start', (req, res) => {
    if (!isGoogleHealthConfigured()) {
      res
        .status(503)
        .send(
          'Google Health OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.'
        );
      return;
    }
    const sid = getOrSetSessionCookie(req, res);
    const authUrl = createOAuthAuthorizationUrl(sid, port);
    if (!authUrl) {
      res.status(503).send('Unable to create OAuth URL.');
      return;
    }
    res.redirect(authUrl);
  });

  app.get('/api/health/oauth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthErr = typeof req.query.error === 'string' ? req.query.error : '';

    if (oauthErr || !code || !state) {
      res.status(400).send(renderPopupResultHtml(false, oauthErr || 'OAuth canceled.'));
      return;
    }

    const result = await handleOAuthCallback(code, state, port);
    res
      .status(result.ok ? 200 : 400)
      .send(
        renderPopupResultHtml(
          result.ok,
          result.ok
            ? 'Google Health connected! Returning to match results...'
            : result.errorMessage || 'OAuth failed.'
        )
      );
  });

  app.post('/api/health/oauth/disconnect', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    clearHealthSession(cookies[SESSION_COOKIE_NAME]);
    res.json({ ok: true });
  });

  app.post('/api/health/match-calories', async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[SESSION_COOKIE_NAME];
    const body = (req.body ?? {}) as {
      matchStartTimeMs?: unknown;
      matchEndTimeMs?: unknown;
    };
    const startMs = Number(body.matchStartTimeMs);
    const endMs = Number(body.matchEndTimeMs);

    const response = await fetchSyncedMatchCalories(sid, startMs, endMs);
    res.json(response);
  });

  return app;
}

function renderPopupResultHtml(ok: boolean, message: string): string {
  const safeMsg = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Google Health Connection</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #070b16; color: #e2e8f0; display: grid; place-items: center; height: 100vh; margin: 0; }
    .card { background: #111827; border: 1px solid ${ok ? '#00f0ff' : '#ff4d6d'}; padding: 24px 32px; border-radius: 12px; text-align: center; max-width: 420px; }
    button { margin-top: 16px; background: #00f0ff; color: #050811; border: none; padding: 8px 18px; border-radius: 6px; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${ok ? 'Google Health Connected' : 'Connection Issue'}</h2>
    <p>${safeMsg}</p>
    <button onclick="window.close()">Close Window</button>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'GOOGLE_HEALTH_OAUTH_COMPLETE', ok: ${ok} }, window.location.origin);
      setTimeout(() => window.close(), 900);
    }
  </script>
</body>
</html>`;
}

async function startServer(): Promise<void> {
  ensureMediaPipeWasmCopied();
  const port = Number(process.env.PORT) || 5173;
  const app = createApiApp(port);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: ROOT_DIR,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, () => {
    console.log(`\n  IRON PULSE // Neon Boxing Arena running at:`);
    console.log(`  -> http://localhost:${port}`);
    console.log(
      `  -> Gemini Decisions API (gemini-decision-1): ${
        isConfiguredSecret(process.env.GEMINI_API_KEY)
          ? 'Configured'
          : 'Local deterministic AI fallback (no GEMINI_API_KEY)'
      }`
    );
    console.log(
      `  -> Google Health OAuth (total-calories):     ${
        isGoogleHealthConfigured()
          ? 'Configured'
          : 'Optional / unconfigured (add GOOGLE_CLIENT_ID to .env)'
      }\n`
    );
  });
}

// Run when executed directly
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void startServer();
}
