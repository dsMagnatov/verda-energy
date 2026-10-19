import assert from 'node:assert/strict';
import { SCENE_CONTROL_GROUPS, GARDEN_EFFECT_SOURCES, createDefaultSceneSettings, createDefaultFernInstanceSettings, getSceneControl, sanitizeFernInstanceSettings, sanitizeSceneSettings } from '../src/scene-settings.js';
import { FERN_INSTANCES, FERN_INSTANCE_CONTROL_KEYS } from '../src/fern-instances.js';
import { handleSceneSettings, validateSceneSettings, SCENE_SETTINGS_KEY, MAX_SETTINGS_BODY_BYTES } from '../worker/scene-settings-api.js';
import worker from '../worker/index.js';

const origin = 'https://verda.test';
const editor = 'owner@example.test';
const clone = value => structuredClone(value);
const heroGroupIds = ['rays', 'particles', 'optics', 'background', 'stone', 'solar', 'ferns', 'title'];
const gardenGroups = SCENE_CONTROL_GROUPS.filter(group => group.scope === 'garden');
const heroOnly = settings => Object.fromEntries(heroGroupIds.filter(id => Object.hasOwn(settings, id)).map(id => [id, clone(settings[id])]));

class MemoryBucket {
  record = null;
  serial = 0;
  fail = false;
  async get(key) {
    assert.equal(key, SCENE_SETTINGS_KEY);
    if (this.fail) throw new Error('Storage unavailable');
    if (!this.record) return null;
    const record = clone(this.record);
    return { etag: record.etag, json: async () => JSON.parse(record.body) };
  }
  async head(key) {
    assert.equal(key, SCENE_SETTINGS_KEY);
    return this.record && { etag: this.record.etag };
  }
  async put(key, body, options) {
    assert.equal(key, SCENE_SETTINGS_KEY);
    if (this.fail) throw new Error('Storage unavailable');
    const condition = options.onlyIf;
    if (condition.etagDoesNotMatch === '*' && this.record) return null;
    if (condition.etagMatches !== undefined && condition.etagMatches !== this.record?.etag) return null;
    this.record = { body, etag: `revision-${++this.serial}` };
    return { etag: this.record.etag };
  }
}

