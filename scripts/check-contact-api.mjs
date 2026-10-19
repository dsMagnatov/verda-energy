import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { handleContact, CONTACT_MESSAGES_PREFIX, MAX_CONTACT_BODY_BYTES, CONTACT_PAGE_SIZE } from '../worker/contact-api.js';
import { handleSceneSettings, SCENE_SETTINGS_KEY } from '../worker/scene-settings-api.js';
import { createDefaultSceneSettings } from '../src/scene-settings.js';
import { createLocalPreviewBucket } from './local-settings-preview.mjs';
import worker from '../worker/index.js';

const origin = 'https://verda.test', owner = 'owner@example.test';
const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const key = id => `${CONTACT_MESSAGES_PREFIX}${id}.json`;
const inquiry = { id: uuid(1), name: 'Катерина Тест', email: 'kateryna@example.test', message: 'Вітаю! Цікавить сонячна станція для нашого будинку.', website: '' };
const clone = value => structuredClone(value);

class MemoryBucket {
  records = new Map(); serial = 0; failPut = false; failList = false; failGet = false;
  reads = []; lists = []; writes = [];
  async put(storageKey, body, options = {}) {
    this.writes.push({ key: storageKey, options });
    if (this.failPut) throw new Error('Private storage diagnostic');
    assert.deepEqual(options.onlyIf, { etagDoesNotMatch: '*' }, 'Inquiry creation is one atomic first-write operation');
    if (this.records.has(storageKey)) return null;
    const record = { body, etag: `contact-${++this.serial}` }; this.records.set(storageKey, record);
    return { etag: record.etag };
  }
  async get(storageKey) {
    this.reads.push(storageKey);
    if (this.failGet) throw new Error('Private read diagnostic');
    const record = this.records.get(storageKey);
    return record ? { etag: record.etag, json: async () => JSON.parse(record.body) } : null;
  }
  async list(options) {
    this.lists.push(options);
    if (this.failList) throw new Error('Private list diagnostic');
    assert.equal(options.prefix, CONTACT_MESSAGES_PREFIX);
    assert.equal(options.limit, CONTACT_PAGE_SIZE);
    const keys = [...this.records.keys()].filter(storageKey => storageKey.startsWith(options.prefix) && (!options.cursor || storageKey > options.cursor)).sort();
    const page = keys.slice(0, options.limit), truncated = keys.length > page.length;
    return { objects: page.map(storageKey => ({ key: storageKey })), truncated,
      ...(truncated ? { cursor: page.at(-1) } : {}) };
  }
}

const bucket = new MemoryBucket(), env = { BUCKET: bucket, SCENE_EDITOR_EMAIL: owner, ASSETS: { fetch: async () => new Response('asset') } };
const request = (method = 'GET', options = {}) => {
  const headers = new Headers(options.headers);
  if (options.identity) headers.set('oai-authenticated-user-email', options.identity);
  if (method === 'POST') {
    if (!options.noOrigin) headers.set('origin', options.origin || origin);
    if (!options.noContentType) headers.set('content-type', options.contentType || 'application/json');
  }
  return new Request(`${origin}/api/contact${options.query || ''}`, {
    method, headers, ...(method === 'POST' ? { body: options.raw ?? JSON.stringify(options.body ?? inquiry) } : {}),
  });
};
let responses = 0;
const call = async (req, expected, environment = env, handler = handleContact) => {
  const response = await handler(req, environment);
  assert.equal(response.status, expected);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-type'), /^application\/json/);
  const text = await response.text(); responses++;
  assert(!text.includes(owner) && !text.includes('Private '), 'Responses never expose owner configuration or internal storage errors');
  if (req.method !== 'GET' || !new URL(req.url).searchParams.has('inbox') || expected !== 200) {
    assert(!text.includes(inquiry.name) && !text.includes(inquiry.email) && !text.includes(inquiry.message), 'Public receipts/errors never echo inquiry PII');
  }
  return JSON.parse(text);
};
const post = (body = inquiry, options = {}) => request('POST', { body, ...options });
const inbox = options => request('GET', { identity: owner, query: '?inbox=1', ...options });

