import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDefaultSceneSettings, sanitizeSceneSettings, SCENE_CONTROL_GROUPS, GARDEN_EFFECT_SOURCES, getSceneControl, getSceneControlLimits } from '../src/scene-settings.js';
import { createHeroAtmosphere } from '../src/hero-atmosphere.js';
import { createHeroLighting } from '../src/hero-lighting.js';
import { createHeroDust } from '../src/hero-dust.js';
import { createJourneyCompositeMaterial } from '../src/hero-optics.js';
import { createDarkRockMaterial } from '../src/rock-material.js';

const defaults = createDefaultSceneSettings();
const groups = Object.fromEntries(SCENE_CONTROL_GROUPS.map(group => [group.id, group]));
const heroGroupIds = ['rays', 'particles', 'optics', 'background', 'stone', 'solar', 'ferns', 'title'];
const gardenGroupIds = ['gardenPanel', 'gardenCamera', 'gardenWater', 'gardenGround', 'gardenGrass', 'gardenRoom', 'gardenRays', 'gardenParticles', 'gardenOptics', 'gardenBackground'];
const heroOnly = settings => Object.fromEntries(heroGroupIds.filter(id => Object.hasOwn(settings, id)).map(id => [id, structuredClone(settings[id])]));
const report = {};
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} ≠ ${expected}`);
const numericExtreme = (groupId, bound) => Object.fromEntries(Object.entries(getSceneControlLimits(groupId)).map(([key, range]) => [key, range[bound === 'max' ? 1 : 0]]));
function finiteUniforms(uniforms, label) {
  for (const [name, uniform] of Object.entries(uniforms)) {
    const value = uniform.value;
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${label}.${name} is finite`);
    else if (value?.isColor || value?.isVector2 || value?.isVector3 || value?.isVector4 || value?.isMatrix3 || value?.isMatrix4) {
      assert.ok(value.toArray().every(Number.isFinite), `${label}.${name} has finite components`);
    }
  }
}
function finiteScene(scene, label) {
  scene.updateMatrixWorld(true);
  scene.traverse(object => {
    for (const [name, components] of Object.entries({ position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), matrix: object.matrix.toArray(), matrixWorld: object.matrixWorld.toArray() })) {
      assert.ok(components.every(Number.isFinite), `${label}.${object.name || object.type}.${name} is finite`);
    }
    if (object.isLight) {
      assert.ok(Number.isFinite(object.intensity) && object.color.toArray().every(Number.isFinite), `${label} light energy and color are finite`);
      for (const key of ['distance', 'angle', 'penumbra', 'decay']) if (key in object) assert.ok(Number.isFinite(object[key]), `${label} light ${key} is finite`);
    }
  });
}

// These were the published numeric ceilings before the requested fourfold increase.
const oldMaxima = {
  rays: { intensity: 3, width: 2.5, spread: 2, angle: 60, sourceX: 1, sourceY: 1.7, softness: 3, warmth: 1, length: 2 },
  particles: { count: 1200, size: 4, brightness: 3, speed: 3, drift: 3, softness: 2, depth: 2, foreground: 3 },
  optics: { amount: 1.5, area: .9, speed: 2, blur: 1, blurSize: 24, chromatic: 32, stretch: 1, topLeft: 2, topRight: 2, bottomLeft: 2, bottomRight: 2 },
  background: { brightness: 2, gradient: 1, glowStrength: 1.5, glowSize: 3, noise: .2, vignette: .6 },
  stone: { scale: 2.5, normal: 3, roughness: 1, brightness: 2, contrast: 2, saturation: 1 },
};
assert.equal(Object.values(oldMaxima).reduce((total, controls) => total + Object.keys(controls).length, 0), 40);
for (const [groupId, controls] of Object.entries(oldMaxima)) {
  for (const [key, oldMax] of Object.entries(controls)) {
    assert.equal(getSceneControl(groupId, key).max, oldMax * 4, `${groupId}.${key} has exactly four times its former maximum`);
  }
  const numericControls = groups[groupId].controls.filter(control => control.type !== 'color');
  assert.deepEqual(getSceneControlLimits(groupId), Object.fromEntries(numericControls.map(control => [control.key, [control.min, control.max]])), `${groupId} has one shared limits schema`);
}
const oldCeilingPreset = sanitizeSceneSettings(oldMaxima);
for (const [groupId, controls] of Object.entries(oldMaxima)) for (const [key, value] of Object.entries(controls)) assert.equal(oldCeilingPreset[groupId][key], value, `loading old maximum ${groupId}.${key} preserves its value`);
for (const [key, maximum] of Object.entries({ crackStrength:4, crackWidth:4, crackDepth:4, crackGloss:4, crackMetalness:4, crackGlow:8, crackThreshold:.8 })) {
  assert.equal(getSceneControl('stone',key).max, maximum, `new ${key} keeps its agreed ceiling without a second multiplier`);
}
assert.equal(getSceneControl('stone', 'crackColor').type, 'color');
assert.equal(getSceneControl('missing', 'missing'), undefined);
assert.deepEqual(getSceneControlLimits('missing'), {});