const bucket = new MemoryBucket();
const env = { BUCKET: bucket, SCENE_EDITOR_EMAIL: editor, ASSETS: { fetch: async () => new Response('asset') } };
const request = (method = 'GET', options = {}) => {
  const headers = new Headers(options.headers);
  if (options.identity) headers.set('oai-authenticated-user-email', options.identity);
  if (method === 'PUT') {
    if (!options.noOrigin) headers.set('origin', options.origin || origin);
    if (!options.noContentType) headers.set('content-type', options.contentType || 'application/json');
  }
  return new Request(`${origin}${options.path || '/api/scene-settings'}`, {
    method,
    headers,
    ...(method === 'PUT' ? { body: options.raw ?? JSON.stringify(options.body) } : {}),
  });
};
let responses = 0;
const call = async (req, expected, currentEnv = env) => {
  const response = await handleSceneSettings(req, currentEnv);
  assert.equal(response.status, expected);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  assert.equal(text.toLowerCase().includes(editor), false, 'No editor identity is emitted');
  responses++;
  return JSON.parse(text);
};
const put = (settings, revision, options = {}) => request('PUT', {
  identity: editor, body: { settings, revision }, ...options,
});
const settings = createDefaultSceneSettings();
assert.deepEqual(Object.keys(settings), [...heroGroupIds, ...gardenGroups.map(group => group.id)]);
assert.equal(SCENE_CONTROL_GROUPS.length, 18);
assert.equal(gardenGroups.length, 10);
assert.equal(SCENE_CONTROL_GROUPS.find(group => group.id === 'title').controls.length, 9);
assert.equal(FERN_INSTANCES.length, 9);
assert.equal(new Set(FERN_INSTANCES.map(({ id }) => id)).size, 9, 'Every plant has a unique persistent identity');
assert.deepEqual(Object.keys(settings.ferns.instances), FERN_INSTANCES.map(({ id }) => id));
assert.equal(new TextEncoder().encode(JSON.stringify({ settings, revision: 'revision-1' })).byteLength < MAX_SETTINGS_BODY_BYTES, true);
for (const { id } of FERN_INSTANCES) {
  assert.deepEqual(settings.ferns.instances[id], createDefaultFernInstanceSettings());
  assert.deepEqual(Object.keys(settings.ferns.instances[id]), FERN_INSTANCE_CONTROL_KEYS);
}
const independentDefaults = createDefaultSceneSettings();
independentDefaults.ferns.instances['upper-1'].scale = 2;
assert.equal(independentDefaults.ferns.instances['upper-2'].scale, 1, 'Default transforms never share a mutable record');
assert.equal(settings.ferns.instances['upper-1'].scale, 1);
assert.deepEqual(sanitizeFernInstanceSettings(null), createDefaultFernInstanceSettings());
assert.deepEqual(sanitizeFernInstanceSettings([]), createDefaultFernInstanceSettings());
for (const key of FERN_INSTANCE_CONTROL_KEYS) {
  const control = getSceneControl('ferns', key);
  assert.equal(sanitizeFernInstanceSettings({ [key]: Infinity })[key], control.default);
  assert.equal(sanitizeFernInstanceSettings({ [key]: control.max + 100 })[key], control.max);
  assert.equal(sanitizeFernInstanceSettings({ [key]: control.min - 100 })[key], control.min);
  const candidate = control.min + control.step * 1.4;
  const expected = Number((control.min + control.step).toFixed(String(control.step).split('.')[1]?.length || 0));
  assert.equal(sanitizeFernInstanceSettings({ [key]: candidate })[key], expected, `${key} uses the common slider step`);
}
assert.equal(Object.hasOwn(sanitizeFernInstanceSettings({ ignored: 1 }), 'ignored'), false);
for (const id of ['solar', 'ferns']) {
  const controls = SCENE_CONTROL_GROUPS.find(group => group.id === id).controls;
  assert(controls.filter(control => control.type !== 'color').length >= 13,
    `${id} exposes transform controls and at least six further numeric adjustments`);
}

assert.deepEqual(await call(request(), 200), { settings: null, revision: null, canSave: false });
assert.equal((await call(request('GET', { identity: ` ${editor.toUpperCase()} ` }), 200)).canSave, true);
assert.equal((await call(request('GET', { identity: editor }), 200, { ...env, SCENE_EDITOR_EMAIL: '' })).canSave, false);
await call(put(settings, null, { identity: undefined }), 403);
await call(put(settings, null, { identity: 'visitor@example.test' }), 403);
await call(put(settings, null, { origin: 'https://other.test' }), 403);
await call(put(settings, null, { noOrigin: true }), 403);
await call(put(settings, null, { contentType: 'text/plain' }), 415);
await call(put(settings, null, { raw: '{' }), 400);
await call(put(settings, null, { raw: '' }), 400);
await call(put(settings, null, { raw: JSON.stringify({ settings, revision: null, extra: 'x'.repeat(MAX_SETTINGS_BODY_BYTES) }) }), 413);
await call(put(settings, null, { headers: { 'content-length': String(MAX_SETTINGS_BODY_BYTES + 1) } }), 413);
await call(put({}, null), 400);
await call(request('PUT', { identity: editor, body: { settings } }), 400);
await call(put(settings, ''), 400);
await call(put(settings, 1), 400);

for (const group of SCENE_CONTROL_GROUPS) {
  const partial = clone(settings);
  delete partial[group.id];
  await call(put(partial, null), 400);
  for (const control of group.controls) {
    const bad = clone(settings);
    delete bad[group.id][control.key];
    await call(put(bad, null), 400);
    bad[group.id][control.key] = control.type === 'color' ? '#fff' : '1';
    await call(put(bad, null), 400);
    if (control.type !== 'color') {
      bad[group.id][control.key] = control.max + Math.max(1, control.step);
      await call(put(bad, null), 400);
      bad[group.id][control.key] = control.min - Math.max(1, control.step);
      await call(put(bad, null), 400);
      // JSON cannot encode NaN/Infinity; null must also be rejected.
      bad[group.id][control.key] = null;
      await call(put(bad, null), 400);
    }
  }
}

