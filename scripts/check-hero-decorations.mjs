import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createFloatingRocks } from '../src/rocks.js';
import { fitRockPanel, sampleRockSurface } from '../src/rock-surface.js';
import { SCENE_CONTROL_GROUPS, createDefaultSceneSettings } from '../src/scene-settings.js';
import { FERN_INSTANCES, FERN_INSTANCE_CONTROL_KEYS } from '../src/fern-instances.js';

// Decode the shipped scan buffers directly. This intentionally avoids texture
// loaders, browser globals and a network substitute for the real geometry.
function localScan(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const gltf = JSON.parse(readFileSync(url, 'utf8'));
  const buffers = gltf.buffers.map(buffer => readFileSync(new URL(buffer.uri, url)));
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const types = {
    5120: [Int8Array, 1, 'getInt8'], 5121: [Uint8Array, 1, 'getUint8'],
    5122: [Int16Array, 2, 'getInt16'], 5123: [Uint16Array, 2, 'getUint16'],
    5125: [Uint32Array, 4, 'getUint32'], 5126: [Float32Array, 4, 'getFloat32'],
  };
  function attribute(accessorIndex) {
    const accessor = gltf.accessors[accessorIndex];
    assert(!accessor.sparse, 'The scan fixture must not silently ignore sparse accessors');
    const view = gltf.bufferViews[accessor.bufferView];
    const buffer = buffers[view.buffer];
    const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const [ArrayType, bytes, getter] = types[accessor.componentType];
    const itemSize = components[accessor.type];
    const values = new ArrayType(accessor.count * itemSize);
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? itemSize * bytes;
    for (let i = 0; i < accessor.count; i++) for (let c = 0; c < itemSize; c++) {
      values[i * itemSize + c] = data[getter](start + i * stride + c * bytes, true);
    }
    return new THREE.BufferAttribute(values, itemSize, accessor.normalized ?? false);
  }
  const nodes = gltf.nodes.map(node => {
    const object = new THREE.Group(); object.name = node.name ?? '';
    if (node.matrix) object.matrix.fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
      assert(primitive.mode === undefined || primitive.mode === 4, 'The scan fixture uses triangles');
      const geometry = new THREE.BufferGeometry();
      for (const [semantic, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) {
        if (primitive.attributes[semantic] !== undefined) geometry.setAttribute(name, attribute(primitive.attributes[semantic]));
      }
      if (primitive.indices !== undefined) geometry.setIndex(attribute(primitive.indices));
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
      mesh.name = object.name; object.add(mesh);
    }
    return object;
  });
  gltf.nodes.forEach((node, index) => node.children?.forEach(child => nodes[index].add(nodes[child])));
  const scene = new THREE.Group();
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) scene.add(nodes[index]);
  scene.updateMatrixWorld(true);
  const meshes = []; scene.traverse(object => { if (object.isMesh) meshes.push(object); });
  return meshes;
}

