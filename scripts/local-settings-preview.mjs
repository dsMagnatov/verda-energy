import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { handleSceneSettings, SCENE_SETTINGS_KEY } from '../worker/scene-settings-api.js';
import { handleContact, CONTACT_MESSAGES_PREFIX } from '../worker/contact-api.js';
import { sanitizeSceneSettings } from '../src/scene-settings.js';

const inquiryFile = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.json$/;

// Loopback-only preview adapter. No production credentials or identities enter
// the browser bundle; production uses the hosted R2 binding and Sites identity.
export function createLocalPreviewBucket(directory = resolve('.sites-runtime'), { initialSettings } = {}) {
  const initialData = initialSettings ? JSON.stringify({ settings: sanitizeSceneSettings(initialSettings) }) : null;
  const initialRecord = initialData ? {
    etag: createHash('sha256').update(initialData).digest('hex'), data: initialData,
  } : null;
  const fileFor = key => {
    if (key === SCENE_SETTINGS_KEY) return resolve(directory, 'shared-scene-preview.json');
    if (typeof key === 'string' && key.startsWith(CONTACT_MESSAGES_PREFIX)) {
      const filename = key.slice(CONTACT_MESSAGES_PREFIX.length);
      if (inquiryFile.test(filename)) return resolve(directory, 'contact-messages', filename);
    }
    throw new Error('Unsupported preview storage key');
  };
  let queue = Promise.resolve();
  const read = async key => {
    try { return JSON.parse(await readFile(fileFor(key), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return key === SCENE_SETTINGS_KEY ? initialRecord : null;
      throw error;
    }
  };
  return {
    async get(key) {
      const record = await read(key);
      return record ? { etag: record.etag, text: async () => record.data, json: async () => JSON.parse(record.data) } : null;
    },
    async head(key) {
      const record = await read(key);
      return record ? { etag: record.etag } : null;
    },
    async put(key, data, options = {}) {
      const operation = async () => {
        const file = fileFor(key);
        const current = await read(key);
        const condition = options.onlyIf ?? {};
        if (condition.etagMatches && current?.etag !== condition.etagMatches) return null;
        if (condition.etagDoesNotMatch === '*' && current) return null;
        const record = { etag: randomUUID(), data: String(data) };
        await mkdir(dirname(file), { recursive: true });
        const temp = resolve(dirname(file), `preset-${record.etag}.tmp`);
        try { await writeFile(temp, JSON.stringify(record)); await rename(temp, file); }
        finally { await unlink(temp).catch(() => {}); }
        return { etag: record.etag };
      };
      queue = queue.then(operation, operation);
      return queue;
    },
    async list({ prefix, limit = 50, cursor } = {}) {
      if (prefix !== CONTACT_MESSAGES_PREFIX) throw new Error('Unsupported preview list prefix');
      let after = '';
      if (cursor !== undefined) {
        if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) throw new Error('Invalid preview cursor');
        after = Buffer.from(cursor, 'base64url').toString('utf8');
        if (!inquiryFile.test(after)) throw new Error('Invalid preview cursor');
      }
      let files;
      try { files = await readdir(resolve(directory, 'contact-messages'), { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') files = []; else throw error; }
      const names = files.filter(file => file.isFile() && inquiryFile.test(file.name) && file.name > after).map(file => file.name).sort();
      const count = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 50;
      const page = names.slice(0, count), truncated = names.length > page.length;
      return { objects: page.map(name => ({ key: `${CONTACT_MESSAGES_PREFIX}${name}` })), truncated,
        ...(truncated ? { cursor: Buffer.from(page.at(-1)).toString('base64url') } : {}) };
    },
  };
}

export function localSettingsPreview({ initialSettings } = {}) {
  // A fresh checkout starts with the published appearance. Explicit local
  // edits still take precedence and stay independent of production storage.
  const bucket = createLocalPreviewBucket(undefined, { initialSettings });
  return {
    name: 'local-shared-scene-preview',
    configureServer(server) {
      server.middlewares.use(async (incoming, outgoing, next) => {
        const pathname = incoming.url?.split('?')[0];
        if (pathname !== '/api/scene-settings' && pathname !== '/api/contact') return next();
        try {
          const authority = new URL(`http://${incoming.headers.host}`);
          if (!['localhost', '127.0.0.1', '[::1]'].includes(authority.hostname)
            || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(incoming.socket.remoteAddress)) {
            outgoing.writeHead(403); outgoing.end(); return;
          }
          const headers = new Headers(incoming.headers);
          for (const key of [...headers.keys()]) if (key.startsWith('oai-authenticated-user-')) headers.delete(key);
          headers.set('oai-authenticated-user-email', 'preview@local.invalid');
          headers.set('oai-authenticated-user-id', 'local-preview-owner');
          const chunks = []; let bytes = 0;
          for await (const chunk of incoming) {
            bytes += chunk.length;
            if (bytes > 16_384) { outgoing.writeHead(413); outgoing.end(); return; }
            chunks.push(chunk);
          }
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(new URL(incoming.url, authority), { method: incoming.method, headers, body });
          const handler = pathname === '/api/contact' ? handleContact : handleSceneSettings;
          const response = await handler(request, { BUCKET: bucket, SCENE_EDITOR_EMAIL: 'preview@local.invalid' });
          outgoing.writeHead(response.status, Object.fromEntries(response.headers));
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          outgoing.end(JSON.stringify({ error: 'preview_unavailable' }));
        }
      });
    },
  };
}