assert.deepEqual(Object.keys(groups), [...heroGroupIds, ...gardenGroupIds]);
assert.equal(SCENE_CONTROL_GROUPS.length, 18);
assert.deepEqual(SCENE_CONTROL_GROUPS.filter(group => group.scope === 'hero').map(group => group.id), heroGroupIds);
assert.deepEqual(SCENE_CONTROL_GROUPS.filter(group => group.scope === 'garden').map(group => group.id), gardenGroupIds);
assert.deepEqual(sanitizeSceneSettings(defaults), defaults);
for (const group of SCENE_CONTROL_GROUPS) {
  assert.ok(group.controls.filter(control => control.type !== 'color').length >= 6, `${group.id} needs at least six sliders`);
  assert.equal(new Set(group.controls.map(control => control.key)).size, group.controls.length);
  for (const control of group.controls) {
    if (control.type === 'color') {
      assert.match(control.default, /^#[\da-f]{6}$/i, `${group.id}.${control.key} has a six-digit hex default`);
      const color = sanitizeSceneSettings({ [group.id]: { [control.key]: '#A1B2C3' } });
      assert.equal(color[group.id][control.key], '#a1b2c3', `${group.id}.${control.key} normalizes valid colors`);
      for (const invalid of ['#fff', '#1234567', '#12gg34', 'red', 'rgb(0,0,0)', '', 0xffffff, null, {}, []]) {
        assert.equal(sanitizeSceneSettings({ [group.id]: { [control.key]: invalid } })[group.id][control.key], control.default, `${group.id}.${control.key} rejects invalid colors`);
      }
      continue;
    }
    assert.ok(control.min < control.max && control.step > 0, `${group.id}.${control.key} has a usable range`);
    assert.ok(Number.isFinite(control.default), `${group.id}.${control.key} has a finite default`);
    const low = sanitizeSceneSettings({ [group.id]: { [control.key]: -1e6 } });
    const high = sanitizeSceneSettings({ [group.id]: { [control.key]: 1e6 } });
    close(low[group.id][control.key], control.min, `${group.id}.${control.key} clamps below its range`);
    close(high[group.id][control.key], control.max, `${group.id}.${control.key} clamps above its range`);
    for (const invalid of [NaN, Infinity, -Infinity, null, true, '1', {}, []]) {
      const sanitized = sanitizeSceneSettings({ [group.id]: { [control.key]: invalid } });
      assert.equal(sanitized[group.id][control.key], control.default, `${group.id}.${control.key} rejects non-numeric storage values`);
    }
  }
}
for (const invalid of [null, undefined, [], true, 5, 'not JSON']) assert.deepEqual(sanitizeSceneSettings(invalid), defaults);
const knownOnly = sanitizeSceneSettings({ unknown: { bad: 5 }, optics: { topLeft: .537, unknown: 7 }, particles: { count: 487 } });
assert.equal(knownOnly.optics.topLeft, .55);
assert.equal(knownOnly.particles.count, 490);
assert.ok(!('unknown' in knownOnly) && !('unknown' in knownOnly.optics));
const independent = createDefaultSceneSettings();
independent.rays.intensity = 2;
assert.equal(createDefaultSceneSettings().rays.intensity, 1, 'defaults are independent objects');
const allControls = SCENE_CONTROL_GROUPS.flatMap(group => group.controls);
const sliderCount = allControls.filter(control => control.type !== 'color').length;
const colorCount = allControls.filter(control => control.type === 'color').length;
assert.equal(sliderCount, 174); assert.equal(colorCount, 16);
const oldPreset = { rays: { intensity: 2.7, angle: -45 }, particles: { count: 1170 }, stone: { scale: 2.3, roughness: .98 } };
const migratedPreset = sanitizeSceneSettings(oldPreset);
for (const [groupId, controls] of Object.entries(oldPreset)) for (const [key, value] of Object.entries(controls)) assert.equal(migratedPreset[groupId][key], value, `old ${groupId}.${key} tuning is preserved`);
assert.equal(migratedPreset.stone.crackStrength, 0, 'an old preset gains no new crack overlay');
assert.deepEqual(defaults.title, {
  blur: 1, blurSize: 16, radius: 320, response: 5, glow: .75,
  glowSize: 22, distortion: .2, softness: .84, glowColor: '#fff1d4',
}, 'Title controls preserve the authored hover treatment as their defaults');
assert.deepEqual(migratedPreset.title, defaults.title, 'Old presets gain title defaults');
const sevenTabPreset = heroOnly(defaults);
delete sevenTabPreset.title;
sevenTabPreset.ferns.instances['lower-left-2'].rotation = -31;
const withTitleDefaults = sanitizeSceneSettings(sevenTabPreset);
const preservedSevenTabs = heroOnly(withTitleDefaults);
delete preservedSevenTabs.title;
assert.deepEqual(preservedSevenTabs, sevenTabPreset, 'Adding title settings preserves all seven tabs and individual plants');
assert.deepEqual(withTitleDefaults.title, defaults.title);
const eightTabPreset = heroOnly(defaults);
eightTabPreset.rays.intensity = 7.33;
eightTabPreset.particles.count = 1640;
eightTabPreset.optics.chromatic = 47;
eightTabPreset.background.topColor = '#12ab34';
eightTabPreset.ferns.instances['upper-right-2'].positionZ = -.63;
const withGardenDefaults = sanitizeSceneSettings(eightTabPreset);
assert.deepEqual(heroOnly(withGardenDefaults), eightTabPreset, 'Adding the garden editor preserves all eight hero tabs and every fern');
for (const [id, sourceId] of Object.entries(GARDEN_EFFECT_SOURCES)) {
  assert.deepEqual(groups[id].controls, groups[sourceId].controls, `${id} has the exact existing effect schema`);
  assert.notEqual(groups[id].controls, groups[sourceId].controls);
  assert.notEqual(groups[id].controls[0], groups[sourceId].controls[0]);
  assert.deepEqual(withGardenDefaults[id], withGardenDefaults[sourceId], `${id} migrates the published hero look`);
  assert.notEqual(withGardenDefaults[id], withGardenDefaults[sourceId], `${id} has an independent editable record`);
}
withGardenDefaults.gardenRays.intensity = 1.1;
assert.equal(withGardenDefaults.rays.intensity, 7.33, 'Changing garden rays does not edit the hero');
const separatelySaved = sanitizeSceneSettings({ ...eightTabPreset, gardenRays: { ...defaults.gardenRays, intensity: 2.12 } });
assert.equal(separatelySaved.gardenRays.intensity, 2.12, 'A saved garden effect is retained instead of re-inheriting the hero');
assert.equal(separatelySaved.rays.intensity, 7.33);
const oldWaterPreset = structuredClone(defaults);
Object.assign(oldWaterPreset.gardenWater, { reflection: .57, transparency: .49, roughness: .23, waveStrength: 1.77, color: '#315342' });
delete oldWaterPreset.gardenWater.shine;
delete oldWaterPreset.gardenWater.shineSize;
const withWaterShine = sanitizeSceneSettings(oldWaterPreset);
assert.equal(withWaterShine.gardenWater.shine, 1);
assert.equal(withWaterShine.gardenWater.shineSize, 1);
const preservedWaterPreset = structuredClone(withWaterShine);
delete preservedWaterPreset.gardenWater.shine;
delete preservedWaterPreset.gardenWater.shineSize;
assert.deepEqual(preservedWaterPreset, oldWaterPreset, 'Adding water shine preserves every published water field and all other settings');
report.settings = { groups: SCENE_CONTROL_GROUPS.length, sliders: sliderCount, colorInputs: colorCount, finiteClampedStorage: true, validatedHexColors: true, oldMaximaIncreasedFourfold: 40, oldPresetsPreserved: true };

const rayScene = new THREE.Scene();
const rays = createHeroAtmosphere(rayScene);
const rayMesh = rayScene.children.find(child => child.material?.uniforms?.rayIntensity);
assert.ok(rayMesh, 'the atmosphere adds its material to the supplied scene');
const rayUniforms = rayMesh.material.uniforms;
const rayMap = {
  intensity: 'rayIntensity', width: 'rayWidth', spread: 'raySpread', angle: 'rayAngle',
  sourceX: 'raySourceX', sourceY: 'raySourceY', softness: 'raySoftness', warmth: 'rayWarmth', length: 'rayLength',
};
for (const control of groups.rays.controls) {
  close(rayUniforms[rayMap[control.key]].value, defaults.rays[control.key], `initial ray ${control.key}`);
  rays.setControls({ [control.key]: 1e6 });
  close(rayUniforms[rayMap[control.key]].value, control.key === 'angle' ? THREE.MathUtils.degToRad(control.max) : control.max, `ray ${control.key} maximum`);
  rays.setControls({ [control.key]: -1e6 });
  close(rayUniforms[rayMap[control.key]].value, control.key === 'angle' ? THREE.MathUtils.degToRad(control.min) : control.min, `ray ${control.key} minimum`);
}
rays.setControls(defaults.rays);
rays.setControls({ angle: 30, intensity: 1.7 });
close(rayUniforms.rayAngle.value, Math.PI / 6, 'ray angle converts degrees into radians');
rays.setControls({ angle: '45', intensity: NaN, width: Infinity, unknown: 1 });
close(rayUniforms.rayAngle.value, Math.PI / 6, 'invalid angle does not overwrite a valid ray value');
close(rayUniforms.rayIntensity.value, 1.7, 'invalid intensity does not overwrite a valid ray value');
close(rayUniforms.rayWidth.value, defaults.rays.width, 'infinite ray width is ignored');
assert.ok(!('rayUnknown' in rayUniforms));
rays.resize();
assert.ok(Number.isFinite(rayUniforms.aspect.value) && rayUniforms.aspect.value > 0, 'rays resize without a DOM viewport');
const backgroundMap = { brightness:'backgroundBrightness', gradient:'backgroundGradient', glowStrength:'backgroundGlowStrength', glowSize:'backgroundGlowSize', noise:'backgroundNoise' };
const backgroundColors = { bottomColor:'deep', topColor:'earth', glowColor:'amber' };
for (const [key,uniform] of Object.entries(backgroundMap)) close(rayUniforms[uniform].value, defaults.background[key], `initial background ${key}`);
for (const [key,uniform] of Object.entries(backgroundColors)) assert.equal(`#${rayUniforms[uniform].value.getHexString()}`,defaults.background[key],`initial background ${key}`);
for (const control of groups.background.controls.filter(control => control.key in backgroundMap)) {
  rays.setBackground({[control.key]:1e6});
  close(rayUniforms[backgroundMap[control.key]].value,control.max,`background ${control.key} maximum`);
  rays.setBackground({[control.key]:-1e6});
  close(rayUniforms[backgroundMap[control.key]].value,control.min,`background ${control.key} minimum`);
}
rays.setBackground(defaults.background);
rays.setBackground({bottomColor:'#123456',topColor:'#A1B2C3',glowColor:'#fedcba',brightness:NaN,gradient:Infinity,noise:'1'});
assert.equal(rayUniforms.deep.value.getHexString(),'123456');
assert.equal(rayUniforms.earth.value.getHexString(),'a1b2c3');
assert.equal(rayUniforms.amber.value.getHexString(),'fedcba');
for (const [key,uniform] of Object.entries(backgroundMap)) close(rayUniforms[uniform].value,defaults.background[key],`invalid background ${key} retains its value`);
rays.setBackground({bottomColor:'red',topColor:'#fff',glowColor:'#12345g'});
assert.equal(rayUniforms.deep.value.getHexString(),'123456','invalid color does not overwrite a valid background');
assert.equal(rayUniforms.earth.value.getHexString(),'a1b2c3');
assert.equal(rayUniforms.amber.value.getHexString(),'fedcba');
close(rayUniforms.rayIntensity.value,1.7,'background controls do not change ray intensity');
rays.setControls(numericExtreme('rays', 'max'));
rays.setBackground(numericExtreme('background', 'max'));
finiteUniforms(rayUniforms, 'all-maximum atmosphere');
rayMesh.geometry.dispose();
rayMesh.material.dispose();
report.rays = { mappedControls: Object.keys(rayMap).length, clamped: true, degreesConverted: true };
report.background = { atmosphereSliders:Object.keys(backgroundMap).length, colorInputs:Object.keys(backgroundColors).length, clamped:true };

const lightingScene = new THREE.Scene();
const lighting = createHeroLighting(lightingScene);
assert.ok(lightingScene.children.includes(lighting.group),'physical lighting is attached to the supplied scene');
assert.ok(lighting.key.isSpotLight && lighting.key.castShadow,'real sunlight is a shadow-casting spotlight');
const key = lighting.key, initialIntensity = key.intensity;
assert.ok(initialIntensity>0);
const volumes = lighting.group.children.filter(child => child.isMesh);
assert.equal(volumes.length,0,'sunlight uses no hard transparent cone surface');
const physicalCamera = new THREE.PerspectiveCamera(43,16/9,.08,180);
physicalCamera.position.set(.5,1.9,12.7);physicalCamera.lookAt(.5,.15,0);physicalCamera.updateMatrixWorld();
lighting.update(10,physicalCamera);
const lightDirection = () => key.target.position.clone().sub(key.position).normalize();
const originalPosition = key.position.clone();
lighting.setControls({sourceX:.2});
assert.ok(originalPosition.distanceTo(key.position)>.1,'source X moves the physical light');
const xPosition = key.position.clone();
lighting.setControls({sourceY:1.6});
assert.ok(xPosition.distanceTo(key.position)>.1,'source Y moves the physical light');
const originalDirection = lightDirection();
lighting.setControls({angle:45});
assert.ok(originalDirection.angleTo(lightDirection())>.1,'angle changes the physical beam direction');
lighting.setControls(defaults.rays);lighting.update(10,physicalCamera);
const projectedSource = key.position.clone().project(physicalCamera);
close(projectedSource.x,defaults.rays.sourceX*2-1,'physical source X aligns with background sun');
close(projectedSource.y,defaults.rays.sourceY*2-1,'physical source Y aligns with background sun');
lighting.setControls({width:.3});const narrowCone=key.angle;
lighting.setControls({width:2.5});assert.ok(key.angle>narrowCone,'width changes actual light coverage');
lighting.setControls({spread:.4});const compactCone=key.angle;
lighting.setControls({spread:2});assert.ok(key.angle>compactCone,'spread changes actual light coverage');
lighting.setControls({softness:.3});const sharpRadius=key.shadow.radius,sharpPenumbra=key.penumbra;
lighting.setControls({softness:3});assert.ok(key.shadow.radius>sharpRadius && key.penumbra>sharpPenumbra,'softness changes shadow radius and cone penumbra');
lighting.setControls({warmth:0});const neutralColor=key.color.clone();
lighting.setControls({warmth:1});assert.ok(!key.color.equals(neutralColor),'warmth changes actual light color');
lighting.setControls({length:.3});const shortReach=key.distance;
lighting.setControls({length:2});assert.ok(key.distance>shortReach,'length changes actual light reach');
lighting.setControls({intensity:0});
assert.equal(key.intensity,0,'zero intensity switches off the physical beam');
assert.ok(volumes.every(volume=>!volume.visible),'zero intensity switches off volume scattering');
assert.ok(lighting.group.children.some(child=>child.isHemisphereLight&&child.intensity>0),'minimal fill remains with sunlight off');
lighting.setControls({intensity:getSceneControl('rays','intensity').max});close(key.intensity,initialIntensity*12,'expanded maximum intensity changes actual illumination');
assert.ok(volumes.every(volume=>volume.visible));
lighting.setControls({intensity:Infinity,sourceX:NaN,angle:'30'});
assert.ok(Number.isFinite(key.intensity)&&key.position.toArray().every(Number.isFinite));
for (const bound of ['min', 'max']) {
  lighting.setControls(numericExtreme('rays', bound));
  lighting.update(50, physicalCamera);
  key.shadow.updateMatrices(key);
  finiteScene(lightingScene, `all-${bound} lighting`);
  assert.ok(key.shadow.camera.projectionMatrix.toArray().every(Number.isFinite), `all-${bound} shadow projection is finite`);
}
for (const control of groups.rays.controls) {
  lighting.setControls({ ...defaults.rays, [control.key]: control.max });
  lighting.update(60, physicalCamera);
  finiteScene(lightingScene, `maximum ${control.key} lighting`);
}
const futureMaterials=[new THREE.MeshStandardMaterial(),new THREE.MeshPhysicalMaterial()];
const futureMeshes=futureMaterials.map(material=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);
  mesh.castShadow=mesh.receiveShadow=true;lightingScene.add(mesh);return mesh;
});
for(const mesh of futureMeshes) {
  assert.ok(mesh.material.isMeshStandardMaterial,'future objects use Three scene lighting directly');
  assert.equal(mesh.material.onBeforeCompile,THREE.Material.prototype.onBeforeCompile,'future objects need no lighting material hooks');
  assert.ok(mesh.castShadow&&mesh.receiveShadow&&lightingScene.children.includes(mesh));
}
const volumeGeometrySet=new Set(volumes.map(mesh=>mesh.geometry)),volumeMaterialSet=new Set(volumes.map(mesh=>mesh.material));
let disposedVolumeGeometry=0,disposedVolumeMaterial=0;
for(const geometry of volumeGeometrySet)geometry.addEventListener('dispose',()=>disposedVolumeGeometry++);
for(const material of volumeMaterialSet)material.addEventListener('dispose',()=>disposedVolumeMaterial++);
lighting.dispose();lighting.dispose();
assert.equal(disposedVolumeGeometry,volumeGeometrySet.size);assert.equal(disposedVolumeMaterial,volumeMaterialSet.size);
assert.ok(!lightingScene.children.includes(lighting.group),'disposing lights removes their owned scene group');
for(const mesh of futureMeshes) {assert.ok(lightingScene.children.includes(mesh),'disposing lights preserves independent scene objects');mesh.geometry.dispose();mesh.material.dispose();}
report.lighting={shadowCastingSpotlight:true,controlsAffectRealLights:true,alignedPhysicalSource:true,futurePbrMeshesWithoutHooks:futureMeshes.length,hardConeSurfaces:volumes.length,finiteExpandedExtremes:true,disposed:true};