function rockScan(source) {
  const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const scale = 2.8 / Math.max(size.x, size.z);
  geometry.translate(-center.x, -center.y, -center.z); geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

const scan = localScan('../public/assets/nature/rock_moss_set_01/rock_moss_set_01_2k.gltf');
const mainSource = scan.find(mesh => mesh.name.endsWith('rock04'));
assert(mainSource && scan.length >= 4, 'Use the actual central scan and companion scans');
const fernTemplates = localScan('../public/assets/nature/fern_02/fern_02_2k.gltf').map(source => {
  const geometry = source.geometry.clone(); geometry.computeBoundingBox();
  const bounds = geometry.boundingBox, height = bounds.max.y - bounds.min.y;
  assert(height > 0 && geometry.attributes.position.count > 100, 'Use real fern leaf geometry');
  geometry.translate(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
  geometry.scale(1 / height, 1 / height, 1 / height); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const fern = new THREE.Mesh(geometry, source.material); fern.name = source.name;
  fern.customDepthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide, alphaTest: .5 });
  fern.customDistanceMaterial = new THREE.MeshDistanceMaterial({ side: THREE.DoubleSide, alphaTest: .5 });
  return fern;
});
const order = ['fern_02_b', 'fern_02_c', 'fern_02_a', 'fern_02_d'];
fernTemplates.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
assert.equal(fernTemplates.length, 4, 'All four scan fern variants are available');
const field = createFloatingRocks(new THREE.MeshStandardMaterial(), {}, {
  mainGeometry: rockScan(mainSource),
  satelliteGeometries: scan.filter(mesh => mesh !== mainSource).map(rockScan),
  fernTemplates,
});
field.group.updateMatrixWorld(true);
const mainRock = field.main.children.find(object => object.isMesh);
const { solarPanel, ferns, plantedRocks } = field.decorations;
const assemblies = []; field.group.traverse(object => { if (object.name === 'Surface-mounted solar panel') assemblies.push(object); });
assert.equal(assemblies.length, 1, 'Exactly one solar panel is installed');
assert.equal(solarPanel.parent, mainRock, 'Solar assembly is attached to the central rock');
assert.equal(field.satellites.length + 1, 17, 'The enlarged upper-right companion joins the complete stone field');
assert.equal(ferns.length, 9, 'All nine authored fern placements hit real rock surfaces');
assert.equal(plantedRocks.length, 4, 'Exactly four companion stones carry ferns');
assert.equal(new Set(ferns.map(fern => fern.parent)).size, 4);
assert.deepEqual(ferns.map(fern => fern.userData.fernId), FERN_INSTANCES.map(instance => instance.id),
  'Each authored root has a stable catalog ID rather than its eventual successful-hit index');
for (const instance of FERN_INSTANCES) {
  const fern = ferns.find(item => item.userData.fernId === instance.id);
  assert(fern, `${instance.id} exists exactly once`);
  assert.equal(fern.name, instance.label, 'Editor labels identify the same plants as the scene');
  assert.equal(fern.parent, field.satellites[instance.rockIndex].mesh, 'Stable IDs retain their authored parent stone');
}
for (const [index, count] of [[0, 3], [12, 3], [3, 1], [15, 2]]) {
  assert.equal(ferns.filter(fern => fern.parent === field.satellites[index].mesh).length, count,
    `Companion stone ${index} has its complete fern cluster`);
}

// Measure distance to actual triangles, rather than trusting attachment metadata.
const triangle = new THREE.Triangle(), closest = new THREE.Vector3();
function surfaceDistance(geometry, point) {
  const position = geometry.attributes.position, indices = geometry.index;
  const count = indices?.count ?? position.count;
  let minimum = Infinity;
  for (let i = 0; i < count; i += 3) {
    triangle.a.fromBufferAttribute(position, indices ? indices.getX(i) : i);
    triangle.b.fromBufferAttribute(position, indices ? indices.getX(i + 1) : i + 1);
    triangle.c.fromBufferAttribute(position, indices ? indices.getX(i + 2) : i + 2);
    triangle.closestPointToPoint(point, closest);
    minimum = Math.min(minimum, closest.distanceTo(point));
  }
  return minimum;
}
for (const fern of ferns) {
  const rock = fern.parent;
  const scale = rock.getWorldScale(new THREE.Vector3()).x;
  const rootSurface = new THREE.Vector3().fromArray(fern.userData.rootSurfaceLocal);
  assert(surfaceDistance(rock.geometry, rootSurface) < 2e-6, 'Fern anchor lies on the real scan triangle');
  assert(surfaceDistance(rock.geometry, fern.position) * scale < .013, 'Fern root is embedded by only about 12 mm');
  assert(Math.abs(fern.position.distanceTo(rootSurface) * scale - .012) < 2e-6, 'Root insertion stays constant across different stone scales');
  const growthAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(fern.getWorldQuaternion(new THREE.Quaternion()));
  assert(growthAxis.y > .8, 'Fern grows upward despite the stone authored rotation');
  assert(fern.castShadow && fern.receiveShadow, 'Ferns participate in the shared scene lighting');
  assert(fern.customDepthMaterial && fern.customDistanceMaterial, 'Leaf cutouts keep dedicated shadow materials');
}

