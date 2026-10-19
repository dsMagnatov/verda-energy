import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createFloatingRocks } from '../src/rocks.js';
import { createSolarGarden, gardenHeight, isGardenPlantable } from '../src/solar-garden.js';
import { config } from '../src/config.js';
import { createTimeline, getPose } from '../src/journey.js';

// Only moss texture generation needs Canvas; geometry and placement run in Node.
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {},
}) }) };
const uniforms = {
  time: { value: 0 }, pointerWorld: { value: new THREE.Vector3(1e5, 0, 1e5) },
  pointerActive: { value: 0 }, pointerRayOrigin: { value: new THREE.Vector3() },
  pointerRayDirection: { value: new THREE.Vector3(0, 0, -1) }, pointerPresence: { value: 0 },
  pointerScreen: { value: new THREE.Vector2(-2, -2) }, renderResolution: { value: new THREE.Vector2(1920, 1080) },
};
const material = new THREE.MeshStandardMaterial();
let start = performance.now();
const rocks = createFloatingRocks(material, uniforms);
const rockBuildMs = performance.now() - start;
start = performance.now();
// Garden placement needs a valid unit-height fern geometry, while the separate
// hero decoration checks validate the complete shipped scans and leaf masks.
const fernTemplate = new THREE.Mesh(new THREE.PlaneGeometry(.7, 1).translate(0, .5, 0), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
fernTemplate.customDepthMaterial = new THREE.MeshDepthMaterial();
fernTemplate.customDistanceMaterial = new THREE.MeshDistanceMaterial();
const garden = createSolarGarden({ uniforms, stoneMaterial: material, fernTemplates: [fernTemplate] });
const gardenBuildMs = performance.now() - start;
function inspect(root) {
  const draws = [], geometries = new Set();
  let submittedTriangles = 0;
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
      assert(Array.from(attribute.array).every(Number.isFinite), `${mesh.name}: finite ${name}`);
    }
    if (mesh.instanceMatrix) assert(Array.from(mesh.instanceMatrix.array).every(Number.isFinite), `${mesh.name}: finite transforms`);
    const triangles = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1);
    submittedTriangles += triangles;
    draws.push({ name: mesh.name, instances: mesh.isInstancedMesh ? mesh.count : 1, triangles });
  });
  return { meshes: draws.length, uniqueGeometries: geometries.size, submittedTriangles, draws };
}
const rockStats = inspect(rocks.group), gardenStats = inspect(garden.group);
assert(rocks.satellites.length >= 8, 'the opening has a substantial field of companion rocks');
assert(rocks.satellites.every(({mesh}) => mesh.material === rocks.main.children[0].material), 'all floating rocks use the same dark stone');
assert.equal(rocks.decorations.solarPanel.parent, rocks.main.children[0], 'the solar assembly is fixed to the main rock');
assert(rocks.foreground.length>=3 && rocks.foreground.every(({mesh,settings})=>settings.position[2]>2 && mesh.scale.x>=1), 'several large boulders sit closer to the camera');
const nearRock=rocks.foreground[0].mesh;
const farRock=rocks.satellites.reduce((far,item)=>item.settings.position[2]<far.settings.position[2]?item:far).mesh;
const mouse={pointer:new THREE.Vector2(1,.7),presence:1,strength:1};
rocks.update(0,0,false,mouse);
const nearRight=nearRock.position.clone(),farRight=farRock.position.clone();
mouse.pointer.x=-1;
rocks.update(0,0,false,mouse);
assert(nearRight.distanceTo(nearRock.position)>farRight.distanceTo(farRock.position)*3, 'foreground parallax is stronger than distant motion');
rocks.update(0,0,true,mouse);
const reducedPose=nearRock.position.clone();
mouse.pointer.set(1,-1);
rocks.update(0,0,true,mouse);
assert(reducedPose.equals(nearRock.position), 'reduced-motion mode ignores pointer movement');
rocks.update(0,0,false);
const neutralRockRotation=rocks.main.quaternion.clone();
const panelLocalPose=rocks.decorations.solarPanel.matrix.clone();
for (const [x,y] of [[1,1],[-1,-1],[1,-1],[-1,1]]) {
  mouse.pointer.set(x,y);
  rocks.update(0,0,false,mouse);rocks.group.updateMatrixWorld(true);
  const tilt=rocks.main.quaternion.angleTo(neutralRockRotation);
  assert(tilt>.3 && tilt<.5,'The central stone tilts visibly in every cursor corner');
  assert.deepEqual(rocks.decorations.solarPanel.matrix,panelLocalPose,'The panel stays fitted to the tilting stone');
  const heldRotation=rocks.main.quaternion.clone();
  rocks.update(120,0,false,mouse);
  assert(heldRotation.angleTo(rocks.main.quaternion)<1e-7,'Holding the cursor never accumulates stone rotation');
}
rocks.update(0,0,true,mouse);
assert(neutralRockRotation.angleTo(rocks.main.quaternion)<1e-7,'Reduced motion restores the central stone orientation');
for (const t of [0, 10, 500, 3600]) {
  rocks.update(t, .8, false); garden.update(t, .8, false);
  assert(rocks.main.position.toArray().every(Number.isFinite));
  assert(rocks.satellites.every(({ mesh }) => mesh.position.toArray().every(Number.isFinite)));
}
const daily = config.data.powerSamples.slice(1).reduce((energy, p, i) => energy + (p + config.data.powerSamples[i]) / 2 * 4, 0);
assert(Math.abs(daily - config.data.dailyMWh) < 1e-9);
let lastAperture = 0;
let lastGardenY = 0, lastGardenZ = 0, lastGardenTargetY = 0;
const referenceRange = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
for(let index = 0; index <= 1000; index++) {
  const p = index / 1000, pose = getPose(p);
  assert(Object.values(pose).filter(v => v?.isVector3).every(v => v.toArray().every(Number.isFinite)));
  assert(pose.aperture >= lastAperture, 'aperture moves continuously forward');
  assert(pose.landPosition.y - gardenHeight(pose.landPosition.x, pose.landPosition.z) > 1, 'garden camera clears the path terrain');
  const push = referenceRange(.12, .39, p);
  assert.deepEqual(pose.introPosition.toArray(), [.5, 1.9 - push * 1.2, 12.7 - push * 9.2], 'First-scene camera remains exact');
  assert.deepEqual(pose.introTarget.toArray(), [.5, .15 + push * .3, 0], 'First-scene target remains exact');
  assert.equal(pose.rockTurn, push, 'First-scene rock turn remains exact');
  assert.equal(getPose(p, true).rockTurn, .35 * push, 'Reduced-motion rock turn remains exact');
  assert.equal(pose.aperture, referenceRange(.285, .455, p), 'Original aperture timing remains exact');
  assert.equal(pose.landPosition.x, 0, 'Garden retreat remains centered on the path and portrait module');
  assert.equal(pose.landTarget.x, 0);
  assert.equal(pose.landTarget.z, -3.5, 'Garden view remains aimed at the pond');
  assert(pose.landPosition.y >= lastGardenY && pose.landPosition.z >= lastGardenZ && pose.landTarget.y >= lastGardenTargetY,
    'Garden camera rises and backs away smoothly without an orbit or forward reversal');
  assert.deepEqual(getPose(p), getPose(p), 'pose is deterministic on reverse scroll');
  lastAperture = pose.aperture;
  lastGardenY = pose.landPosition.y; lastGardenZ = pose.landPosition.z; lastGardenTargetY = pose.landTarget.y;
}
for (const p of [0, .285, .455, .46, .49]) {
  assert.deepEqual(getPose(p).landPosition.toArray(), [0, 1.55, 6.5], 'The opening garden reveal is a low walk down the path');
  assert.deepEqual(getPose(p).landTarget.toArray(), [0, .25, -3.5]);
}
for (const p of [.88, .95, 1]) {
  assert.deepEqual(getPose(p).landPosition.toArray(), [0, 2.8, 18]);
  assert.deepEqual(getPose(p).landTarget.toArray(), [0, 3.4, -3.5]);
}