const dustScene = new THREE.Scene();
const dust = createHeroDust(dustScene);
const points = dust.group.children.find(child => child.isPoints);
assert.ok(points && dustScene.children.includes(dust.group), 'dust adds one point cloud to the supplied scene');
const geometry = points.geometry;
const attributes = Object.fromEntries(Object.entries(geometry.attributes).map(([key, attribute]) => [key, { attribute, array: attribute.array }]));
const dustUniforms = points.material.uniforms;
const dustMap = { size: 'uSize', brightness: 'uBrightness', drift: 'uDrift', softness: 'uSoftness', depth: 'uDepth', foreground: 'uForeground' };
const particleMax = getSceneControl('particles','count').max;
assert.equal(geometry.drawRange.count, 480);
for (const [key, uniform] of Object.entries(dustMap)) close(dustUniforms[uniform].value, defaults.particles[key], `initial dust ${key}`);
dust.setControls({ count: 0 });
assert.equal(geometry.drawRange.count, 0, 'zero particles draws nothing');
dust.setControls({ count: particleMax });
assert.equal(geometry.drawRange.count, particleMax, 'all preallocated particles can be drawn');
assert.equal(geometry.attributes.position.count, particleMax);
dust.setControls({ count: 1e6 });
assert.equal(geometry.drawRange.count, particleMax);
dust.setControls({ count: -1e6 });
assert.equal(geometry.drawRange.count, 0);
for (const control of groups.particles.controls.filter(control => control.key in dustMap)) {
  dust.setControls({ [control.key]: 1e6 });
  close(dustUniforms[dustMap[control.key]].value, control.max, `dust ${control.key} maximum`);
  dust.setControls({ [control.key]: -1e6 });
  close(dustUniforms[dustMap[control.key]].value, control.min, `dust ${control.key} minimum`);
}
dust.setControls(defaults.particles);
const camera = new THREE.PerspectiveCamera(43, 16 / 9, .08, 180);
dust.update(10, camera, new THREE.Vector2(.2, -.3));
close(dustUniforms.uTime.value, 10, 'dust starts at supplied elapsed time');
dust.setControls({ speed: 0 });
dust.update(20, camera, null);
dust.update(40, camera, null);
close(dustUniforms.uTime.value, 10, 'zero speed freezes dust through elapsed scene time');
dust.setControls({ speed: 2 });
dust.update(41, camera, null);
close(dustUniforms.uTime.value, 12, 'resuming dust does not jump through paused time');
dust.update(41, camera, null);
close(dustUniforms.uTime.value, 12, 'a repeated scene timestamp stays still');
dust.setControls({ speed: '3', brightness: Infinity, count: NaN });
dust.update(42, camera, null);
close(dustUniforms.uTime.value, 14, 'invalid speed leaves the prior speed intact');
close(dustUniforms.uBrightness.value, 1, 'invalid brightness is ignored');
assert.equal(geometry.drawRange.count, 480, 'invalid count is ignored');
assert.deepEqual(dustUniforms.uPointer.value.toArray(), [0, 0], 'pointer influence clears when the scene has no pointer');
dust.resize(720, 1.5);
assert.equal(dustUniforms.uViewportHeight.value, 1080);
for (let index = 0; index < 40; index++) {
  dust.setControls({ count: index % 2 ? 0 : particleMax, size: .25 + index % 4 });
  dust.update(43 + index, camera, null);
  assert.equal(points.geometry, geometry, 'interactive controls reuse the point geometry');
  for (const [key, original] of Object.entries(attributes)) {
    assert.equal(geometry.attributes[key], original.attribute, `${key} retains its BufferAttribute`);
    assert.equal(geometry.attributes[key].array, original.array, `${key} retains its allocated array`);
  }
}
dust.setControls(numericExtreme('particles','max'));
dust.update(100, camera, new THREE.Vector2(1,-1));
finiteUniforms(dustUniforms, 'all-maximum particles');
for (const [key, attribute] of Object.entries(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite), `all-maximum particles ${key} geometry stays finite`);
let geometryDisposed = false, materialDisposed = false;
geometry.addEventListener('dispose', () => { geometryDisposed = true; });
points.material.addEventListener('dispose', () => { materialDisposed = true; });
dust.dispose();
assert.ok(geometryDisposed && materialDisposed && !dustScene.children.includes(dust.group));
report.particles = { maxCount: particleMax, zeroCount: true, freezeResumeContinuous: true, reusedGeometryArrays: Object.keys(attributes).length, finiteExpandedMaximum:true };