const fit = solarPanel.userData.fit, panel = solarPanel.userData.panel;
assert.equal(fit.contacts.length, 4, 'Panel has four actual corner supports');
assert(fit.width > .8 && fit.depth > .5, 'The fitted panel remains a useful size on the central scan');
assert(fit.normal.y > 0, 'Panel front points out of the upper rock surface');
assert(new THREE.Vector3(0, 1, 0).applyQuaternion(panel.quaternion).distanceTo(fit.normal) < 1e-8);
assert(panel.position.distanceTo(fit.position) < 1e-8, 'Built panel uses the returned rock fit');
const supports = solarPanel.children.filter(object => object.name === 'Rock-fitted panel support');
assert.equal(supports.length, 4, 'Every fitted corner has a physical support');
for (const contact of fit.contacts) {
  assert(surfaceDistance(mainRock.geometry, contact.surface) < 2e-6, 'Support foot touches an actual scan triangle');
  const mount = contact.mount.clone().sub(panel.position).applyQuaternion(panel.quaternion.clone().invert());
  assert(Math.abs(mount.y) < 1e-8, 'Support reaches the panel underside plane');
  assert(Math.abs(Math.abs(mount.x) - fit.width / 2) < 1e-8);
  assert(Math.abs(Math.abs(mount.z) - fit.depth / 2) < 1e-8);
  assert(contact.mount.clone().sub(contact.surface).dot(fit.normal) >= .018 - 1e-5, 'Support retains the minimum rock clearance');
}

// Independently cast a denser grid than the fitter uses. A visually plausible
// angle alone is insufficient: every tested underside point must clear the scan.
const query = new THREE.Mesh(mainRock.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
query.matrixWorld.identity(); query.matrixAutoUpdate = false;
const raycaster = new THREE.Raycaster(), averageNormal = new THREE.Vector3();
let minClearance = Infinity, samples = 0;
for (let iz = 0; iz <= 12; iz++) for (let ix = 0; ix <= 18; ix++) {
  const underside = new THREE.Vector3((ix / 18 - .5) * fit.width, 0, (iz / 12 - .5) * fit.depth)
    .applyQuaternion(panel.quaternion).add(panel.position);
  raycaster.set(underside.clone().addScaledVector(fit.normal, 5), fit.normal.clone().negate());
  raycaster.far = 10;
  const hit = raycaster.intersectObject(query, false)[0];
  assert(hit, 'Panel underside has rock underneath across its complete footprint');
  const clearance = underside.clone().sub(hit.point).dot(fit.normal);
  assert(clearance >= .018 - 1e-5, 'Panel underside never penetrates the actual scan');
  minClearance = Math.min(minClearance, clearance);
  const normal = hit.face.normal.clone(); if (normal.y < 0) normal.negate();
  averageNormal.add(normal); samples++;
}
assert(fit.normal.dot(averageNormal.normalize()) > .85, 'Panel orientation agrees with the surrounding rock slopes');

let panelMeshes = 0, panelInstances = 0;
panel.traverse(object => {
  if (!object.isMesh) return;
  panelMeshes++;
  assert(object.geometry.attributes.position.count > 0, 'Panel has rendered geometry');
  for (const attribute of Object.values(object.geometry.attributes)) assert(Array.from(attribute.array).every(Number.isFinite), 'Panel attributes remain finite');
  if (object.instanceMatrix) {
    panelInstances += object.count;
    assert(Array.from(object.instanceMatrix.array).every(Number.isFinite), 'Panel instance transforms remain finite');
  }
  const material = object.material;
  assert(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial, 'Panel reacts to physical scene lights');
});
assert(panelMeshes >= 4 && panelMeshes <= 10 && panelInstances >= 60, 'Detailed panel stays within ten draw calls');
assert.equal(panel.getObjectByName('Sixty individually cut blue-black silicon wafers').count, 60);

// Exercise the live objects rather than just checking that control values were
// copied. Shader uniforms participate in this snapshot because grid contrast
// and leaf saturation are applied in the existing physical material shaders.
const defaults = createDefaultSceneSettings();
const decorations = field.decorations;
assert.equal(typeof decorations.setControls, 'function');
assert.equal(typeof decorations.update, 'function');
const controlledObjects = [];
solarPanel.traverse(object => controlledObjects.push(object));
controlledObjects.push(...ferns);
const geometries = controlledObjects.filter(object => object.isMesh).map(object => [object, object.geometry, object.material, object.instanceMatrix]);
const materialShaders = new Map();
for (const object of controlledObjects) {
  if (!object.isMesh) continue;
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
    if (materialShaders.has(material)) continue;
    const library = material.isMeshPhysicalMaterial ? THREE.ShaderLib.physical : THREE.ShaderLib.standard;
    const shader = { vertexShader: library.vertexShader, fragmentShader: library.fragmentShader,
      uniforms: THREE.UniformsUtils.clone(library.uniforms) };
    material.onBeforeCompile(shader);
    materialShaders.set(material, shader);
  }
}
const cells = panel.getObjectByName('Sixty individually cut blue-black silicon wafers');
const cellShader = materialShaders.get(cells.material);
assert.equal(cellShader.uniforms.uSolarGridStrength, panel.userData.gridStrength, 'Compiled wafers use the same live grid uniform');
assert.match(cellShader.fragmentShader, /solarMetalCoverage\s*=.*uSolarGridStrength/, 'Grid uniform changes the rendered electrode coverage');
for (const material of decorations.fernAppearance.materials) {
  const shader = materialShaders.get(material);
  assert.equal(shader.uniforms.uFernBrightness, decorations.fernAppearance.brightness);
  assert.equal(shader.uniforms.uFernSaturation, decorations.fernAppearance.saturation);
  assert.match(shader.fragmentShader, /mix\(vec3\(fernLuminance\), diffuseColor\.rgb, uFernSaturation\)/,
    'Leaf saturation is applied to the textured diffuse color');
  assert.match(shader.fragmentShader, /\* uFernBrightness/);
}
const relevantUniforms = shader => Object.fromEntries(Object.entries(shader.uniforms)
  .filter(([name]) => /^uSolar|^uFern/.test(name))
  .map(([name, { value }]) => [name, typeof value === 'number' ? value : value.toArray()]));
