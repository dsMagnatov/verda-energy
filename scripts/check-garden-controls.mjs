import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSolarGarden } from '../src/solar-garden.js';
import { getPose } from '../src/journey.js';
import { createDefaultSceneSettings, SCENE_CONTROL_GROUPS } from '../src/scene-settings.js';

const defaults = createDefaultSceneSettings();
const originalDefaults = structuredClone(defaults);
const group = id => SCENE_CONTROL_GROUPS.find(item => item.id === id);
const close = (actual, expected, message, tolerance = 1e-7) => assert(Math.abs(actual - expected) < tolerance, `${message}: ${actual} ≠ ${expected}`);
const serializeUniforms = uniforms => Object.fromEntries(Object.entries(uniforms).filter(([, { value }]) =>
  typeof value === 'number' || value?.isColor).map(([name, { value }]) => [name, typeof value === 'number' ? value : value.toArray()]));
const bounds = object => {
  const box = new THREE.Box3().setFromObject(object);
  return [box.min.toArray(), box.max.toArray()];
};
function compile(material) {
  const source = THREE.ShaderLib.standard;
  const shader = { vertexShader: source.vertexShader, fragmentShader: source.fragmentShader, uniforms: THREE.UniformsUtils.clone(source.uniforms) };
  material.onBeforeCompile(shader);
  return shader;
}
function finiteScene(root) {
  root.updateMatrixWorld(true);
  root.traverse(object => {
    assert(object.matrixWorld.elements.every(Number.isFinite), `${object.name}: finite matrix`);
    if (!object.isMesh) return;
    for (const [name, attribute] of Object.entries(object.geometry.attributes)) assert(attribute.array.every(Number.isFinite), `${object.name}: finite ${name}`);
    if (object.instanceMatrix) assert(object.instanceMatrix.array.every(Number.isFinite), `${object.name}: finite instances`);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(serializeUniforms(material.uniforms || {}))) {
        assert((Array.isArray(value) ? value : [value]).every(Number.isFinite), `${object.name}: finite material values`);
      }
    }
  });
}

// Project actual scene landmarks through the camera, rather than testing only
// editor state: every camera slider must change the resulting view or lens.
function cameraView(values, progress) {
  const pose = getPose(progress, false, values);
  const camera = new THREE.PerspectiveCamera(pose.landFov, 16 / 9, .1, 220);
  camera.position.copy(pose.landPosition); camera.lookAt(pose.landTarget); camera.updateMatrixWorld(true);
  return { view: camera.matrixWorldInverse.toArray(), projection: camera.projectionMatrix.toArray(),
    landmarks: [[0, .02, -3.5], [2, 3.4, -3.5], [-4, .2, 3]].map(point => new THREE.Vector3(...point).project(camera).toArray()) };
}
let cameraControlsChecked = 0;
for (const control of group('gardenCamera').controls) {
  const progress = control.key.startsWith('start') ? .46 : control.key.startsWith('move') ? .65 : 1;
  const views = [control.min, control.max].map(value => cameraView({ ...defaults.gardenCamera, [control.key]: value }, progress));
  assert.notDeepEqual(views[0], views[1], `Camera ${control.key} changes the actual view/projection`);
  for (const value of [control.min, control.max]) for (const p of [0, .2, .36, .5, .7, 1]) {
    const before = getPose(p), after = getPose(p, false, { ...defaults.gardenCamera, [control.key]: value });
    assert.deepEqual(after.introPosition, before.introPosition, 'Garden camera edits preserve the exact first-scene camera');
    assert.deepEqual(after.introTarget, before.introTarget);
    assert.equal(after.rockTurn, before.rockTurn); assert.equal(after.aperture, before.aperture);
  }
  cameraControlsChecked++;
}
for (const timing of [{ moveStart: 80, moveEnd: 55 }, { moveStart: 60, moveEnd: 60 }]) {
  for (let index = 0; index <= 100; index++) {
    const p = index / 100, pose = getPose(p, false, timing);
    assert(pose.landPosition.toArray().every(Number.isFinite) && pose.landTarget.toArray().every(Number.isFinite));
    assert.deepEqual(getPose(p, false, timing), pose, 'Reversed/equal camera timing remains reversible and deterministic');
    assert.deepEqual(getPose(p, true, timing).landPosition, pose.landPosition, 'Reduced motion preserves scroll-selected camera placement');
  }
}
for (const bad of [NaN, Infinity, -Infinity, null, '5']) {
  const invalid = Object.fromEntries(group('gardenCamera').controls.map(control => [control.key, bad]));
  assert.deepEqual(getPose(.7, false, invalid), getPose(.7), 'Invalid camera values preserve the default composition');
}