// Exercise the original scroll normalization and damping through the public
// timeline API so a new camera composition cannot alter first-scene pacing.
const canvasDocument = globalThis.document;
const timelineListeners = new Map();
let scrolledTo, reducedTimeline = false;
globalThis.document = { documentElement:{style:{setProperty(){}}}, querySelector: selector => { assert.equal(selector, '#journey'); return { offsetHeight: 10100 }; } };
globalThis.window = {
  scrollY: 0, innerHeight: 1000, innerWidth: 1280,
  addEventListener: (name, callback) => timelineListeners.set(name, callback),
  matchMedia: () => ({ matches: reducedTimeline }),
  scrollTo: value => { scrolledTo = value; },
};
const timeline = createTimeline();
window.scrollY = 3500; timelineListeners.get('scroll')();
assert.equal(timeline.read(.1, false), .5 * (1 - Math.exp(-.1 * 7)), 'The original damping rate is exactly 7');
assert.equal(timeline.read(.1, true), .5, 'Reduced motion reads exact normalized scroll height');
window.scrollY = 14000; timelineListeners.get('resize')();
assert.equal(timeline.read(.1, true), 1.3, 'The extra card stage is included before scroll progress clamps');
window.scrollY = -100; timelineListeners.get('scroll')();
assert.equal(timeline.read(.1, true), 0, 'Scroll normalization clamps below the journey');
timeline.jump(.25); assert.deepEqual(scrolledTo, { top: 1750, behavior: 'smooth' });
reducedTimeline = true; timeline.jump(.75); assert.deepEqual(scrolledTo, { top: 5250, behavior: 'instant' });
timeline.jump(1.26); assert.deepEqual(scrolledTo, { top: 8820, behavior: 'instant' }, 'The impact navigation reaches the later card stage');
globalThis.document = canvasDocument;
delete globalThis.window;