// Per-plant writes are complete snapshots, just like the existing global tabs.
const withoutInstances = clone(settings);
delete withoutInstances.ferns.instances;
await call(put(withoutInstances, null), 400);
for (const malformed of [null, [], 1, 'plants']) {
  const bad = clone(settings);
  bad.ferns.instances = malformed;
  await call(put(bad, null), 400);
}
for (const { id } of FERN_INSTANCES) {
  const missingPlant = clone(settings);
  delete missingPlant.ferns.instances[id];
  await call(put(missingPlant, null), 400);
  for (const malformed of [null, [], 1, 'plant']) {
    const bad = clone(settings);
    bad.ferns.instances[id] = malformed;
    await call(put(bad, null), 400);
  }
  for (const key of FERN_INSTANCE_CONTROL_KEYS) {
    const { min, max, step } = getSceneControl('ferns', key);
    const bad = clone(settings);
    delete bad.ferns.instances[id][key];
    await call(put(bad, null), 400);
    bad.ferns.instances[id][key] = '1';
    await call(put(bad, null), 400);
    bad.ferns.instances[id][key] = max + Math.max(1, step);
    await call(put(bad, null), 400);
    bad.ferns.instances[id][key] = min - Math.max(1, step);
    await call(put(bad, null), 400);
    bad.ferns.instances[id][key] = null;
    await call(put(bad, null), 400);
    for (const nonFinite of [Infinity, -Infinity, NaN]) {
      bad.ferns.instances[id][key] = nonFinite;
      assert.equal(validateSceneSettings(bad), false, `${id}.${key} rejects non-finite values before serialization`);
    }
  }
}

const tuned = clone(settings);
for (const group of SCENE_CONTROL_GROUPS) {
  for (const control of group.controls) {
    tuned[group.id][control.key] = control.type === 'color' ? '#7a9Bcc' : control.max;
  }
  tuned[group.id].ignored = 'remove';
}
tuned.ignored = { arbitrary: 1 };
tuned.ferns.instances.ignored = { arbitrary: 1 };
tuned.ferns.instances['upper-1'].ignored = 'remove';
Object.assign(tuned.ferns.instances['upper-1'], { scale: 1.83, positionX: .32, tiltX: 27 });
Object.assign(tuned.ferns.instances['lower-left-2'], { scale: .76, positionZ: -.42, rotation: -43 });
const saved = await call(put(tuned, null), 200);
assert.deepEqual(saved.settings, sanitizeSceneSettings(tuned));
assert.equal(saved.canSave, true);
assert.equal(saved.revision, 'revision-1');
assert.equal(Object.hasOwn(saved.settings, 'ignored'), false);
assert.equal(Object.hasOwn(saved.settings.ferns.instances, 'ignored'), false);
assert.equal(Object.hasOwn(saved.settings.ferns.instances['upper-1'], 'ignored'), false);
assert.deepEqual(saved.settings.ferns.instances['upper-1'], { ...createDefaultFernInstanceSettings(), scale: 1.83, positionX: .32, tiltX: 27 });
assert.deepEqual(saved.settings.ferns.instances['lower-left-2'], { ...createDefaultFernInstanceSettings(), scale: .76, positionZ: -.42, rotation: -43 });
assert.deepEqual(saved.settings.ferns.instances['right-1'], createDefaultFernInstanceSettings(), 'Other plants remain independent');
assert.equal(JSON.parse(bucket.record.body).updatedAt.length > 0, true);

// Two fresh visitors receive the published snapshot without any browser storage.
for (let client = 0; client < 2; client++) {
  const fresh = await call(new Request(`${origin}/api/scene-settings`), 200);
  assert.deepEqual(fresh.settings, saved.settings);
  assert.equal(fresh.revision, saved.revision);
  assert.equal(fresh.canSave, false);
}

const concurrent = await Promise.all([
  handleSceneSettings(put(settings, saved.revision), env),
  handleSceneSettings(put(tuned, saved.revision), env),
]);
assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
for (const response of concurrent) assert.equal(response.headers.get('cache-control'), 'no-store');
await call(put(settings, saved.revision), 409);
await call(put(settings, null), 409);