const rockTexture = new THREE.Texture(), landTexture = new THREE.Texture();
const optics = createJourneyCompositeMaterial(rockTexture, landTexture, 16 / 9);
close(optics.uniforms.backgroundVignette.value,defaults.background.vignette,'initial background vignette');
optics.setBackground({vignette:1e6});close(optics.uniforms.backgroundVignette.value,getSceneControl('background','vignette').max,'vignette maximum');
optics.setBackground({vignette:-1e6});close(optics.uniforms.backgroundVignette.value,0,'vignette minimum');
optics.setBackground(defaults.background);
optics.setBackground({vignette:NaN});close(optics.uniforms.backgroundVignette.value,defaults.background.vignette,'invalid vignette retains its value');
report.background.compositeSliders=1;
const opticsMap = { amount: 'opticalAmount', area: 'opticalArea', speed: 'opticalSpeed', blur: 'blurLevel', blurSize: 'blurSize', chromatic: 'chromaticSize', stretch: 'stretch' };
for (const [key, uniform] of Object.entries(opticsMap)) close(optics.uniforms[uniform].value, defaults.optics[key], `initial optics ${key}`);
assert.deepEqual(optics.uniforms.cornerGains.value.toArray(), [1, 1, 1, 1]);
for (const control of groups.optics.controls.filter(control => control.key in opticsMap)) {
  optics.setControls({ [control.key]: 1e6 });
  close(optics.uniforms[opticsMap[control.key]].value, control.max, `optics ${control.key} maximum`);
  optics.setControls({ [control.key]: -1e6 });
  close(optics.uniforms[opticsMap[control.key]].value, control.min, `optics ${control.key} minimum`);
}
optics.setControls(defaults.optics);
optics.setControls({ topLeft: .2, topRight: .4, bottomLeft: .6, bottomRight: .8 });
assert.deepEqual(optics.uniforms.cornerGains.value.toArray(), [.2, .4, .6, .8], 'corner controls map TL, TR, BL, BR in order');
optics.setControls({ topLeft: -5, topRight: 1e6, bottomLeft: NaN, bottomRight: '1' });
assert.deepEqual(optics.uniforms.cornerGains.value.toArray(), [0, 8, .6, .8], 'corner gains clamp and ignore invalid numbers');
optics.setControls({ amount: NaN, blur: Infinity, chromatic: '0', unknown: 5 });
close(optics.uniforms.opticalAmount.value, defaults.optics.amount, 'invalid lens amount is ignored');
close(optics.uniforms.blurLevel.value, defaults.optics.blur, 'invalid blur is ignored');
close(optics.uniforms.chromaticSize.value, defaults.optics.chromatic, 'invalid chromatic value is ignored');
assert.ok(!('unknown' in optics.uniforms));
optics.setControls({ speed: 1 });
optics.updateTime(10);
close(optics.uniforms.time.value, 10, 'optics starts at the supplied elapsed time');
optics.setControls({ speed: 0 });
optics.updateTime(40);
close(optics.uniforms.time.value, 10, 'zero speed freezes optics at its current phase');
optics.setControls({ speed: 2 });
optics.updateTime(41);
close(optics.uniforms.time.value, 12, 'optics resumes without a phase jump');
optics.setControls(numericExtreme('optics', 'max'));
optics.setBackground(numericExtreme('background', 'max'));
optics.updateTime(100);
finiteUniforms(optics.uniforms, 'all-maximum optics');
optics.dispose(); rockTexture.dispose(); landTexture.dispose();
report.optics = { mappedControls: Object.keys(opticsMap).length, independentCornerOrder: ['TL', 'TR', 'BL', 'BR'], clamped: true };