assert.equal(Object.hasOwn(garden, 'turbine'), false, 'The garden exposes no previous turbine compatibility object');
const gardenNames = [];
garden.group.traverse(object => gardenNames.push(object.name));
assert(gardenNames.every(name => !/turbine/i.test(name)), 'The replacement environment contains no wind turbine');
assert.deepEqual(garden.pond.userData.center, [0, .02, -3.5]);
assert.deepEqual(garden.pond.userData.radii, [4.8, 3.6]);
assert.equal(garden.pond.userData.waterSurface, true);
garden.group.updateMatrixWorld(true);
const pondBounds = new THREE.Box3().setFromObject(garden.pond);
const pondSize = pondBounds.getSize(new THREE.Vector3());
assert(Math.abs(pondSize.x - 9.6) < 1e-5 && Math.abs(pondSize.z - 7.2) < 1e-5 && pondSize.y < 1e-5,
  'The actual water mesh is a level oval with the intended footprint');
const basinRay = new THREE.Raycaster(new THREE.Vector3(0, 10, -3.5), new THREE.Vector3(0, -1, 0));
const basin = basinRay.intersectObject(garden.ground)[0];
assert(basin && basin.point.y < -.3 && basin.point.y < pondBounds.min.y - .3,
  'The real terrain is recessed below the water rather than covering the pond');
