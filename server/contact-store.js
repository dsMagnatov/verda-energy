import { put, head } from '@vercel/blob';
import { CONTACT_MESSAGES_PREFIX } from '../worker/contact-api.js';

export function createContactStore({ write = put, stat = head } = {}) {
  return {
    async put(key, value) {
      if (!key.startsWith(CONTACT_MESSAGES_PREFIX) || !/^[\da-f-]+\.json$/.test(key.slice(CONTACT_MESSAGES_PREFIX.length))) {
        throw new Error('Invalid contact key');
      }
      try {
        const stored = await write(key, value, {
          access: 'private', addRandomSuffix: false, allowOverwrite: false,
          contentType: 'application/json',
        });
        return { etag: stored.etag || stored.pathname };
      } catch (error) {
        // A retried UUID is successful only when its first write exists.
        try { if ((await stat(key))?.pathname === key) return null; } catch { /* Retain the original write failure. */ }
        throw error;
      }
    },
  };
}
