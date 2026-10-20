import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import publishedSettings from '../src/published-scene-settings.json' with { type: 'json' };
import { createLocalPreviewBucket } from './local-settings-preview.mjs';
import { handleSceneSettings, SCENE_SETTINGS_KEY } from '../worker/scene-settings-api.js';

const parent = resolve('.sites-runtime');
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(resolve(parent, 'scene-preset-test-'));
const initial = { initialSettings: publishedSettings };
const origin = 'http://localhost:5173';
const env = { BUCKET: createLocalPreviewBucket(directory, initial), SCENE_EDITOR_EMAIL: 'preview@local.invalid' };
try {
  const read = async bucket => (await handleSceneSettings(new Request(`${origin}/api/scene-settings`, {
    headers: { 'oai-authenticated-user-email': 'preview@local.invalid' },
  }), { ...env, BUCKET: bucket })).json();
  const first = await read(env.BUCKET);
  assert.deepEqual(first.settings, publishedSettings, 'Fresh localhost gets every published stone, light and effect value');
  assert(first.revision && first.canSave);
  assert.equal((await read(createLocalPreviewBucket(directory, initial))).revision, first.revision, 'Restart keeps a stable published revision');
  assert.equal(await env.BUCKET.get('contact-messages/00000000-0000-4000-8000-000000000001.json'), null, 'The preset never seeds contact data');
  const edited = structuredClone(first.settings); edited.rays.intensity = 2.31;
  const write = revision => new Request(`${origin}/api/scene-settings`, {
    method: 'PUT', headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-email': 'preview@local.invalid' },
    body: JSON.stringify({ settings: edited, revision }),
  });
  assert.equal((await handleSceneSettings(write(first.revision), env)).status, 200);
  assert.equal((await handleSceneSettings(write(first.revision), env)).status, 409, 'Published seed retains write conflict protection');
  const fresh = createLocalPreviewBucket(directory, { initialSettings: { ...publishedSettings, rays: { ...publishedSettings.rays, intensity: 5 } } });
  assert.deepEqual((await read(fresh)).settings, edited, 'An existing local edit survives restart and takes precedence over the bundled preset');
  assert.equal(await createLocalPreviewBucket(directory + '-missing').get(SCENE_SETTINGS_KEY), null, 'Unseeded preview users retain their existing behavior');
  console.log('Local scene checks passed: published preset on first run, stable revision, durable overrides and conflict protection');
} finally {
  assert.equal(dirname(resolve(directory)), parent);
  assert(basename(directory).startsWith('scene-preset-test-'));
  await rm(directory, { recursive: true, force: true });
}
