import { canSaveSceneSettings } from './scene-settings-api.js';

export const CONTACT_MESSAGES_PREFIX = 'contact-messages/';
export const MAX_CONTACT_BODY_BYTES = 16 * 1024;
export const CONTACT_PAGE_SIZE = 50;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  },
});

function readFields(value) {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id)
    || typeof value.email !== 'string') return null;
  const id = value.id.toLowerCase(), email = value.email.trim();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email)) return null;
  if (value.kind === 'callback') return { id, kind: 'callback', email };
  if (value.kind !== undefined || typeof value.name !== 'string' || typeof value.message !== 'string') return null;
  const name = value.name.trim(), message = value.message.trim();
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)
    || !message || message.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) return null;
  return { id, name, email, message };
}

async function readLimitedJson(request) {
  const length = request.headers.get('content-length');
  if (length !== null && Number(length) > MAX_CONTACT_BODY_BYTES) return { status: 413 };
  if (!request.body) return { status: 400 };
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CONTACT_BODY_BYTES) { await reader.cancel(); return { status: 413 }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch { return { status: 400 }; }
  finally { reader.releaseLock(); }
}

async function readInbox(request, bucket) {
  if (!bucket || typeof bucket.list !== 'function' || typeof bucket.get !== 'function') {
    return json({ error: 'The inbox is temporarily unavailable.' }, 503);
  }
  const cursor = new URL(request.url).searchParams.get('cursor');
  if (cursor !== null && (!cursor || cursor.length > 2048 || /[\u0000-\u001f\u007f]/.test(cursor))) {
    return json({ error: 'Invalid inbox page.' }, 400);
  }
  try {
    const page = await bucket.list({ prefix: CONTACT_MESSAGES_PREFIX, limit: CONTACT_PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    if (!isRecord(page) || !Array.isArray(page.objects) || page.objects.length > CONTACT_PAGE_SIZE
      || (page.truncated && (typeof page.cursor !== 'string' || !page.cursor))) throw new Error('Invalid storage page');
    const keys = page.objects.map(object => object?.key).filter(key => {
      if (typeof key !== 'string' || !key.startsWith(CONTACT_MESSAGES_PREFIX) || !key.endsWith('.json')) return false;
      return UUID.test(key.slice(CONTACT_MESSAGES_PREFIX.length, -5));
    });
    const messages = (await Promise.all(keys.map(async key => {
      const stored = await bucket.get(key);
      if (!stored) return null;
      const record = await stored.json(), fields = readFields(record);
      if (!fields || fields.id !== key.slice(CONTACT_MESSAGES_PREFIX.length, -5).toLowerCase()
        || typeof record.createdAt !== 'string' || record.createdAt.length > 64 || !Number.isFinite(Date.parse(record.createdAt))) {
        throw new Error('Invalid stored inquiry');
      }
      return { ...fields, createdAt: record.createdAt };
    }))).filter(Boolean);
    return json({ messages, ...(page.truncated ? { cursor: page.cursor } : {}) });
  } catch { return json({ error: 'The inbox is temporarily unavailable.' }, 503); }
}

/** Public same-origin intake; only the existing trusted site owner reads it. */
export async function handleContact(request, env = {}) {
  if (request.method === 'GET') {
    const canRead = canSaveSceneSettings(request, env);
    if (new URL(request.url).searchParams.get('inbox') !== '1') return json({ canRead });
    if (!canRead) return json({ error: 'The inbox is restricted to the site owner.' }, 403);
    return readInbox(request, env.BUCKET);
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, POST' });
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'A same-origin request is required.' }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return json({ error: 'A JSON request is required.' }, 415);
  const parsed = await readLimitedJson(request);
  if (parsed.status) return json({ error: parsed.status === 413 ? 'The inquiry is too large.' : 'Invalid contact details.' }, parsed.status);
  const fields = readFields(parsed.value);
  if (!fields || (parsed.value.website !== undefined && (typeof parsed.value.website !== 'string' || parsed.value.website.trim() !== ''))) {
    return json({ error: 'Invalid contact details.' }, 400);
  }
  const bucket = env.BUCKET;
  if (!bucket || typeof bucket.put !== 'function') return json({ error: 'Your inquiry could not be saved. Please try again.' }, 503);
  try {
    const stored = await bucket.put(`${CONTACT_MESSAGES_PREFIX}${fields.id}.json`, JSON.stringify({
      ...fields, createdAt: new Date().toISOString(),
    }), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    });
    if (stored === null) return json({ receipt: fields.id }, 200);
    if (typeof stored?.etag !== 'string' || !stored.etag) throw new Error('Unconfirmed storage write');
    return json({ receipt: fields.id }, 201);
  } catch { return json({ error: 'Your inquiry could not be saved. Please try again.' }, 503); }
}