const fernTemplate = new THREE.Mesh(new THREE.PlaneGeometry(.7, 1).translate(0, .5, 0), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
fernTemplate.customDepthMaterial = new THREE.MeshDepthMaterial();
fernTemplate.customDistanceMaterial = new THREE.MeshDistanceMaterial();
const garden = createSolarGarden({ fernTemplates: [fernTemplate], uniforms: { time: { value: 0 } } });
garden.setControls(defaults); garden.update(0, .7, true);
const baseRoomGeometries = () => [garden.room.wall.geometry, garden.room.roof.geometry, garden.room.floor.geometry];
const roomStructure = () => ({ wall: bounds(garden.room.wall), roof: bounds(garden.room.roof), floor: bounds(garden.room.floor) });
const panelView = () => {
  garden.group.updateMatrixWorld(true);
  return { world: garden.panel.matrixWorld.toArray(), box: bounds(garden.panel), visible: garden.panelRig.visible };
};
const panelBase = panelView();
const panelGeometry = garden.panel.children.map(object => object.geometry);
const untouchedRoom = baseRoomGeometries();
const untouchedGround = garden.ground.geometry;
const untouchedWater = serializeUniforms(garden.pond.material.uniforms);
let panelControlsChecked = 0;
for (const control of group('gardenPanel').controls) {
  const views = [control.min, control.max].map(value => {
    garden.setControls(defaults);
    garden.setControls({ gardenPanel: { [control.key]: value } }); garden.update(0, .7, true);
    return panelView();
  });
  assert.notDeepEqual(views[0], views[1], `Panel ${control.key} changes actual geometry placement or scroll timing`);
  assert.deepEqual(baseRoomGeometries(), untouchedRoom, 'Panel edits preserve room geometry');
  assert.equal(garden.ground.geometry, untouchedGround);
  assert.deepEqual(serializeUniforms(garden.pond.material.uniforms), untouchedWater, 'Panel edits preserve water appearance');
  panelControlsChecked++;
}
const panelPreset = { scale: 1.2, width: .8, height: 1.1, positionX: 1, positionY: .3, positionZ: -.2,
  tiltX: 10, tiltZ: -8, rotation: 17, descentStart: 60, descentEnd: 90, startHeight: 18 };
garden.setControls({ gardenPanel: panelPreset }); garden.update(2, .75, false);
const panelEdited = panelView();
for (let index = 0; index < 12; index++) {
  garden.setControls({ gardenPanel: panelPreset }); garden.update(100, .75, false);
  assert.deepEqual(panelView(), panelEdited, 'Repeated transform/timing edits never accumulate onto the previous panel pose');
}
for (const timing of [{ descentStart: 95, descentEnd: 50 }, { descentStart: 70, descentEnd: 70 }]) {
  garden.setControls({ gardenPanel: { ...defaults.gardenPanel, ...timing } });
  const poses = new Map();
  for (let index = 0; index <= 100; index++) {
    const p = index / 100; garden.update(0, p, true);
    const view = panelView(); assert(view.world.every(Number.isFinite)); poses.set(p, view);
  }
  for (const [p, view] of [...poses].reverse()) {
    garden.update(500, p, false); assert.deepEqual(panelView(), view, 'Equal/reversed panel timing retraces exact scroll positions');
  }
}
garden.setControls(defaults); garden.update(0, .7, true);
assert.deepEqual(panelView(), panelBase, 'Panel defaults restore exact authored placement');
garden.panel.children.forEach((object, index) => assert.equal(object.geometry, panelGeometry[index], 'Panel controls retain authored geometry'));

const water = garden.pond.material, waterRefs = { ...water.uniforms };
assert(water.transparent && !water.depthWrite, 'Water uses actual transparent blending without blocking its basin');
assert(water.uniforms.basinMap.value?.isDataTexture, 'Transparency can reveal the generated recessed basin texture');
for (const control of group('gardenWater').controls) {
  garden.setControls(defaults);
  const values = control.type === 'color' ? ['#ffffff', '#235a8c'] : [control.min, control.max];
  const states = values.map(value => {
    garden.setControls({ gardenWater: { [control.key]: value } });
    return serializeUniforms(water.uniforms);
  });
  assert.notDeepEqual(states[0], states[1], `Water ${control.key} reaches the rendered shader`);
  assert(water.fragmentShader.split(new RegExp(`\\b${control.key === 'color' ? 'color' : control.key}\\b`)).length >= 3,
    `Water ${control.key} is consumed by its shader, beyond declaration`);
}
assert.match(water.fragmentShader, /surfaceAlpha[\s\S]*transparency/);
assert.match(water.fragmentShader, /gl_FragColor\s*=\s*vec4\([^;]*surfaceAlpha/);
assert.match(water.fragmentShader, /texture2D\(basinMap/);
for (const [key, reference] of Object.entries(waterRefs)) assert.equal(water.uniforms[key], reference, 'Live water controls retain uniform identities');

garden.setControls(defaults);
const ground = garden.ground.material, groundShader = compile(ground), groundVersion = ground.version;
const groundView = () => ({ color: ground.color.toArray(), roughness: ground.roughness, bumpScale: ground.bumpScale,
  repeat: ground.map.repeat.toArray(), shader: serializeUniforms(groundShader.uniforms) });
const groundBase = groundView();
for (const control of group('gardenGround').controls) {
  const states = (control.type === 'color' ? ['#ffffff', '#75a047'] : [control.min, control.max]).map(value => {
    garden.setControls(defaults); garden.setControls({ gardenGround: { [control.key]: value } }); return groundView();
  });
  assert.notDeepEqual(states[0], states[1], `Ground ${control.key} changes its physical material, UVs or compiled shader`);
  assert.equal(garden.ground.geometry, untouchedGround, 'Ground appearance edits retain the terrain/basin geometry');
}
for (const [key, reference] of Object.entries(ground.userData.groundControls)) {
  const uniform = `uGround${key[0].toUpperCase()}${key.slice(1)}`;
  assert.equal(groundShader.uniforms[uniform], reference);
  assert(groundShader.fragmentShader.split(uniform).length >= 3, `${uniform} is consumed by the compiled ground shader`);
}
garden.setControls(defaults); assert.deepEqual(groundView(), groundBase);
assert.equal(ground.version, groundVersion, 'Ground controls update the existing shader without recompilation');

const room = garden.room, roomShader = compile(room.material);
function roofHit(x, z = -3.5) {
  garden.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, 1, 0));
  return ray.intersectObject(room.roof)[0]?.point.y ?? null;
}
function roomView() {
  return { bounds: roomStructure(), ceiling: [[0, -3.5], [6, -3.5], [12, -3.5], [0, -12.5], [0, 6]].map(([x, z]) => roofHit(x, z)),
    color: room.material.color.toArray(), roughness: room.material.roughness, bump: room.material.bumpScale,
    uv: room.material.bumpMap.repeat.toArray(), shader: serializeUniforms(roomShader.uniforms) };
}
const roomBase = roomView();
for (let index = 0; index < 24; index++) {
  const angle = index / 24 * Math.PI * 2;
  assert.equal(roofHit(Math.cos(angle) * 10.5 * .85, -3.5 + Math.sin(angle) * 7.8 * .85), null,
    'Real triangle raycasts pass through the empty oval ceiling opening');
}
assert.equal(roofHit(0), null, 'There is no hidden ceiling face at the center of the oculus');
assert(roofHit(12) !== null, 'The surrounding ceiling annulus is solid geometry');
close(roofHit(12), 6.5, 'The default solid ceiling starts at the revised room height');
const rearWall = new THREE.Raycaster(new THREE.Vector3(0, 2, -3.5), new THREE.Vector3(0, 0, -1)).intersectObject(room.wall);
const openFront = new THREE.Raycaster(new THREE.Vector3(0, 2, -3.5), new THREE.Vector3(0, 0, 1)).intersectObject(room.wall);
assert(rearWall.length > 0 && openFront.length === 0, 'The round room has a solid rear enclosure and an open camera-facing cutaway');
const structuralKeys = new Set(['wallHeight', 'radius', 'openingWidth', 'openingDepth', 'roofThickness']);
for (const control of group('gardenRoom').controls) {
  const states = [];
  for (const value of control.type === 'color' ? ['#ffffff', '#927e68'] : [control.min, control.max]) {
    garden.setControls(defaults);
    const before = baseRoomGeometries(), disposed = [];
    before.forEach((geometry, index) => geometry.addEventListener('dispose', () => disposed.push(index)));
    garden.setControls({ gardenRoom: { [control.key]: value } });
    const after = baseRoomGeometries();
    if (structuralKeys.has(control.key)) {
      assert(after.every((geometry, index) => geometry !== before[index]), 'A structural room edit replaces the real room meshes');
      assert.deepEqual(disposed.sort(), [0, 1, 2], 'Replaced room geometries are disposed');
    } else assert.deepEqual(after, before, 'Material-only room edits retain all room geometry');
    states.push(roomView());
    garden.setControls({ gardenRoom: { [control.key]: value } });
    assert.deepEqual(baseRoomGeometries(), after, 'Repeating the same structural value never rebuilds geometry');
  }
  assert.notDeepEqual(states[0], states[1], `Room ${control.key} changes actual geometry, openings or material`);
}
garden.setControls(defaults); assert.deepEqual(roomView(), roomBase, 'Defaults restore the physical room and its material exactly');

const vegetation = garden.vegetation;
const grass = vegetation.group.children.find(mesh => mesh.userData.gardenPlantType === 'grass');
const fernBatches = vegetation.group.children.filter(mesh => mesh.userData.gardenPlantType === 'fern');
const grassShader = compile(grass.material), grassUniforms = grass.material.userData.gardenGrassUniforms;
const baseGrassMatrices = grass.instanceMatrix.array.slice(), baseFernMatrices = fernBatches.map(mesh => mesh.instanceMatrix.array.slice());
const grassGeometry = grass.geometry, grassBuffer = grass.instanceMatrix;
const sampleMatrices = () => [0, 17, 555, 27999].map(index => Array.from(grass.instanceMatrix.array.slice(index * 16, index * 16 + 16)));
const grassView = () => ({ count: grass.count, visible: grass.visible, matrices: sampleMatrices(), color: grass.material.color.toArray(),
  roughness: grass.material.roughness, brightness: grassUniforms.brightness.value, saturation: grassUniforms.saturation.value, breeze: grassUniforms.breeze.value });
const grassBase = grassView();
for (const control of group('gardenGrass').controls) {
  const states = [];
  for (const value of control.type === 'color' ? ['#ffffff', '#738f47'] : [control.min, control.max]) {
    garden.setControls(defaults); garden.setControls({ gardenGrass: { [control.key]: value } });
    garden.update(20, 1, false);
    const beforeTime = grassUniforms.time.value;
    garden.update(20.05, 1, false);
    states.push({ ...grassView(), ...(control.key === 'speed' ? { elapsedWind: grassUniforms.time.value - beforeTime } : {}) });
    for (const index of [0, 17, 555, 27999]) for (const entry of [12, 13, 14]) {
      assert.equal(grass.instanceMatrix.array[index * 16 + entry], baseGrassMatrices[index * 16 + entry], 'Grass dimensions retain all authored ground roots');
    }
    fernBatches.forEach((mesh, index) => assert.deepEqual(mesh.instanceMatrix.array, baseFernMatrices[index], 'Grass controls preserve every fern transform'));
  }
  assert.notDeepEqual(states[0], states[1], `Grass ${control.key} changes draw count, live geometry, material or wind`);
}
vegetation.setControls({ ...defaults.gardenGrass, height: 1.7, width: 1.4, density: .35 });
const editedGrass = sampleMatrices();
for (let index = 0; index < 8; index++) {
  vegetation.setControls({ ...defaults.gardenGrass, height: 1.7, width: 1.4, density: .35 });
  assert.deepEqual(sampleMatrices(), editedGrass, 'Repeated grass edits do not accumulate scale');
}
assert.equal(grass.count, Math.round(28000 * .35), 'Density changes the submitted instance range');
vegetation.setControls({ density: 0 }); assert.equal(grass.count, 0); assert.equal(grass.visible, false);
vegetation.setControls(defaults.gardenGrass); garden.update(0, 1, true);
assert.deepEqual(grass.instanceMatrix.array, baseGrassMatrices, 'Defaults restore captured grass basis matrices exactly');
assert.deepEqual(grassView(), grassBase, 'Defaults restore grass draw range and physical appearance');
assert.equal(grass.geometry, grassGeometry); assert.equal(grass.instanceMatrix, grassBuffer);
assert.equal(grassShader.uniforms.uGardenGrassBrightness, grassUniforms.brightness);
assert.equal(grassShader.uniforms.uGardenGrassSaturation, grassUniforms.saturation);
assert.match(grassShader.fragmentShader, /uGardenGrassSaturation\)\)\s*\*\s*uGardenGrassBrightness/);
assert.equal(grassUniforms.breeze.value, 0, 'Reduced motion disables grass sway');
const frozenWind = grassUniforms.time.value;
garden.update(100, 1, true); assert.equal(grassUniforms.time.value, frozenWind, 'Reduced motion freezes integrated grass wind time');