function renderedState() {
  field.group.updateMatrixWorld(true);
  return {
    objects: controlledObjects.map(object => ({ matrix: object.matrix.toArray(), world: object.matrixWorld.toArray(),
      castShadow: object.castShadow, receiveShadow: object.receiveShadow })),
    materials: [...materialShaders].map(([material, shader]) => ({ color: material.color.toArray(),
      roughness: material.roughness, metalness: material.metalness, opacity: material.opacity,
      uniforms: relevantUniforms(shader) })),
  };
}
function finiteState(label) {
  const visit = value => {
    if (typeof value === 'number') assert(Number.isFinite(value), `${label} leaves all transforms/materials finite`);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  const snapshot = renderedState(); visit(snapshot); return snapshot;
}
const groups = SCENE_CONTROL_GROUPS.filter(group => ['solar', 'ferns'].includes(group.id));
let numericControlsChecked = 0, colorsChecked = 0;
for (const group of groups) for (const control of group.controls) {
  const snapshots = [];
  for (const value of control.type === 'color' ? ['#ffffff', '#bf7652'] : [control.min, control.max]) {
    const settings = structuredClone(defaults); settings[group.id][control.key] = value;
    decorations.setControls(settings); decorations.update(2.75, false);
    snapshots.push(finiteState(`${group.id}.${control.key}=${value}`));
    assert.equal(decorations.controls[group.id][control.key], value, `${group.id}.${control.key} reaches its schema range`);
  }
  assert.notDeepEqual(snapshots[0], snapshots[1], `${group.id}.${control.key} changes a rendered transform, material or live shader uniform`);
  if (control.type === 'color') colorsChecked++; else numericControlsChecked++;
}

// Extremes must be stable under repeated input and never multiply onto the
// previous transform. Returning to defaults restores the authored surface fit.
decorations.setControls(defaults); decorations.update(0, true);
const neutral = renderedState();
const combined = structuredClone(defaults);
for (const group of groups) for (const control of group.controls) {
  combined[group.id][control.key] = control.type === 'color' ? '#bf7652' : control.max;
}
decorations.setControls(combined); decorations.update(2.75, false);
const extreme = finiteState('combined maximum');
for (let frame = 0; frame < 24; frame++) {
  decorations.setControls(combined); decorations.update(2.75, false);
  assert.deepEqual(renderedState(), extreme, 'Repeated controls do not accumulate translation, rotation, scale or tint');
}
for (const group of groups) for (const control of group.controls) {
  if (control.type === 'color') {
    const prior = decorations.controls[group.id][control.key];
    for (const bad of ['red', '#fff', '#zzzzzz', null, {}]) {
      decorations.setControls({ [group.id]: { [control.key]: bad } });
      assert.equal(decorations.controls[group.id][control.key], prior, 'Invalid color cannot poison a live material');
    }
    continue;
  }
  for (const [input, expected] of [[control.min - 100, control.min], [control.max + 100, control.max]]) {
    decorations.setControls({ [group.id]: { [control.key]: input } });
    assert.equal(decorations.controls[group.id][control.key], expected, 'Runtime independently clamps incoming values to the schema');
  }
  for (const bad of [NaN, Infinity, -Infinity, null, '1']) {
    decorations.setControls({ [group.id]: { [control.key]: bad } });
    assert.equal(decorations.controls[group.id][control.key], control.max, 'Invalid numeric input preserves the last finite value');
    decorations.update(NaN, false); finiteState('invalid input');
  }
}
decorations.setControls(defaults); decorations.update(0, true);
assert.deepEqual(renderedState(), neutral, 'Defaults restore exact fitted panel and authored plant transforms');
for (const [object, geometry, material, instanceMatrix] of geometries) {
  assert.equal(object.geometry, geometry, 'Control updates reuse the authored geometry');
  assert.equal(object.material, material, 'Control updates reuse the physical materials');
  assert.equal(object.instanceMatrix, instanceMatrix, 'Wafer and frame instance buffers are retained');
}

// Individual editor transforms layer onto the unchanged authored root and the
// global controls. Evaluate poses without wind so another plant's motion cannot
// hide an accidental group-wide edit.
function fernPoses() {
  return ferns.map(fern => ({id:fern.userData.fernId,position:fern.position.toArray(),
    quaternion:fern.quaternion.toArray(),scale:fern.scale.toArray()}));
}
decorations.setControls(defaults); decorations.update(0,true);
const authoredPoses = fernPoses();
const firstId = FERN_INSTANCES[0].id, secondId = FERN_INSTANCES[1].id;
const firstFern = ferns.find(fern => fern.userData.fernId === firstId);
const secondFern = ferns.find(fern => fern.userData.fernId === secondId);
const fernControls = SCENE_CONTROL_GROUPS.find(group => group.id === 'ferns').controls;
let individualControlsChecked = 0;
for (const key of FERN_INSTANCE_CONTROL_KEYS) {
  const control = fernControls.find(item => item.key === key);
  assert(control && control.type !== 'color', 'Instance transforms have the same numeric schema as the global controls');
  const snapshots = [];
  for (const value of [control.min,control.max]) {
    decorations.setControls(defaults);
    decorations.setControls({ferns:{instances:{[firstId]:{[key]:value}}}});
    decorations.update(0,true);
    finiteState(`instance ${firstId}.${key}=${value}`);
    const poses = fernPoses(); snapshots.push(poses[0]);
    assert.equal(decorations.controls.ferns.instances[firstId][key],value,'Individual transform reaches its schema endpoint');
    assert.deepEqual(poses.slice(1),authoredPoses.slice(1),'Editing one fern leaves the other eight local poses exactly unchanged');
  }
  assert.notDeepEqual(snapshots[0],snapshots[1],`Individual ${key} visibly changes only the selected fern`);
  individualControlsChecked++;
}
decorations.setControls(defaults); decorations.update(0,true);
const compound = structuredClone(defaults);
Object.assign(compound.ferns,{scale:1.3,width:1.2,height:.8,spread:1.6,positionX:.2,positionY:.1,positionZ:-.3,tiltX:12,tiltZ:-7,rotation:21});
Object.assign(compound.ferns.instances[firstId],{scale:1.6,width:.7,height:1.4,positionX:.3,positionY:.25,positionZ:-.1,tiltX:17,tiltZ:9,rotation:-34});
Object.assign(compound.ferns.instances[secondId],{scale:.6,width:1.8,height:.9,positionX:-.4,positionY:.15,positionZ:.2,tiltX:-13,tiltZ:-5,rotation:47});
const instanceMap = decorations.controls.ferns.instances;
decorations.setControls(compound); decorations.update(0,true);
assert.equal(decorations.controls.ferns.instances,instanceMap,'Instance map remains stable across full snapshots');
const global = compound.ferns;
const globalRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
  THREE.MathUtils.degToRad(global.tiltX),THREE.MathUtils.degToRad(global.rotation),THREE.MathUtils.degToRad(global.tiltZ)));