const sourceStone = new THREE.MeshStandardMaterial();
const sourceHeight = new THREE.DataTexture(new Uint8Array([32,32,32,255,192,192,192,255,224,224,224,255,64,64,64,255]),2,2,THREE.RGBAFormat);
sourceStone.userData.heightMap = sourceHeight;
const stone = createDarkRockMaterial(sourceStone);
assert.notEqual(stone,sourceStone,'stone controls operate on their own material');
const compileStone = () => {
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  stone.onBeforeCompile(shader);
  return shader;
};
const firstStoneShader=compileStone();
const stoneMap={scale:'uStoneScale',brightness:'uStoneBrightness',contrast:'uStoneContrast',saturation:'uStoneSaturation',crackStrength:'uCrackStrength',crackWidth:'uCrackWidth',crackDepth:'uCrackDepth',crackGloss:'uCrackGloss',crackMetalness:'uCrackMetalness',crackGlow:'uCrackGlow',crackThreshold:'uCrackThreshold'};
const readStone = key => key==='normal' ? stone.normalScale.x : key==='roughness' ? stone.roughness : firstStoneShader.uniforms[stoneMap[key]].value;
for(const control of groups.stone.controls.filter(control=>control.type!=='color')) close(readStone(control.key),defaults.stone[control.key],`initial stone ${control.key}`);
assert.equal(firstStoneShader.uniforms.uCrackStrength.value,0,'the new crack overlay is off by default');
assert.equal(firstStoneShader.uniforms.uCrackHeightMap.value,sourceHeight,'cracks reuse the source GPU height texture');
assert.equal(firstStoneShader.uniforms.uCrackMapMode.value,1,'the supplied height scan is the crack-mask source');
assert.deepEqual(firstStoneShader.uniforms.uCrackTexel.value.toArray(),[.5,.5],'crack texels follow the source scan resolution');
assert.equal(firstStoneShader.uniforms.uCrackColor.value.getHexString(),'8f8b80');
assert.ok(firstStoneShader.fragmentShader.includes('stoneTriplanar')&&!firstStoneShader.fragmentShader.includes('#include <map_fragment>'),'stone controls reach the triplanar shader');
assert.ok(firstStoneShader.fragmentShader.includes('stoneFractureNormal')&&!firstStoneShader.fragmentShader.includes('#include <normal_fragment_maps>'),'stone relief reaches the fracture-normal shader');
const stoneUniformRefs=Object.fromEntries([...Object.values(stoneMap),'uCrackColor','uCrackHeightMap','uCrackMapMode','uCrackTexel'].map(uniform=>[uniform,firstStoneShader.uniforms[uniform]]));
const stoneVersion=stone.version,stoneProgramKey=stone.customProgramCacheKey(),stoneColorRef=stone.color,stoneNormalScaleRef=stone.normalScale;
const crackColorRef=firstStoneShader.uniforms.uCrackColor.value;
const defaultStoneTint=stone.color.clone();
for(const control of groups.stone.controls.filter(control=>control.type!=='color')) {
  stone.setControls({[control.key]:1e6});close(readStone(control.key),control.max,`stone ${control.key} maximum`);
  stone.setControls({[control.key]:-1e6});close(readStone(control.key),control.min,`stone ${control.key} minimum`);
  for(const invalid of [NaN,Infinity,-Infinity,'1',null,{},[]]) {
    stone.setControls({[control.key]:invalid});close(readStone(control.key),control.min,`stone ${control.key} ignores invalid values`);
  }
}
stone.setControls({normal:0});assert.deepEqual(stone.normalScale.toArray(),[0,0],'zero relief disables normal-map strength');
stone.setControls({...defaults.stone,tint:'#A1B2C3',scale:1.3,brightness:1.6,contrast:1.2,saturation:.7,crackColor:'#13579B',crackStrength:2.2,crackGlow:3.7});
const expectedTint=new THREE.Color('#A1B2C3').multiply(defaultStoneTint);
assert.ok(stone.color.equals(expectedTint),'tint multiplies the neutral stone color');
assert.equal(firstStoneShader.uniforms.uCrackColor.value.getHexString(),'13579b','crack color changes the compiled material');
for(const invalidTint of ['#fff','red','#12345g',123456,null,{}]) {
  stone.setControls({tint:invalidTint});assert.ok(stone.color.equals(expectedTint),'invalid tint preserves the current stone color');
}
for(const invalidColor of ['#fff','red','#12345g',123456,null,{}]) {
  stone.setControls({crackColor:invalidColor});assert.equal(firstStoneShader.uniforms.uCrackColor.value.getHexString(),'13579b','invalid crack color preserves the current color');
}
const secondStoneShader=compileStone();
for(const [uniform,reference]of Object.entries(stoneUniformRefs)) {
  assert.equal(firstStoneShader.uniforms[uniform],reference,'existing compiled material retains uniform references');
  assert.equal(secondStoneShader.uniforms[uniform],reference,'later compiled variants share the same uniform references');
}
close(secondStoneShader.uniforms.uStoneScale.value,1.3,'controls set before compilation reach later shader variants');
close(firstStoneShader.uniforms.uStoneBrightness.value,1.6,'controls set after compilation reach the existing shader');
close(secondStoneShader.uniforms.uCrackStrength.value,2.2,'crack strength reaches later shader variants');
close(firstStoneShader.uniforms.uCrackGlow.value,3.7,'crack glow reaches the existing compiled shader');
stone.setControls(numericExtreme('stone','max'));
finiteUniforms(firstStoneShader.uniforms,'all-maximum stone');
assert.ok(Number.isFinite(stone.roughness)&&Number.isFinite(stone.metalness)&&stone.color.toArray().every(Number.isFinite)&&stone.normalScale.toArray().every(Number.isFinite),'all-maximum stone PBR properties are finite');
stone.setControls(defaults.stone);
for(const control of groups.stone.controls.filter(control=>control.type!=='color')) close(readStone(control.key),control.default,`reset stone ${control.key}`);
assert.equal(stone.color,stoneColorRef,'interactive tint reuses its Color object');
assert.equal(stone.normalScale,stoneNormalScaleRef,'interactive relief reuses its Vector2');
assert.equal(firstStoneShader.uniforms.uCrackColor.value,crackColorRef,'interactive cracks reuse their Color object');
assert.equal(firstStoneShader.uniforms.uCrackHeightMap.value,sourceHeight,'all crack edits keep the source texture identity');
assert.equal(stone.version,stoneVersion,'stone controls do not request shader recompilation');
assert.equal(stone.customProgramCacheKey(),stoneProgramKey,'stone controls preserve the shader program key');
assert.equal(sourceStone.roughness,1,'stone controls preserve the source material');
assert.deepEqual(sourceStone.normalScale.toArray(),[1,1]);
stone.dispose();sourceStone.dispose();sourceHeight.dispose();
report.stone={sliders:13,colorInputs:2,clamped:true,zeroRelief:true,defaultCrackOverlayOff:true,sourceHeightTextureReused:true,sharedCompiledUniforms:Object.keys(stoneUniformRefs).length,noShaderRecompile:true,finiteExpandedMaximum:true};

console.log(JSON.stringify(report, null, 2));
