import { readJacketShipping } from '../src/shared/jacketShipping';
import type { Express } from 'express';
import { jacketVoiceSetup } from '../src/shared/jacketVoiceSetup';
import { isConfiguredSecret } from './env';
import { ShopMcp } from './shopMcp';

export function registerJacketShoppingRoutes(app: Express, shop = new ShopMcp()) {
  app.use('/api/jacket', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/jacket/products', async (req, res) => {
    const query = req.query.q;
    const size = req.query.size;
    if (query !== undefined && (typeof query !== 'string' || query.length > 240 || !query.trim())) {
      res.status(400).json({ error: 'Enter a jacket search up to 240 characters.' });
      return;
    }
    if (size !== undefined && (typeof size !== 'string' || size.length > 24 || !query)) {
      res.status(400).json({ error: 'Enter a valid jacket size.' });
      return;
    }
    try {
      res.json(await shop.discover(query, size));
    } catch {
      res.status(502).json({ error: 'Live Shop search is temporarily unavailable. Try again.' });
    }
  });

  app.post('/api/jacket/checkout', async (req, res) => {
    const { id, selected, key, shipping: suppliedShipping } = req.body ?? {};
    const shipping = readJacketShipping(suppliedShipping);
    if (!shipping) {
      res.status(400).json({ error: 'Enter your email and shipping address.' });
      return;
    }
    const validSelection = Array.isArray(selected) && selected.length <= 10 &&
      selected.every((choice) => choice && typeof choice.name === 'string' &&
        typeof choice.label === 'string' && choice.name.length <= 100 && choice.label.length <= 100);
    if (typeof id !== 'string' || !/^gid:\/\/shopify\/(?:p|Product)\/[\w-]+$/.test(id) ||
        !validSelection || typeof key !== 'string' ||
        !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(key)) {
      res.status(400).json({ error: 'Choose a jacket and its options first.' });
      return;
    }
    try {
      res.json(await shop.checkout(id, selected, key, shipping));
    } catch (error) {
      if (error instanceof RangeError) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(502).json({ error: 'Shop could not prepare checkout. Try again.' });
    }
  });

  app.post('/api/jacket/voice', async (req, res) => {
    if (req.get('Sec-Fetch-Site') === 'cross-site') {
      res.sendStatus(403);
      return;
    }
    const key = process.env.GEMINI_API_KEY;
    if (!key || !isConfiguredSecret(key)) {
      res.status(503).json({ error: 'Gemini voice needs GEMINI_API_KEY. You can still shop below.' });
      return;
    }
    const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          uses: 1,
          newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
          expireTime: new Date(Date.now() + 10 * 60_000).toISOString(),
          bidiGenerateContentSetup: jacketVoiceSetup(model),
        }),
      });
      if (!response.ok) throw new Error('Token request failed.');
      const token = await response.json();
      if (typeof token.name !== 'string') throw new Error('Token missing.');
      res.json({ token: token.name, model });
    } catch {
      res.status(502).json({ error: 'Gemini voice is unavailable. You can still shop below.' });
    }
  });
}