for (const [index,fern] of ferns.entries()) {
  const pose = authoredPoses[index], individual = global.instances[pose.id];
  const cluster = authoredPoses.filter((_,plantIndex) => ferns[plantIndex].parent === fern.parent);
  const center = cluster.reduce((sum,item) => sum.add(new THREE.Vector3().fromArray(item.position)),new THREE.Vector3()).multiplyScalar(1/cluster.length);
  const position = new THREE.Vector3().fromArray(pose.position);
  const expectedPosition = new THREE.Vector3(center.x+(position.x-center.x)*global.spread+global.positionX+individual.positionX,
    position.y+global.positionY+individual.positionY,center.z+(position.z-center.z)*global.spread+global.positionZ+individual.positionZ);
  const expectedScale = new THREE.Vector3().fromArray(pose.scale).multiply(new THREE.Vector3(
    global.scale*global.width*Math.sqrt(global.spread)*individual.scale*individual.width,
    global.scale*global.height*individual.scale*individual.height,
    global.scale*global.width*Math.sqrt(global.spread)*individual.scale*individual.width));
  const individualRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(individual.tiltX),THREE.MathUtils.degToRad(individual.rotation),THREE.MathUtils.degToRad(individual.tiltZ)));
  const expectedRotation = new THREE.Quaternion().fromArray(pose.quaternion).multiply(globalRotation).multiply(individualRotation);
  assert(fern.position.distanceTo(expectedPosition)<1e-10,'Individual translation follows the existing cluster/global translation');
  assert(fern.scale.distanceTo(expectedScale)<1e-10,'Individual dimensions multiply the existing global dimensions');
  assert(fern.quaternion.angleTo(expectedRotation)<1e-7,'Individual tilt composes after the authored and global rotations');
}
assert.notDeepEqual(firstFern.scale.toArray(),secondFern.scale.toArray(),'Two separate plants retain independently chosen sizes');
const compoundPoses = fernPoses();
for (let frame=0;frame<24;frame++) {
  decorations.setControls(compound); decorations.update(0,true);
  assert.deepEqual(fernPoses(),compoundPoses,'Repeated per-fern transforms never accumulate onto the previous pose');
}
const retainedSecond = structuredClone(decorations.controls.ferns.instances[secondId]);
const retainedFirstWidth = decorations.controls.ferns.instances[firstId].width;
decorations.setControls({ferns:{instances:{[firstId]:{positionX:.7}}}}); decorations.update(0,true);
assert.equal(decorations.controls.ferns.instances[firstId].width,retainedFirstWidth,'Partial instance updates preserve its other edited properties');
assert.deepEqual(decorations.controls.ferns.instances[secondId],retainedSecond,'Partial updates preserve edits to another plant');
const beforeGlobalOnly = structuredClone(decorations.controls.ferns.instances);
decorations.setControls({ferns:{breeze:1.5}});
assert.deepEqual(decorations.controls.ferns.instances,beforeGlobalOnly,'Global-only updates preserve every individual setting');
for (const key of FERN_INSTANCE_CONTROL_KEYS) {
  const control = fernControls.find(item => item.key === key);
  for (const [input,expected] of [[control.min-100,control.min],[control.max+100,control.max]]) {
    decorations.setControls({ferns:{instances:{[firstId]:{[key]:input}}}});
    assert.equal(decorations.controls.ferns.instances[firstId][key],expected,'Individual incoming transforms clamp to the numeric schema');
  }
  for (const bad of [NaN,Infinity,-Infinity,null,'2',{}]) {
    decorations.setControls({ferns:{instances:{[firstId]:{[key]:bad}}}});
    assert.equal(decorations.controls.ferns.instances[firstId][key],control.max,'Invalid individual input preserves the previous finite value');
  }
}
decorations.setControls({ferns:{instances:{'not-a-plant':{scale:2},[secondId]:null}}});
assert(!Object.hasOwn(decorations.controls.ferns.instances,'not-a-plant'),'Unknown plant IDs cannot create phantom settings');
decorations.update(NaN,true); finiteState('individual invalid input');
decorations.setControls(defaults); decorations.update(0,true);
assert.deepEqual(fernPoses(),authoredPoses,'Neutral per-plant controls exactly restore every authored surface fit');