assert.equal(isGardenPlantable(0, -3.5), false, 'No greenery is planted in the pond center');
for (const z of [3, 5, 7, 9]) assert.equal(isGardenPlantable(0, z), false, 'The central approach stays clear for the path');
const plantedSides = { left: 0, right: 0 };
const plantMatrix = new THREE.Matrix4(), plantPosition = new THREE.Vector3(), plantScale = new THREE.Vector3();
let plantingRootsChecked = 0;
for (const mesh of garden.vegetation.group.children) {
  assert(mesh.isInstancedMesh, 'Dense banks batch shared grass and scan geometry');
  assert.equal(mesh.userData.gardenPlant, true, 'Every vegetation batch identifies its rooted garden instances');
  assert(['grass', 'fern'].includes(mesh.userData.gardenPlantType), 'Plant batches retain their grass or fern identity');
  for (let index = 0; index < mesh.count; index++) {
    mesh.getMatrixAt(index, plantMatrix);
    plantPosition.setFromMatrixPosition(plantMatrix).applyMatrix4(mesh.matrixWorld);
    plantScale.setFromMatrixScale(plantMatrix);
    assert(isGardenPlantable(plantPosition.x, plantPosition.z), 'Every actual grass and fern root stays off the pond and walking stones');
    assert(Math.abs(plantPosition.y - (gardenHeight(plantPosition.x, plantPosition.z) - .006)) < 1e-6,
      'Every plant root sits on the real garden terrain');
    if (mesh.userData.gardenPlantType === 'grass') assert(plantScale.y >= .079 && plantScale.y < .29, 'Grass remains short beside the low walking view');
    if (mesh.userData.gardenPlantType === 'fern') assert(plantScale.y >= .44 && plantScale.y < 1.21, 'Fern height preserves visibility over the banks');
    plantedSides[plantPosition.x < 0 ? 'left' : 'right']++;
    plantingRootsChecked++;
  }
}
assert(garden.counts.grassClusters >= 26000 && garden.counts.ferns >= 60, 'Both sides of the path have continuous dense grass and substantial scanned fern banks');
assert(plantedSides.left > 1000 && plantedSides.right > 1000, 'Greenery surrounds both sides of the approach');
assert.equal(garden.panel.parent, garden.panelRig, 'The portrait module has one reusable descent rig');
assert.deepEqual(garden.panelRig.userData.descentRange, [.55, .84]);
assert.deepEqual(garden.panelRig.userData.finalCenter, [0, 3.4, -3.5]);
assert.equal(garden.panelRig.userData.portraitHeight, 6.6);
assert.equal(garden.panelRig.userData.portraitWidth, 3.3);
garden.update(0, .46, false);
assert.equal(garden.panelRig.visible, false, 'The initial path-and-pond view precedes the descending module');
const gardenReferences = [];
garden.group.traverse(object => {
  if (object.isMesh) gardenReferences.push([object, object.geometry, object.material, object.instanceMatrix]);
});
const descentPoses = new Map();
let previousPanelY = Infinity;
for (let index = 0; index <= 100; index++) {
  const p = .55 + (.84 - .55) * index / 100;
  garden.update(index / 10, p, false); garden.group.updateMatrixWorld(true);
  const center = garden.panelRig.getWorldPosition(new THREE.Vector3());
  assert(center.toArray().every(Number.isFinite));
  assert(center.y <= previousPanelY + 1e-10, 'The module descends continuously as the camera backs away');
  assert.equal(center.x, 0); assert.equal(center.z, -3.5, 'Descent remains centered above the pond');
  descentPoses.set(p, garden.panelRig.matrixWorld.toArray());
  previousPanelY = center.y;
}
for (const [p, matrix] of [...descentPoses].reverse()) {
  garden.update(1000, p, false); garden.group.updateMatrixWorld(true);
  assert.deepEqual(garden.panelRig.matrixWorld.toArray(), matrix, 'Reverse scroll exactly retraces the descent without time-driven drift');
  garden.update(5000, p, true); garden.group.updateMatrixWorld(true);
  assert.deepEqual(garden.panelRig.matrixWorld.toArray(), matrix, 'Reduced motion preserves the same scroll-selected module placement');
}
garden.update(0, .84, true); garden.group.updateMatrixWorld(true);
const panelBounds = new THREE.Box3().setFromObject(garden.panel);
const panelSize = panelBounds.getSize(new THREE.Vector3());
assert(panelSize.y > panelSize.x * 1.8, 'The actual module geometry stands in portrait orientation');
assert(Math.abs(panelSize.y - 6.6) < .12 && Math.abs(panelSize.x - 3.3) < .12,
  'The actual portrait silhouette matches the intended six-point-six by three-point-three size');