// A stored snapshot from before a new group/control gains current defaults.
bucket.record = { etag: 'old-revision', body: JSON.stringify({ settings: { rays: { intensity: 2 } } }) };
const migrated = await call(request(), 200);
assert.equal(migrated.settings.rays.intensity, 2);
assert.deepEqual(migrated.settings.particles, settings.particles);
if (settings.background) assert.deepEqual(migrated.settings.background, settings.background);
assert.deepEqual(migrated.settings.solar, settings.solar);
assert.deepEqual(migrated.settings.ferns, settings.ferns);

// The production upgrade adds object controls to the previous complete five-tab
// preset. Existing owner choices survive, and both new tabs acquire defaults.
const legacy = heroOnly(saved.settings);
delete legacy.solar;
delete legacy.ferns;
delete legacy.title;
bucket.record = { etag: 'five-tab-revision', body: JSON.stringify({ settings: legacy }) };
const upgraded = await call(request('GET', { identity: editor }), 200);
for (const id of ['rays', 'particles', 'optics', 'background', 'stone']) {
  assert.deepEqual(upgraded.settings[id], saved.settings[id], `${id} preserves its published values`);
}
assert.deepEqual(upgraded.settings.solar, settings.solar);
assert.deepEqual(upgraded.settings.ferns, settings.ferns);
assert.deepEqual(upgraded.settings.title, settings.title);
assert.equal(upgraded.revision, 'five-tab-revision', 'Read migration keeps the storage revision');

// Existing seven-tab presets gain neutral per-plant offsets; every published
// global choice remains exactly as saved, including the global fern transform.
const sevenTabLegacy = heroOnly(saved.settings);
delete sevenTabLegacy.ferns.instances;
delete sevenTabLegacy.title;
bucket.record = { etag: 'seven-tab-revision', body: JSON.stringify({ settings: sevenTabLegacy }) };
const perPlantUpgrade = await call(request('GET', { identity: editor }), 200);
const upgradedGlobals = heroOnly(perPlantUpgrade.settings);
delete upgradedGlobals.ferns.instances;
delete upgradedGlobals.title;
assert.deepEqual(upgradedGlobals, sevenTabLegacy, 'Per-plant migration preserves all seven published tabs exactly');
assert.deepEqual(perPlantUpgrade.settings.ferns.instances, settings.ferns.instances);
assert.equal(perPlantUpgrade.revision, 'seven-tab-revision');
assert.deepEqual(perPlantUpgrade.settings.title, settings.title);
assert.deepEqual(JSON.parse(bucket.record.body).settings, sevenTabLegacy, 'GET migration does not rewrite the owner preset');

// Save the newly introduced object settings, then read through a separate public
// request: their persistence must use shared storage, independent of a browser.
const objectPreset = clone(perPlantUpgrade.settings);
for (const id of ['solar', 'ferns']) objectPreset[id] = clone(saved.settings[id]);
const objectSave = await call(put(objectPreset, perPlantUpgrade.revision), 200);
assert.notEqual(objectSave.revision, perPlantUpgrade.revision);
const objectVisitor = await call(new Request(`${origin}/api/scene-settings`), 200);
assert.deepEqual(objectVisitor.settings.solar, saved.settings.solar);
assert.deepEqual(objectVisitor.settings.ferns, saved.settings.ferns);
assert.equal(objectVisitor.revision, objectSave.revision);
assert.equal(objectVisitor.canSave, false);
assert.notDeepEqual(objectVisitor.settings.ferns.instances['upper-1'], objectVisitor.settings.ferns.instances['lower-left-2'],
  'A fresh reader receives each independently saved plant transform');