assert.equal(typeof decorations.selectFern,'function');
const marker = decorations.selectionMarker, markerGeometry=marker.geometry, markerMaterial=marker.material;
assert(!marker.visible && marker.parent===null,'Editor highlight starts hidden and outside the rendered scene');
assert(markerMaterial.depthTest===false && markerMaterial.depthWrite===false && markerMaterial.isMeshBasicMaterial,
  'The thin selection marker remains legible without changing physical leaf lighting');
const selectionBefore = {poses:fernPoses(),settings:structuredClone(decorations.controls),materials:ferns.map(fern=>fern.material)};
decorations.selectFern(firstId);
assert.equal(decorations.selectedFernId,firstId);
assert(marker.visible && marker.parent===firstFern,'Exactly the selected fern root owns the single marker');
decorations.selectFern(secondId);
assert.equal(decorations.selectedFernId,secondId);
assert(marker.parent===secondFern && !firstFern.children.includes(marker),'Selecting another fern moves rather than duplicates the marker');
assert.equal(marker.geometry,markerGeometry); assert.equal(marker.material,markerMaterial);
assert.deepEqual(fernPoses(),selectionBefore.poses,'Selection never changes any authored transform');
assert.deepEqual(decorations.controls,selectionBefore.settings,'Editor selection is separate from saved tuning');
ferns.forEach((fern,index)=>assert.equal(fern.material,selectionBefore.materials[index],'Editor marker never tints shared leaf materials'));
decorations.setControls({ferns:{instances:{[secondId]:{positionX:.4,tiltZ:28,scale:1.5}}}});
decorations.update(3,false); field.group.updateMatrixWorld(true);
const markerWorld = marker.getWorldPosition(new THREE.Vector3());
assert(markerWorld.distanceTo(secondFern.localToWorld(marker.position.clone()))<1e-10,'Selection marker follows the edited and swaying root');
decorations.selectFern(null);
assert.equal(decorations.selectedFernId,null); assert(!marker.visible && marker.parent===null,'Leaving individual editing removes the helper');
decorations.selectFern('not-a-plant');
assert.equal(decorations.selectedFernId,null); assert(!marker.visible,'Unknown selections cannot highlight another plant');
decorations.setControls(defaults); decorations.update(0,true);
assert.deepEqual(renderedState(),neutral,'Selection and per-plant editing leave the original shared appearance restorable');