assert(panelBounds.min.y > .06 && panelBounds.min.y < .16, 'The module bottom hovers just above the pond');
assert(panelBounds.min.y > garden.pond.userData.center[1], 'The final module never intersects the water surface');
const finalCamera = new THREE.PerspectiveCamera(getPose(1).landFov, 16 / 9, .1, 220);
finalCamera.position.copy(getPose(1).landPosition); finalCamera.lookAt(getPose(1).landTarget); finalCamera.updateMatrixWorld(true);
const projectedPanelBounds = new THREE.Box2();
for (const x of [panelBounds.min.x, panelBounds.max.x]) for (const y of [panelBounds.min.y, panelBounds.max.y]) for (const z of [panelBounds.min.z, panelBounds.max.z]) {
  const projected = new THREE.Vector3(x, y, z).project(finalCamera);
  projectedPanelBounds.expandByPoint(new THREE.Vector2(projected.x, projected.y));
  assert(Math.abs(projected.x) < .92 && Math.abs(projected.y) < .92 && projected.z > -1 && projected.z < 1,
    'The final centered garden camera frames the whole portrait module with margin');
}
const finalPanelViewportHeight = projectedPanelBounds.getSize(new THREE.Vector2()).y / 2;
assert(finalPanelViewportHeight > .43 && finalPanelViewportHeight < .6, 'The final module occupies about half the viewport height');
for (const [object, geometry, surface, matrix] of gardenReferences) {
  assert.equal(object.geometry, geometry, 'Scroll updates retain garden geometry');
  assert.equal(object.material, surface, 'Scroll updates retain garden materials');
  assert.equal(object.instanceMatrix, matrix, 'Scroll updates retain planting instance buffers');
}
const gardenGeometryChecks = { pondCentered: true, pathClear: true, portraitSize: panelSize.toArray(),
  finalBottom: panelBounds.min.y, descentSamples: descentPoses.size, reverseAndReducedMotionDeterministic: true,
  plantingRootsChecked, plantedSides, actualRecessedBasin: true, geometryAndBuffersReused: true, finalModuleFramed: true,
  finalPanelViewportHeight };
const manifest = JSON.parse(readFileSync(new URL('../docs/polyhaven-files.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const fileChecks = [['Diffuse', '2k'], ['nor_gl', '2k'], ['Rough', '1k'], ['Displacement', '2k']].map(([kind, size]) => {
  const entry = manifest[kind][size].jpg, filename = entry.url.split('/').at(-1);
  const bytes = readFileSync(new URL(`../public/assets/dark-rock/${filename}`, import.meta.url));
  assert.equal(createHash('md5').update(bytes).digest('hex'), entry.md5);
  return { filename, bytes: bytes.length, md5Verified: true };
});
const natureDownloads = JSON.parse(readFileSync(new URL('../docs/nature-downloads.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
for (const asset of natureDownloads) for (const file of asset.files) {
  const bytes = readFileSync(new URL(`../${file.path}`, import.meta.url));
  assert.equal(bytes.length, file.bytes, `${file.path}: complete asset`);
  assert.equal(createHash('md5').update(bytes).digest('hex'), file.md5, `${file.path}: source checksum`);
}
console.log(JSON.stringify({ rockBuildMs: +rockBuildMs.toFixed(1), gardenBuildMs: +gardenBuildMs.toFixed(1), rockStats, gardenStats, gardenGeometryChecks, cameraSamples: 1001, firstScenePreserved: true, timelineDamping: 7, dailyMWh: daily, fileChecks }, null, 2));