assert.equal(MAX_CONTACT_BODY_BYTES, 16 * 1024);
assert.equal(CONTACT_PAGE_SIZE, 50);
assert.deepEqual(await call(request(), 200, {}), { canRead: false });
assert.deepEqual(await call(request('GET', { identity: owner }), 200, { SCENE_EDITOR_EMAIL: owner }), { canRead: true });
assert.deepEqual(await call(request('GET', { identity: ` ${owner.toUpperCase()} ` }), 200), { canRead: true });
assert.deepEqual(await call(request('GET', { identity: owner }), 200, { SCENE_EDITOR_EMAIL: '' }), { canRead: false });
await call(inbox({ identity: undefined }), 403);
await call(inbox({ identity: 'visitor@example.test' }), 403);
await call(request('GET', { query: '?inbox=1', headers: { 'x-owner-email': owner } }), 403);
assert.equal(bucket.reads.length + bucket.lists.length, 0, 'Unauthorized inbox requests never touch private storage');
await call(inbox(), 503, { SCENE_EDITOR_EMAIL: owner });
await call(request('PUT'), 405);
await call(request('DELETE'), 405);
await call(post(inquiry, { noOrigin: true }), 403);
await call(post(inquiry, { origin: 'https://other.test' }), 403);
await call(post(inquiry, { contentType: 'text/plain' }), 415);
await call(post(inquiry, { noContentType: true }), 415);
await call(post(inquiry, { raw: '{' }), 400);
await call(post(inquiry, { raw: '' }), 400);
await call(post(inquiry, { raw: new Uint8Array([255, 254]) }), 400);
await call(post(inquiry, { raw: 'x'.repeat(MAX_CONTACT_BODY_BYTES + 1) }), 413);
await call(post(inquiry, { headers: { 'content-length': String(MAX_CONTACT_BODY_BYTES + 1) } }), 413);
for (const malformed of [null, [], 1, 'inquiry']) await call(post(malformed, { raw: JSON.stringify(malformed) }), 400);
for (const field of ['id', 'name', 'email', 'message']) {
  const missing = clone(inquiry); delete missing[field]; await call(post(missing), 400);
  for (const invalid of [null, 1, [], {}]) await call(post({ ...inquiry, [field]: invalid }), 400);
}
for (const id of ['../published', '00000000', `${uuid(1)}.json`, '00000000-0000-0000-0000-000000000000', ` ${uuid(1)}`]) await call(post({ ...inquiry, id }), 400);
for (const name of ['', '   ', 'a'.repeat(121), 'Name\nInjected', 'Name\u0000']) await call(post({ ...inquiry, name }), 400);
for (const email of ['', 'not-email', 'person@', '@example.test', 'a@b', 'a b@example.test', `a@${'b'.repeat(250)}.test`]) await call(post({ ...inquiry, email }), 400);
for (const message of ['', '  ', 'a'.repeat(4001), 'Hello\u0000world']) await call(post({ ...inquiry, message }), 400);
for (const website of ['https://bot.test', 1, {}, null]) await call(post({ ...inquiry, website }), 400);
assert.equal(bucket.records.size, 0, 'Invalid requests and honeypot submissions store no records');
await call(post(), 503, {});
bucket.failPut = true; await call(post(), 503); bucket.failPut = false;
assert.equal(bucket.records.size, 0, 'A failed durable write is never acknowledged as success');
await call(post(), 503, { ...env, BUCKET: { put: async () => ({}) } });