decorations.setControls({ ferns: { breeze: 2, breezeSpeed: 1 } });
decorations.update(1, false);
const firstWind = ferns.map(fern => fern.quaternion.clone());
const fixedRoots = ferns.map(fern => fern.position.clone());
decorations.update(4, false);
assert(ferns.some((fern, index) => fern.quaternion.angleTo(firstWind[index]) > .001), 'Wind changes leaf orientation over time');
ferns.forEach((fern, index) => assert(fern.position.distanceTo(fixedRoots[index]) < 1e-12, 'Wind keeps each fern root anchored'));
decorations.update(1, true);
const reducedPose = ferns.map(fern => fern.quaternion.clone());
decorations.update(100, true);
ferns.forEach((fern, index) => assert(fern.quaternion.angleTo(reducedPose[index]) < 1e-7, 'Reduced motion suppresses time-driven leaf sway'));

// Disable leaf sway for the separate rigid parenting check below.
decorations.setControls({ ...defaults, ferns: { ...defaults.ferns, breeze: 0 } });
decorations.update(0, false);
const tracked = [panel, ...ferns];
const before = tracked.map(object => ({
  position: object.position.clone(), quaternion: object.quaternion.clone(),
  world: object.getWorldPosition(new THREE.Vector3()),
}));
field.update(12, .08, false, { presence: 1, strength: 1, pointer: { x: .7, y: -.4 } });
field.group.updateMatrixWorld(true);
tracked.forEach((object, index) => {
  const state = before[index];
  assert(object.position.distanceTo(state.position) < 1e-10 && object.quaternion.angleTo(state.quaternion) < 1e-7,
    'Attachments stay fixed in their rock local frame');
  const world = object.getWorldPosition(new THREE.Vector3());
  const expected = object.parent.localToWorld(state.position.clone());
  assert(world.distanceTo(expected) < 1e-8, 'Attachment follows its rock under pointer and time movement');
  assert(world.distanceTo(state.world) > .005, 'Pointer/time actually moves the attached object in world space');
  if (object.userData.fernId) {
    const catalog = FERN_INSTANCES.find(instance=>instance.id===object.userData.fernId);
    assert.equal(object.parent,field.satellites[catalog.rockIndex].mesh,'Stable IDs survive parent stone transformations');
  }
});