// The title tab is introduced after per-plant settings. A read adds only that
// group's defaults and never rewrites the seven published groups or storage.
const preTitle = heroOnly(saved.settings);
delete preTitle.title;
bucket.record = { etag: 'pre-title-revision', body: JSON.stringify({ settings: preTitle }) };
const titleUpgrade = await call(request('GET', { identity: editor }), 200);
const titleUpgradePreviousTabs = heroOnly(titleUpgrade.settings);
delete titleUpgradePreviousTabs.title;
assert.deepEqual(titleUpgradePreviousTabs, preTitle, 'Title migration preserves every prior published value and per-plant transform');
assert.deepEqual(titleUpgrade.settings.title, settings.title);
assert.equal(titleUpgrade.revision, 'pre-title-revision');
assert.deepEqual(JSON.parse(bucket.record.body).settings, preTitle, 'Title read migration never rewrites the owner preset');
for (const malformed of [null, [], 1, 'title']) {
  const bad = clone(titleUpgrade.settings);
  bad.title = malformed;
  await call(put(bad, titleUpgrade.revision), 400);
}
const titlePreset = clone(titleUpgrade.settings);
titlePreset.title = {
  blur: .72, blurSize: 30, radius: 480, response: 8.25, glow: 1.4,
  glowSize: 36, distortion: .35, softness: .9, glowColor: '#C2e8BB',
};
const titleSave = await call(put(titlePreset, titleUpgrade.revision), 200);
const titleVisitor = await call(new Request(`${origin}/api/scene-settings`), 200);
assert.deepEqual(titleVisitor.settings, sanitizeSceneSettings(titlePreset), 'A fresh reader receives all saved title parameters');
assert.equal(titleVisitor.settings.title.glowColor, '#c2e8bb');
assert.equal(titleVisitor.revision, titleSave.revision);
assert.equal(titleVisitor.canSave, false);
const afterTitleSavePreviousTabs = heroOnly(titleVisitor.settings);
delete afterTitleSavePreviousTabs.title;
assert.deepEqual(afterTitleSavePreviousTabs, preTitle, 'Saving the title preserves every existing group and individual fern');
let titleRevision = titleSave.revision;
for (const bound of ['min', 'max']) {
  const titleExtreme = clone(titlePreset);
  for (const control of SCENE_CONTROL_GROUPS.find(group => group.id === 'title').controls) {
    if (control.type !== 'color') titleExtreme.title[control.key] = control[bound];
  }
  const extremeSave = await call(put(titleExtreme, titleRevision), 200);
  const extremeVisitor = await call(request(), 200);
  assert.deepEqual(extremeVisitor.settings.title, sanitizeSceneSettings(titleExtreme).title, `Title ${bound} values survive a public round trip`);
  titleRevision = extremeSave.revision;
}
for (const control of SCENE_CONTROL_GROUPS.find(group => group.id === 'title').controls.filter(control => control.type !== 'color')) {
  for (const nonFinite of [Infinity, -Infinity, NaN]) {
    const bad = clone(titlePreset);
    bad.title[control.key] = nonFinite;
    assert.equal(validateSceneSettings(bad), false, `title.${control.key} rejects non-finite values before serialization`);
  }
}

// The garden editor adds ten independent groups to the complete published
// eight-tab preset. Effects inherit that preset's look exactly once on read.
const preGarden = heroOnly(saved.settings);
Object.assign(preGarden.rays, { intensity: 2.13, width: .77, angle: -23 });
Object.assign(preGarden.particles, { count: 730, size: 2.35 });
Object.assign(preGarden.optics, { chromatic: 19, topRight: 3.2 });
Object.assign(preGarden.background, { topColor: '#c1ab71', brightness: 1.27 });
Object.assign(preGarden.ferns.instances['upper-right-2'], { scale: 1.37, positionX: -.42, tiltZ: 19 });
bucket.record = { etag: 'eight-tab-revision', body: JSON.stringify({ settings: preGarden }) };
await call(put(preGarden, 'eight-tab-revision'), 400);
const gardenUpgrade = await call(request('GET', { identity: editor }), 200);
assert.deepEqual(heroOnly(gardenUpgrade.settings), preGarden, 'Garden migration preserves all eight hero groups and every individual fern exactly');
assert.equal(gardenUpgrade.revision, 'eight-tab-revision');
assert.deepEqual(JSON.parse(bucket.record.body).settings, preGarden, 'Garden read migration does not rewrite the published preset');
for (const group of gardenGroups) {
  const sourceId = GARDEN_EFFECT_SOURCES[group.id];
  assert.deepEqual(gardenUpgrade.settings[group.id], sourceId ? preGarden[sourceId] : settings[group.id],
    `${group.id} receives ${sourceId ? 'the published hero effect' : 'its new defaults'}`);
  for (const malformed of [null, [], 1, 'garden']) {
    const bad = clone(gardenUpgrade.settings);
    bad[group.id] = malformed;
    await call(put(bad, gardenUpgrade.revision), 400);
  }
}
const retainedGarden = sanitizeSceneSettings({ ...preGarden, gardenRays: { ...settings.gardenRays, intensity: 1.23 } });
assert.equal(retainedGarden.gardenRays.intensity, 1.23, 'A previously saved garden group is retained');
assert.deepEqual(retainedGarden.gardenBackground, preGarden.background, 'Other missing garden groups still inherit published hero effects');

