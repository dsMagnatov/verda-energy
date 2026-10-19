import assert from 'node:assert/strict';
import preset from '../src/published-scene-settings.json' with { type: 'json' };
import settingsApi from '../api/scene-settings.js';
import contactApi from '../api/contact.js';
import { createContactStore } from '../server/contact-store.js';
import { handleContact, CONTACT_MESSAGES_PREFIX } from '../worker/contact-api.js';
import { validateSceneSettings } from '../worker/scene-settings-api.js';

const origin = 'https://verda.test';
const get = await settingsApi.fetch(new Request(`${origin}/api/scene-settings`));
assert.equal(get.status, 200);
const shared = await get.json();
assert(validateSceneSettings(shared.settings));
assert.deepEqual(shared.settings, preset, 'Exported appearance is unchanged for all visitors');
assert.equal(shared.canSave, false);
assert.equal(get.headers.get('cache-control'), 'no-store');
const spoof = { 'oai-authenticated-user-email': 'owner@example.test', 'origin': origin, 'content-type': 'application/json' };
assert.equal((await settingsApi.fetch(new Request(`${origin}/api/scene-settings`, { method: 'PUT', headers: spoof, body: '{}' }))).status, 403);
assert.equal((await contactApi.fetch(new Request(`${origin}/api/contact?inbox=1`, { headers: spoof }))).status, 403, 'Sites headers cannot reveal private messages on Vercel');
assert.deepEqual(await (await contactApi.fetch(new Request(`${origin}/api/contact`))).json(), { canRead: false });

const fields = { id: '00000000-0000-4000-8000-000000000001', kind: 'callback', email: 'test@example.test', website: '' };
const key = `${CONTACT_MESSAGES_PREFIX}${fields.id}.json`;
let writes = 0;
const store = createContactStore({
  write: async (path, value, options) => {
    writes++;
    assert.equal(path, key);
    assert.equal(JSON.parse(value).email, fields.email);
    assert.deepEqual(options, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
    return { pathname: key };
  },
});
const request = source => new Request(`${origin}/api/contact`, { method: 'POST', headers: { origin: source, 'content-type': 'application/json' }, body: JSON.stringify(fields) });
assert.equal((await handleContact(request('https://other.test'), { BUCKET: store })).status, 403);
assert.equal(writes, 0, 'Cross-origin submissions do not reach private storage');
assert.equal((await handleContact(request(origin), { BUCKET: store })).status, 201);
const retry = createContactStore({ write: async () => { throw new Error('exists'); }, stat: async () => ({ pathname: key }) });
assert.equal((await handleContact(request(origin), { BUCKET: retry })).status, 200, 'Repeated submission UUID stays idempotent');
const failure = createContactStore({ write: async () => { throw new Error('secret diagnostic'); }, stat: async () => { throw new Error('offline'); } });
const failed = await handleContact(request(origin), { BUCKET: failure });
assert.equal(failed.status, 503); assert(!(await failed.text()).includes('secret'));
console.log('Vercel checks passed: exported preset, read-only editor, spoofed identity rejected, private contact storage, retries, honest failures');