// A known sloping plane checks orientation and local-space independence without
// relying on the scan fitter to validate its own returned normal.
const tiltedGeometry = new THREE.PlaneGeometry(4, 3, 8, 8).rotateX(-Math.PI / 2);
const positions = tiltedGeometry.attributes.position;
for (let i = 0; i < positions.count; i++) positions.setY(i, positions.getX(i) * .25 - positions.getZ(i) * .15);
tiltedGeometry.computeVertexNormals();
const tilted = new THREE.Mesh(tiltedGeometry);
tilted.position.set(4, 8, -3); tilted.rotation.set(.3, .5, .7); tilted.scale.setScalar(5); tilted.updateMatrixWorld(true);
const planeFit = fitRockPanel(tilted);
assert(planeFit.normal.distanceTo(new THREE.Vector3(-.25, 1, .15).normalize()) < 1e-6, 'Fitted tilt follows known geometry independently of mesh transform');
assert(planeFit.contacts.every(contact => Math.abs(contact.gap - .01801) < 1e-6));
assert(Math.abs(sampleRockSurface(tilted, .4, .5).point.y - .025) < 1e-6, 'Sample stays rock-local');
assert.equal(sampleRockSurface(tilted, 4, 4), null, 'Uncovered points do not get fabricated support');

console.log(JSON.stringify({
  status: 'ok', panelMeshes, panelInstances, plantedRocks: plantedRocks.length, ferns: ferns.length,
  objectControls: { numeric: numericControlsChecked, colors: colorsChecked, individual:individualControlsChecked },
  panelFit: { width: fit.width, depth: fit.depth, normal: fit.normal.toArray(), supports: supports.length,
    testedUndersidePoints: samples, minClearance, maxSupportGap: fit.maxGap },
  checks: ['real local scan buffers', 'surface-bound fern roots', 'complete fern clusters',
    'rigid panel clearance and four contacts', 'physical finite panel geometry', 'every live object control changes rendering',
    'grid and leaf shader uniforms', 'independent runtime ranges', 'no repeated-control drift or geometry rebuilds',
    'nine stable fern IDs', 'independent per-fern transforms and global composition', 'per-fern ranges and no drift',
    'editor-only selection marker', 'anchored breeze and reduced motion', 'pointer/time parenting', 'known slope and local coordinates'],
}, null, 2));