for (const bound of ['min', 'max']) {
  const extreme = structuredClone(defaults);
  for (const id of ['gardenPanel', 'gardenWater', 'gardenGround', 'gardenRoom', 'gardenGrass']) for (const control of group(id).controls) {
    extreme[id][control.key] = control.type === 'color' ? '#abc123' : control[bound];
  }
  garden.setControls(extreme); garden.update(9999, .7, false); finiteScene(garden.group);
}
garden.setControls(defaults); garden.update(0, .7, true);
assert.deepEqual(defaults, originalDefaults, 'Runtime edits never mutate the full shared-settings input or its individual fern map');
console.log(JSON.stringify({ ok: true, cameraControlsChecked, panelControlsChecked,
  waterControlsChecked: group('gardenWater').controls.length, groundControlsChecked: group('gardenGround').controls.length,
  roomControlsChecked: group('gardenRoom').controls.length, grassControlsChecked: group('gardenGrass').controls.length,
  checks: ['actual camera landmark projections and unchanged first scene', 'reversed and equal timeline bounds',
    'independent panel transforms, no drift and exact reset', 'water shader controls and real alpha blending',
    'ground PBR, texture and compiled uniforms', 'real empty oval oculus and solid room annulus',
    'structural-only room rebuilding and disposal', 'captured grass transforms, independent ferns and density draw range',
    'wind speed, freeze and cached geometry', 'finite combined extremes and immutable shared-settings input'] }, null, 2));
