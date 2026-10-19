import { handleSceneSettings } from './scene-settings-api.js';
import { handleContact } from './contact-api.js';

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/scene-settings') return handleSceneSettings(request, env);
    if (pathname === '/api/contact') return handleContact(request, env);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not found.' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
