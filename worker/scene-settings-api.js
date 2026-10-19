import { SCENE_CONTROL_GROUPS, getSceneControl, sanitizeSceneSettings } from '../src/scene-settings.js';
import { FERN_INSTANCES, FERN_INSTANCE_CONTROL_KEYS } from '../src/fern-instances.js';

export const SCENE_SETTINGS_KEY = 'scene-settings/published.json';
export const MAX_SETTINGS_BODY_BYTES = 16 * 1024;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isRevision = value => value === null || (typeof value === 'string' && value.length > 0 && value.length <= 256);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  },
});

export function canSaveSceneSettings(request, env) {
  const configured = typeof env.SCENE_EDITOR_EMAIL === 'string' ? env.SCENE_EDITOR_EMAIL.trim().toLowerCase() : '';
  const identity = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() || '';
  return configured.length > 0 && identity.length > 0 && identity === configured;
}

/** A write is a complete snapshot; unknown keys are removed by the shared sanitizer. */
export function validateSceneSettings(value) {
  if (!isRecord(value)) return false;
  const validGroups = SCENE_CONTROL_GROUPS.every(group => {
    const values = value[group.id];
    if (!isRecord(values)) return false;
    return group.controls.every(control => {
      if (!Object.hasOwn(values, control.key)) return false;
      const candidate = values[control.key];
      if (control.type === 'color') return typeof candidate === 'string' && /^#[0-9a-f]{6}$/i.test(candidate);
      return typeof candidate === 'number' && Number.isFinite(candidate)
        && candidate >= control.min && candidate <= control.max;
    });
  });
  if (!validGroups || !Object.hasOwn(value.ferns, 'instances') || !isRecord(value.ferns.instances)) return false;
  const instances = value.ferns.instances;
  return FERN_INSTANCES.every(({ id }) => {
    if (!Object.hasOwn(instances, id) || !isRecord(instances[id])) return false;
    return FERN_INSTANCE_CONTROL_KEYS.every(key => {
      if (!Object.hasOwn(instances[id], key)) return false;
      const candidate = instances[id][key];
      const { min, max } = getSceneControl('ferns', key);
      return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= min && candidate <= max;
    });
  });
}

async function readLimitedJson(request) {
  const length = request.headers.get('content-length');
  if (length !== null && Number(length) > MAX_SETTINGS_BODY_BYTES) return { status: 413 };
  if (!request.body) return { status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SETTINGS_BODY_BYTES) {
        await reader.cancel();
        return { status: 413 };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return { status: 400 };
  } finally {
    reader.releaseLock();
  }
}

export async function handleSceneSettings(request, env = {}) {
  const canSave = canSaveSceneSettings(request, env);
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, PUT' });
  }
  // Identity is supplied by the Sites gateway, never by a client-side email field.
  if (request.method === 'PUT') {
    if (!canSave) return json({ error: 'Saving is restricted to the site owner.' }, 403);
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      return json({ error: 'A same-origin request is required.' }, 403);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
      return json({ error: 'A JSON request is required.' }, 415);
    }
  }
  const bucket = env.BUCKET;
  if (!bucket || typeof bucket.get !== 'function' || typeof bucket.put !== 'function') {
    return json({ error: 'Shared settings storage is unavailable.', canSave }, 503);
  }

  if (request.method === 'GET') {
    try {
      const stored = await bucket.get(SCENE_SETTINGS_KEY);
      if (!stored) return json({ settings: null, revision: null, canSave });
      const record = await stored.json();
      if (!isRecord(record) || !isRecord(record.settings) || !isRevision(stored.etag) || stored.etag === null) {
        return json({ error: 'Shared settings storage is unavailable.', canSave }, 503);
      }
      // Older snapshots gain defaults for newly introduced controls.
      return json({ settings: sanitizeSceneSettings(record.settings), revision: stored.etag, canSave });
    } catch {
      return json({ error: 'Shared settings storage is unavailable.', canSave }, 503);
    }
  }

  const parsed = await readLimitedJson(request);
  if (parsed.status) return json({ error: parsed.status === 413 ? 'Settings are too large.' : 'Invalid JSON.' }, parsed.status);
  const payload = parsed.value;
  if (!isRecord(payload) || !Object.hasOwn(payload, 'revision') || !isRevision(payload.revision)
    || !validateSceneSettings(payload.settings)) {
    return json({ error: 'A complete, valid settings snapshot and revision are required.' }, 400);
  }
  const settings = sanitizeSceneSettings(payload.settings);
  try {
    const stored = await bucket.put(SCENE_SETTINGS_KEY, JSON.stringify({
      settings,
      updatedAt: new Date().toISOString(),
    }), {
      onlyIf: payload.revision === null
        ? { etagDoesNotMatch: '*' }
        : { etagMatches: payload.revision },
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    });
    if (stored === null) return json({ error: 'Settings changed. Reload before saving.' }, 409);
    const revision = stored?.etag || (typeof bucket.head === 'function' ? (await bucket.head(SCENE_SETTINGS_KEY))?.etag : null);
    if (typeof revision !== 'string' || !revision) return json({ error: 'The saved revision could not be confirmed.' }, 503);
    return json({ settings, revision, canSave });
  } catch {
    return json({ error: 'Shared settings could not be saved.' }, 503);
  }
}