// Settings share the bucket, but their object and revision remain untouched.
const publishedSettings = { settings: createDefaultSceneSettings(), updatedAt: '2026-10-19T12:00:00.000Z' };
const settingsBody = JSON.stringify(publishedSettings);
bucket.records.set(SCENE_SETTINGS_KEY, { body: settingsBody, etag: 'settings-preserved' });
assert.deepEqual(await call(post(), 201), { receipt: inquiry.id });
const firstRecord = clone(bucket.records.get(key(inquiry.id))), firstMessage = JSON.parse(firstRecord.body);
assert.deepEqual(Object.keys(firstMessage), ['id', 'name', 'email', 'message', 'createdAt']);
assert.equal(firstMessage.name, inquiry.name); assert.equal(firstMessage.email, inquiry.email); assert.equal(firstMessage.message, inquiry.message);
assert(Number.isFinite(Date.parse(firstMessage.createdAt)));
assert(!Object.hasOwn(firstMessage, 'website'), 'Only the intended inquiry fields are retained');
assert.deepEqual(await call(post({ ...inquiry, message: 'A retry must not replace the original.' }), 200), { receipt: inquiry.id });
assert.deepEqual(bucket.records.get(key(inquiry.id)), firstRecord, 'A duplicate UUID never overwrites its first durable inquiry');
const raceInquiry = { ...inquiry, id: uuid(2), name: 'Concurrent visitor' };
const races = await Promise.all(Array.from({ length: 5 }, () => handleContact(post(raceInquiry), env)));
assert.deepEqual(races.map(response => response.status).sort(), [200, 200, 200, 200, 201]);
for (const response of races) assert.deepEqual(await response.json(), { receipt: raceInquiry.id });
const maxEmail = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(56)}.test`;
assert.equal(maxEmail.length, 254);
const longInquiry = { id: uuid(3), name: 'І'.repeat(120), email: maxEmail, message: 'я'.repeat(4000), website: '' };
assert(new TextEncoder().encode(JSON.stringify(longInquiry)).byteLength > 8192, 'A full non-ASCII message needs the agreed sixteen KiB envelope');
await call(post(longInquiry), 201);
const trimmed = { id: uuid(4), name: '  A Visitor  ', email: '  visitor@example.test  ', message: '  First line\nSecond line\twith detail.  ', extra: 'discard' };
await call(post(trimmed, { contentType: 'application/json; charset=utf-8' }), 201);
const trimmedStored = JSON.parse(bucket.records.get(key(trimmed.id)).body);
assert.equal(trimmedStored.name, 'A Visitor'); assert.equal(trimmedStored.email, 'visitor@example.test');
assert.equal(trimmedStored.message, 'First line\nSecond line\twith detail.'); assert(!Object.hasOwn(trimmedStored, 'extra'));

const firstInbox = await call(inbox(), 200);
assert.equal(firstInbox.messages.length, 4); assert(!Object.hasOwn(firstInbox, 'cursor'));
assert.deepEqual(firstInbox.messages.find(message => message.id === inquiry.id), firstMessage, 'A new owner request receives the durable original message');
await call(inbox({ query: '?inbox=1&cursor=' }), 400);
await call(inbox({ query: `?inbox=1&cursor=${'x'.repeat(2049)}` }), 400);
bucket.failList = true; await call(inbox(), 503); bucket.failList = false;
bucket.failGet = true; await call(inbox(), 503); bucket.failGet = false;
for (let index = 5; index <= 54; index++) await call(post({ ...inquiry, id: uuid(index), name: `Visitor ${index}` }), 201);
const pageOne = await call(inbox(), 200);
assert.equal(pageOne.messages.length, 50); assert.equal(typeof pageOne.cursor, 'string');
const pageTwo = await call(inbox({ query: `?inbox=1&cursor=${encodeURIComponent(pageOne.cursor)}` }), 200);
assert.equal(pageTwo.messages.length, 4); assert(!Object.hasOwn(pageTwo, 'cursor'));
const pagedIds = [...pageOne.messages, ...pageTwo.messages].map(message => message.id);
assert.equal(new Set(pagedIds).size, 54, 'Owner pagination reads each stored inquiry once without repeats or lost messages');
assert.equal(bucket.records.get(SCENE_SETTINGS_KEY).body, settingsBody, 'Intake and inbox pagination preserve shared scene settings');
const routed = await call(request(), 200, env, worker.fetch.bind(worker));
assert.deepEqual(routed, { canRead: false });
assert.equal(await (await worker.fetch(new Request(`${origin}/`), env)).text(), 'asset');

// Exercise the real file-backed preview adapter, including its existing preset
// file format, separate contact keys, atomic retries and prefix-only listing.
const temporaryParent = resolve('.sites-runtime');
await mkdir(temporaryParent, { recursive: true });
const previewDirectory = await mkdtemp(join(temporaryParent, 'contact-api-test-'));
try {
  await writeFile(join(previewDirectory, 'shared-scene-preview.json'), JSON.stringify({ etag: 'legacy-preview', data: settingsBody }));
  const previewBucket = createLocalPreviewBucket(previewDirectory);
  const previewEnv = { BUCKET: previewBucket, SCENE_EDITOR_EMAIL: owner };
  const beforePreviewSettings = await (await handleSceneSettings(new Request(`${origin}/api/scene-settings`), previewEnv)).json();
  assert.equal(beforePreviewSettings.revision, 'legacy-preview');
  assert.deepEqual(beforePreviewSettings.settings, publishedSettings.settings);
  const previewRaces = await Promise.all(Array.from({ length: 5 }, () => handleContact(post(), previewEnv)));
  assert.deepEqual(previewRaces.map(response => response.status).sort(), [200, 200, 200, 200, 201]);
  for (let index = 2; index <= 4; index++) await call(post({ ...inquiry, id: uuid(index) }), 201, previewEnv);
  const freshPreviewBucket = createLocalPreviewBucket(previewDirectory);
  const freshPreview = await call(inbox(), 200, { ...previewEnv, BUCKET: freshPreviewBucket });
  assert.equal(freshPreview.messages.length, 4, 'A freshly created preview adapter reads durable inquiry files');
  const previewPage = await freshPreviewBucket.list({ prefix: CONTACT_MESSAGES_PREFIX, limit: 2 });
  const nextPreviewPage = await freshPreviewBucket.list({ prefix: CONTACT_MESSAGES_PREFIX, limit: 2, cursor: previewPage.cursor });
  assert.equal(previewPage.objects.length, 2); assert(previewPage.truncated);
  assert.equal(nextPreviewPage.objects.length, 2); assert(!nextPreviewPage.truncated);
  assert.equal(new Set([...previewPage.objects, ...nextPreviewPage.objects].map(object => object.key)).size, 4);
  assert.equal((await freshPreviewBucket.get(SCENE_SETTINGS_KEY)).etag, 'legacy-preview');
  assert.equal(await (await freshPreviewBucket.get(SCENE_SETTINGS_KEY)).text(), settingsBody);
  const editedPreviewSettings = createDefaultSceneSettings();
  editedPreviewSettings.rays.intensity = 2.31;
  editedPreviewSettings.ferns.instances['upper-1'].scale = 1.43;
  const settingsWrite = revision => new Request(`${origin}/api/scene-settings`, {
    method: 'PUT', headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-email': owner },
    body: JSON.stringify({ settings: editedPreviewSettings, revision }),
  });
  const updatedPreview = await handleSceneSettings(settingsWrite('legacy-preview'), previewEnv);
  assert.equal(updatedPreview.status, 200);
  const updatedPreviewBody = await updatedPreview.json();
  assert.notEqual(updatedPreviewBody.revision, 'legacy-preview');
  assert.deepEqual(updatedPreviewBody.settings, editedPreviewSettings, 'The existing preview preset can still be atomically updated alongside contact files');
  assert.equal((await handleSceneSettings(settingsWrite('legacy-preview'), previewEnv)).status, 409,
    'Preview settings retain their optimistic concurrency checks');
  assert.deepEqual((await (await freshPreviewBucket.get(SCENE_SETTINGS_KEY)).json()).settings, editedPreviewSettings);
  assert.equal((await call(inbox(), 200, { ...previewEnv, BUCKET: freshPreviewBucket })).messages.length, 4,
    'A shared-settings write does not replace any contact records');
  await assert.rejects(() => previewBucket.list({ prefix: 'scene-settings/' }));
  await assert.rejects(() => previewBucket.get('contact-messages/../../outside.json'));
  await assert.rejects(() => previewBucket.put('unsupported-key', '{}'));
  await call(post({ ...inquiry, id: uuid(5) }), 201, previewEnv);
} finally {
  const verified = resolve(previewDirectory);
  assert.equal(dirname(verified), temporaryParent);
  assert(basename(verified).startsWith('contact-api-test-'), 'Only the directory created for this check may be removed');
  await rm(verified, { recursive: true, force: true });
}

const callbackBucket = new MemoryBucket(), callbackEnv = { ...env, BUCKET: callbackBucket };
const callback = { id: uuid(90), kind: 'callback', email: 'callback@example.test', website: '' };
assert.deepEqual(await call(post(callback), 201, callbackEnv), { receipt: callback.id });
const callbackStored = JSON.parse(callbackBucket.records.get(key(callback.id)).body);
assert.equal(callbackStored.kind, 'callback'); assert.equal(callbackStored.email, callback.email);
assert(!Object.hasOwn(callbackStored, 'name') && !Object.hasOwn(callbackStored, 'message'), 'Email-only requests never invent a name or message');
assert.deepEqual(await call(post(callback), 200, callbackEnv), { receipt: callback.id });
assert.equal(callbackBucket.records.size, 1, 'Email-only retries do not duplicate requests');
await call(inbox({ identity: 'visitor@example.test' }), 403, callbackEnv);
const callbacks = await call(inbox(), 200, callbackEnv);
assert.deepEqual(callbacks.messages, [callbackStored], 'The owner inbox reads persisted email-only enquiries');
for (const email of ['', 'not-an-email', 'a\r\nb@example.test', 'a'.repeat(255) + '@example.test']) {
  await call(post({ ...callback, id: uuid(91), email }), 400, callbackEnv);
}
await call(post({ ...callback, kind: 'unknown' }), 400, callbackEnv);
await call(post({ ...callback, website: 'spam' }), 400, callbackEnv);
assert.equal(callbackBucket.records.size, 1, 'Invalid email-only requests never reach storage');

console.log(JSON.stringify({ ok: true, apiResponsesChecked: responses, inboxMessagesChecked: 54, maxBodyBytes: MAX_CONTACT_BODY_BYTES,
  checks: ['same-origin JSON writes', 'bounded fields, Unicode and request body', 'honeypot rejects without storage',
    'durable first write and idempotent UUID retries', 'no public PII echo', 'owner-only inbox and safe capabilities',
    'fifty-item pagination and fresh-reader persistence', 'storage failure handling', 'scene-settings isolation',
    'file-backed preview persistence, concurrency and safe prefix paths', 'actual Worker route and static assets',
    'email-only intake, durable owner inbox, validation and retry safety'] }, null, 2));
