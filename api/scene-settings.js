import { createHash } from 'node:crypto';
import publishedSettings from '../src/published-scene-settings.json' with { type: 'json' };
import { sanitizeSceneSettings } from '../src/scene-settings.js';

const settings = sanitizeSceneSettings(publishedSettings);
const revision = createHash('sha256').update(JSON.stringify(settings)).digest('hex');

export default {
  fetch(request) {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (request.method !== 'GET') {
      // Sites gateway identity headers are not trusted on a public Vercel site.
      return Response.json({ error: 'The scene editor is currently hidden.' }, {
        status: request.method === 'PUT' ? 403 : 405, headers: { ...headers, Allow: 'GET' },
      });
    }
    return Response.json({ settings, revision, canSave: false }, { headers });
  },
};
