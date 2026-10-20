import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSolarGarden } from '../src/solar-garden.js';
import { createSolarSpecs } from '../src/solar-specs.js';
import { createDefaultSceneSettings } from '../src/scene-settings.js';
import { getPose, JOURNEY_SCROLL_END } from '../src/journey.js';

const settings = createDefaultSceneSettings();
const garden = createSolarGarden();
const camera = new THREE.PerspectiveCamera(35, 1280 / 720, .1, 220);
const cards = Object.fromEntries(['power', 'efficiency', 'yield'].map(id => [id, {
  style: { setProperty(key, value) { this[key] = value; } }, inert: true,
}]));
const overlay = { style: {}, inert: true,
  querySelector: selector => cards[selector.match(/data-panel-anchor="(\w+)"/)[1]],
};
const specs = createSolarSpecs(overlay, garden.panel, camera);
let lastSpecState;
function frame(progress, preset = settings, time = 0, show = true, pointer = null, reducedMotion = false) {
  garden.setControls(preset);
  const pose = getPose(progress, false, preset.gardenCamera);
  camera.position.copy(pose.landPosition); camera.lookAt(pose.landTarget);
  camera.fov = pose.landFov; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  garden.update(time, progress, reducedMotion, pointer);
  const cameraFinish = Math.max(preset.gardenCamera.moveStart, preset.gardenCamera.moveEnd) / 100;
  lastSpecState = specs.update(progress, 1280, 720, show, cameraFinish);
  assert.equal(lastSpecState.revealStart, Math.max(garden.panelRig.userData.descentRange[1], cameraFinish) + .04,
    'Product copy shares the actual editable card timing');
  assert.equal(lastSpecState.visible, !overlay.inert, 'Returned visibility agrees with the accessible card overlay');
  assert.equal(lastSpecState.visible, Object.values(cards).some(card => !card.inert),
    'Product copy cannot appear unless at least one real panel card is visible');
  for (const card of Object.values(cards)) {
    assert(Number.isFinite(parseFloat(card.style.left)) && Number.isFinite(parseFloat(card.style.top)));
  }
  return Object.values(cards).map(card => Number(card.style['--card-reveal']));
}
const hidden = [0, 0, 0], shown = [1, 1, 1];
for (const progress of [.52, .70, .84, .88, .90, .92]) {
  assert.deepEqual(frame(progress), hidden, 'No card appears during descent, camera retreat, or the following pause');
  assert.equal(lastSpecState.visible, false, 'Final product copy stays hidden throughout the earlier garden stages');
}
assert.deepEqual(frame(.92, settings, 120), hidden, 'Waiting without further scrolling cannot reveal cards');
const beginning = frame(.94);
assert(beginning[0] > 0 && beginning[0] < 1);
assert.deepEqual(beginning.slice(1), [0, 0], 'Side entries are staggered');
const readyPose = getPose(.92), readyPanel = garden.panelRig.position.toArray();
const snapshots = [];
for (let index = 0; index <= 20; index++) {
  const progress = .92 + (JOURNEY_SCROLL_END - .92) * index / 20;
  const values = frame(progress);
  assert.deepEqual(garden.panelRig.position.toArray(), readyPanel, 'The panel stays settled while cards reveal');
  assert.deepEqual(getPose(progress).landPosition.toArray(), readyPose.landPosition.toArray(), 'The camera stays settled');
  if (snapshots.length) values.forEach((value, i) => assert(value >= snapshots.at(-1).values[i]));
  snapshots.push({ progress, values, state: { ...lastSpecState } });
}
assert.deepEqual(frame(JOURNEY_SCROLL_END), shown);
assert.equal(lastSpecState.visible, true, 'The final product narrative can appear with the panel cards');
for (const { progress, values, state } of snapshots.reverse()) {
  assert.deepEqual(frame(progress, settings, 500), values, 'Reverse scrolling retraces the same card visibility');
  assert.deepEqual(lastSpecState, state, 'Reverse scrolling retraces the same product narrative timing');
}
assert.deepEqual(frame(.90), hidden);

const latest = structuredClone(settings);
latest.gardenPanel.descentEnd = 100;
latest.gardenCamera.moveEnd = 100;
assert.deepEqual(frame(1.04, latest), hidden, 'A saved 100% finish still has a panel-only interval');
assert.equal(lastSpecState.visible, false);
assert.equal(lastSpecState.revealStart, 1.04, 'Product copy waits for the latest saved panel and camera finish');
assert.deepEqual(frame(JOURNEY_SCROLL_END, latest), shown, 'The latest allowed panel and camera timing leaves enough scroll for all cards');
assert.equal(lastSpecState.visible, true);
assert.deepEqual(frame(JOURNEY_SCROLL_END, latest, 0, false), hidden, 'Cards hide over the closing section');
assert.equal(lastSpecState.visible, false, 'Product copy also hides when the closing section covers the scene');

// Cursor tilt changes the real module, its projected cards and reflected pose.
const authored = structuredClone(settings);
Object.assign(authored.gardenPanel, {tiltX:8, rotation:-12, tiltZ:3});
frame(JOURNEY_SCROLL_END, authored);
const baseRotation=garden.panelRig.quaternion.clone(),basePosition=garden.panelRig.position.clone(),baseScale=garden.panelRig.scale.clone();
const neutralCards=Object.values(cards).map(card => [card.style.left,card.style.top]);
const poses=[];
for (const pointer of [{x:1,y:1},{x:-1,y:-1},{x:1,y:-1},{x:-1,y:1}]) {
  assert.deepEqual(frame(JOURNEY_SCROLL_END, authored, 0, true, pointer), shown, 'All cards remain visible while the module tilts');
  const rotation=garden.panelRig.quaternion.clone();
  assert(rotation.angleTo(baseRotation)>.45 && rotation.angleTo(baseRotation)<.65, 'Cursor tilt is pronounced and bounded');
  assert.deepEqual(garden.panelRig.position,basePosition,'Cursor tilt preserves the saved panel position');
  assert.deepEqual(garden.panelRig.scale,baseScale,'Cursor tilt preserves the saved panel size');
  assert.notDeepEqual(Object.values(cards).map(card => [card.style.left,card.style.top]),neutralCards,'Cards track the tilted module');
  garden.update(120,JOURNEY_SCROLL_END,false,pointer);
  assert(rotation.angleTo(garden.panelRig.quaternion)<1e-7,'Holding the cursor does not accumulate rotation');
  poses.push(rotation);
}
assert(poses[0].angleTo(poses[1])>.85,'Opposite cursor corners produce a broad, visible sweep');
frame(JOURNEY_SCROLL_END, authored, 0, true, {x:1,y:1}, true);
assert(baseRotation.angleTo(garden.panelRig.quaternion)<1e-7,'Reduced motion keeps the authored orientation');
frame(JOURNEY_SCROLL_END, authored);
assert(baseRotation.angleTo(garden.panelRig.quaternion)<1e-7,'Leaving the scene restores the authored orientation');
assert.deepEqual(settings,createDefaultSceneSettings(),'Pointer interaction never modifies saved settings');
console.log(JSON.stringify({ ok: true, checks: ['no cards during panel/camera motion', 'scroll-only pause and staggered reveal', 'settled panel and camera', 'deterministic reverse scroll', 'shared product narrative timing and visibility', '100% saved timing remains supported', 'closing visibility and finite projection', 'four-way cursor tilt and attached cards', 'authored transforms preserved', 'bounded non-accumulating tilt', 'neutral return and reduced motion'] }, null, 2));