const gardenPreset = clone(gardenUpgrade.settings);
for (const group of gardenGroups) for (const control of group.controls) {
  gardenPreset[group.id][control.key] = control.type === 'color' ? '#AbCDef' : control.min + (control.max - control.min) * .41;
}
const gardenSave = await call(put(gardenPreset, gardenUpgrade.revision), 200);
const gardenVisitor = await call(new Request(`${origin}/api/scene-settings`), 200);
assert.deepEqual(gardenVisitor.settings, sanitizeSceneSettings(gardenPreset), 'All ten edited garden groups survive a shared public round trip');
assert.deepEqual(heroOnly(gardenVisitor.settings), preGarden, 'Saving garden edits leaves every hero group and fern unchanged');
assert.equal(gardenVisitor.canSave, false);
assert.equal(gardenVisitor.revision, gardenSave.revision);
for (const [id, sourceId] of Object.entries(GARDEN_EFFECT_SOURCES)) {
  assert.notDeepEqual(gardenVisitor.settings[id], gardenVisitor.settings[sourceId], `${id} remains independent of ${sourceId}`);
}
const heroEffectEdit = clone(gardenVisitor.settings);
heroEffectEdit.rays.intensity = 8.88;
heroEffectEdit.particles.count = 990;
heroEffectEdit.optics.chromatic = 37;
heroEffectEdit.background.topColor = '#7ca49f';
const heroEffectSave = await call(put(heroEffectEdit, gardenSave.revision), 200);
const afterHeroEdit = await call(request(), 200);
for (const group of gardenGroups) assert.deepEqual(afterHeroEdit.settings[group.id], gardenVisitor.settings[group.id],
  `Editing the hero later never re-inherits or changes saved ${group.id}`);
assert.deepEqual(afterHeroEdit.settings.ferns, preGarden.ferns);
const gardenEffectEdit = clone(afterHeroEdit.settings);
gardenEffectEdit.gardenRays.intensity = 1.19;
gardenEffectEdit.gardenParticles.count = 470;
gardenEffectEdit.gardenOptics.chromatic = 13;
gardenEffectEdit.gardenBackground.topColor = '#356249';
const gardenEffectSave = await call(put(gardenEffectEdit, heroEffectSave.revision), 200);
const afterGardenEffectEdit = await call(request(), 200);
assert.deepEqual(heroOnly(afterGardenEffectEdit.settings), heroOnly(afterHeroEdit.settings), 'Editing garden effects never changes the hero look or plant transforms');
assert.equal(afterGardenEffectEdit.revision, gardenEffectSave.revision);
for (const id of Object.keys(GARDEN_EFFECT_SOURCES)) assert.deepEqual(afterGardenEffectEdit.settings[id], gardenEffectEdit[id]);
for (const bound of ['min', 'max']) {
  const extreme = clone(afterGardenEffectEdit.settings);
  for (const group of gardenGroups) for (const control of group.controls) {
    if (control.type !== 'color') extreme[group.id][control.key] = control[bound];
  }
  const savedExtreme = await call(put(extreme, afterGardenEffectEdit.revision), 200);
  const freshExtreme = await call(request(), 200);
  for (const group of gardenGroups) assert.deepEqual(freshExtreme.settings[group.id], sanitizeSceneSettings(extreme)[group.id],
    `${group.id} ${bound} values survive a fresh public read`);
  afterGardenEffectEdit.revision = savedExtreme.revision;
}

// A published garden preset from before water highlights gains only those two
// defaults; its tuned water and all other groups/individual plants stay exact.
const preWaterShine = clone(saved.settings);
preWaterShine.gardenWater = { waveStrength: 1.77, waveScale: 2.33, waveSpeed: .62, reflection: .57,
  transparency: .49, roughness: .23, brightness: 1.18, depth: 1.91, color: '#315342' };
bucket.record = { etag: 'pre-water-shine-revision', body: JSON.stringify({ settings: preWaterShine }) };
await call(put(preWaterShine, 'pre-water-shine-revision'), 400);
const waterShineUpgrade = await call(request('GET', { identity: editor }), 200);
assert.deepEqual(waterShineUpgrade.settings.gardenWater, { ...preWaterShine.gardenWater, shine: 1, shineSize: 1 });
const beforeShineFields = clone(waterShineUpgrade.settings);
delete beforeShineFields.gardenWater.shine;
delete beforeShineFields.gardenWater.shineSize;
assert.deepEqual(beforeShineFields, preWaterShine, 'Water shine migration preserves every existing published setting');
assert.equal(waterShineUpgrade.revision, 'pre-water-shine-revision');
assert.deepEqual(JSON.parse(bucket.record.body).settings, preWaterShine, 'Reading old water settings does not rewrite the shared snapshot');
const waterShinePreset = clone(waterShineUpgrade.settings);
waterShinePreset.gardenWater.shine = 2.37;
waterShinePreset.gardenWater.shineSize = 1.63;
for (const key of ['shine', 'shineSize']) {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const bad = clone(waterShinePreset); bad.gardenWater[key] = invalid;
    assert.equal(validateSceneSettings(bad), false, `gardenWater.${key} rejects non-finite values`);
  }
}
const waterShineSave = await call(put(waterShinePreset, waterShineUpgrade.revision), 200);
const waterShineVisitor = await call(new Request(`${origin}/api/scene-settings`), 200);
assert.deepEqual(waterShineVisitor.settings, waterShinePreset, 'Both independently tuned water shine parameters reach a fresh public reader');
assert.equal(waterShineVisitor.revision, waterShineSave.revision);
assert.equal(waterShineVisitor.canSave, false);
const completeSnapshotBytes = new TextEncoder().encode(JSON.stringify({ settings: saved.settings, revision: 'r'.repeat(256) })).byteLength;
assert.equal(MAX_SETTINGS_BODY_BYTES, 16 * 1024, 'The complete garden editor fits the existing bounded body limit');
assert(completeSnapshotBytes < MAX_SETTINGS_BODY_BYTES, 'A full eighteen-group snapshot and longest revision fit without increasing the limit');

await call(request(), 503, { ...env, BUCKET: undefined });
await call(put(settings, null), 503, { ...env, BUCKET: undefined });
bucket.fail = true;
await call(request(), 503);
await call(put(settings, 'old-revision'), 503);
bucket.fail = false;
await call(request('POST'), 405);

assert.equal(await (await worker.fetch(request('GET', { path: '/' }), env)).text(), 'asset');
assert.equal((await worker.fetch(request('GET', { path: '/api/unknown' }), env)).status, 404);
assert.equal((await worker.fetch(request(), env)).status, 200);

console.log(JSON.stringify({ ok: true, apiResponsesChecked: responses, groups: SCENE_CONTROL_GROUPS.length, controls: SCENE_CONTROL_GROUPS.reduce((sum, group) => sum + group.controls.length, 0), gardenGroups: gardenGroups.length, completeSnapshotBytes, fernInstances: FERN_INSTANCES.length, perFernControls: FERN_INSTANCE_CONTROL_KEYS.length, checks: ['owner-only writes', 'same-origin writes', 'complete validated snapshots and every numeric boundary', 'nine independent plant records with complete validated transforms', '16 KiB body limit', 'durable shared read', 'optimistic concurrency', 'five-tab and seven-tab migration preserve all published choices', 'solar and independent fern public round trip', 'title migration preserves all seven groups and individual plants', 'title public round trip and both numeric extremes', 'eight-tab migration preserves every hero value and fern while cloning published garden effects', 'all ten garden groups public round trip and both extremes', 'hero and garden effects stay independent across later saves', 'legacy water migration preserves all prior fields and defaults only the two new shine parameters', 'water shine shared persistence to a fresh reader', 'storage failures', 'static asset delegation'] }, null, 2));
