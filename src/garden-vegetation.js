import * as THREE from 'three';
import { rand } from './verdant/math.js';
import { createDefaultSceneSettings, getSceneControlLimits } from './scene-settings.js';

const GRASS_CLUSTERS = 28000;
const BLADES_PER_CLUSTER = 5;
const FERN_COUNT = 84;
const POND = { x: 0, z: -3.5, radiusX: 4.8, radiusZ: 3.6 };

function outsideWaterAndPath(x, z) {
  const water = (x / POND.radiusX) ** 2 + ((z - POND.z) / POND.radiusZ) ** 2;
  const path = z > .35 && z < 15.4 && Math.abs(x) < .94;
  return water > 1.035 && !path && Math.abs(x) < 14 && z > -17 && z < 16;
}

function shortGrassGeometry() {
  const positions = [], colors = [], indices = [];
  const root = new THREE.Color('#173d25');
  const middle = new THREE.Color('#45663a');
  const tip = new THREE.Color('#82905a');
  const tint = new THREE.Color();
  for (let blade = 0; blade < BLADES_PER_CLUSTER; blade++) {
    const angle = blade * 2.39996323;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const bladeHeight = [.78, 1, .87, .69, .93][blade];
    const rootX = dx * .21, rootZ = dz * .21;
    const start = positions.length / 3;
    for (let segment = 0; segment <= 3; segment++) {
      const t = segment / 3;
      const width = .06 * (1 - t * .98);
      const curve = t * t * (.27 + blade * .025);
      tint.copy(root).lerp(middle, Math.min(1, t * 1.6));
      if (t > .5) tint.lerp(tip, (t - .5) * 1.1);
      for (const side of [-1, 1]) {
        positions.push(rootX + dx * curve - dz * width * side,
          t * bladeHeight, rootZ + dz * curve + dx * width * side);
        colors.push(tint.r, tint.g, tint.b);
      }
    }
    for (let segment = 0; segment < 3; segment++) {
      const index = start + segment * 2;
      indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Short meadow grass and isolated PBR copies of the scanned fern templates. */
export function createGardenVegetation({
  fernTemplates = [], uniforms = {}, heightAt = () => 0, isPlantable = outsideWaterAndPath,
} = {}) {
  const group = new THREE.Group();
  group.name = 'Lush pond banks and short garden grass';
  const random = rand(783205);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  // Own wrappers prevent a paused garden from changing the hero's shared time.
  const breezeTime = { value: Number.isFinite(uniforms.time?.value) ? uniforms.time.value : 0 };
  const breezeAmount = { value: 1 };
  const controls = { ...createDefaultSceneSettings().gardenGrass };
  const limits = getSceneControlLimits('gardenGrass');
  const grassTime = { value: breezeTime.value };
  const grassBreeze = { value: controls.breeze };
  const grassBrightness = { value: controls.brightness };
  const grassSaturation = { value: controls.saturation };
  let previousTime = null, lastReducedMotion = false;
  const ownedMaterials = new Set();
  const fernMaterialCopies = new Map();
  let disposed = false;
  let drawQuality = 1;

  function windyMaterial(source, amplitude, key, motion = { time: breezeTime, amount: breezeAmount }) {
    const material = source.clone();
    const previousCompile = source.onBeforeCompile;
    material.name = `${source.name || 'Garden foliage'} — garden breeze`;
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile?.call(material, shader, renderer);
      shader.uniforms.uGardenPlantTime = motion.time;
      shader.uniforms.uGardenPlantBreeze = motion.amount;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        uniform float uGardenPlantTime;
        uniform float uGardenPlantBreeze;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec2 gardenPlantRoot = vec2(0.);
          #ifdef USE_INSTANCING
            gardenPlantRoot = instanceMatrix[3].xz;
          #endif
          float gardenPlantPhase = dot(gardenPlantRoot, vec2(.73, 1.13));
          float gardenPlantTip = pow(clamp(position.y, 0., 1.), 2.);
          vec2 gardenPlantWind = vec2(
            sin(uGardenPlantTime * .72 + gardenPlantPhase) + .24 * sin(uGardenPlantTime * 1.37 + gardenPlantPhase * 2.1),
            cos(uGardenPlantTime * .58 + gardenPlantPhase * .8)
          );
          transformed.xz += gardenPlantWind * gardenPlantTip * uGardenPlantBreeze * ${amplitude.toFixed(4)};`);
      if (key === 'grass') {
        shader.uniforms.uGardenGrassBrightness = grassBrightness;
        shader.uniforms.uGardenGrassSaturation = grassSaturation;
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
          uniform float uGardenGrassBrightness;
          uniform float uGardenGrassSaturation;`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            float gardenGrassLuminance = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
            diffuseColor.rgb = max(vec3(0.), mix(vec3(gardenGrassLuminance), diffuseColor.rgb,
              uGardenGrassSaturation)) * uGardenGrassBrightness;`);
      }
    };
    material.customProgramCacheKey = () => `garden-rooted-breeze-v1-${key}-${amplitude}`;
    ownedMaterials.add(material);
    return material;
  }

  function canPlant(x, z) {
    return outsideWaterAndPath(x, z) && isPlantable(x, z) && Number.isFinite(heightAt(x, z));
  }

  function plant(mesh, index, x, z, height, width, lean = .06) {
    dummy.position.set(x, heightAt(x, z) - .006, z);
    dummy.rotation.set((random() - .5) * lean, random() * Math.PI * 2, (random() - .5) * lean);
    dummy.scale.set(height * width, height, height * width);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    tint.setHSL(.27 + random() * .045, .13 + random() * .14, .72 + random() * .18);
    mesh.setColorAt(index, tint);
  }

  function finish(mesh, extraRadius = .1) {
    mesh.userData.gardenPlant = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += extraRadius;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const grassGeometry = shortGrassGeometry();
  const grassSource = new THREE.MeshStandardMaterial({
    name: 'Short forest grass', color: '#e5edce', vertexColors: true,
    roughness: .92, metalness: 0, side: THREE.DoubleSide,
  });
  const grassBaseColor = grassSource.color.clone();
  const grassMaterial = windyMaterial(grassSource, .055, 'grass', { time: grassTime, amount: grassBreeze });
  grassMaterial.userData.gardenGrassUniforms = { time: grassTime, breeze: grassBreeze,
    brightness: grassBrightness, saturation: grassSaturation };
  grassSource.dispose();
  const grass = new THREE.InstancedMesh(grassGeometry, grassMaterial, GRASS_CLUSTERS);
  grass.name = 'Twenty-eight thousand short curved grass clusters';
  grass.userData.gardenPlantType = 'grass';
  grass.castShadow = false;
  let grassCount = 0;
  for (let attempt = 0; grassCount < GRASS_CLUSTERS && attempt < GRASS_CLUSTERS * 24; attempt++) {
    const region = random();
    let x, z;
    if (region < .31) {
      const angle = random() * Math.PI * 2;
      const bank = 1.045 + Math.pow(random(), 1.7) * .62;
      x = Math.cos(angle) * POND.radiusX * bank;
      z = POND.z + Math.sin(angle) * POND.radiusZ * bank;
    } else if (region < .52) {
      x = (random() < .5 ? -1 : 1) * (1.05 + Math.pow(random(), 1.3) * 6.2);
      z = .8 + random() * 14.4;
    } else {
      x = (random() - .5) * 27.8;
      z = -16.8 + random() * 32.5;
    }
    if (!canPlant(x, z)) continue;
    const shore = (x / POND.radiusX) ** 2 + ((z - POND.z) / POND.radiusZ) ** 2;
    const bankGrowth = shore < 1.75 ? .025 : 0;
    const height = .08 + Math.pow(random(), .7) * (.175 + bankGrowth);
    plant(grass, grassCount++, x, z, height, .9 + random() * .65, .12);
  }
  grass.count = grassCount;
  // Only the basis columns change under editor transforms; every authored root
  // remains in place, and repeated edits always start from these exact bases.
  const grassBaseMatrices = grass.instanceMatrix.array.slice();
  if (grassCount) finish(grass, .4);

  const fernPositions = [];
  if (fernTemplates.length) {
    for (let attempt = 0; fernPositions.length < FERN_COUNT && attempt < 12000; attempt++) {
      const index = fernPositions.length;
      let x, z;
      if (index < 42) {
        x = (random() < .5 ? -1 : 1) * (5.05 + random() * 2.6);
        z = -8.4 + random() * 10.1;
      } else if (index < 74) {
        x = (random() < .5 ? -1 : 1) * (2.05 + random() * 4.85);
        z = 3 + random() * 9.1;
      } else {
        x = (random() - .5) * 10.5;
        z = -10.1 + random() * 2;
      }
      if (!canPlant(x, z)) continue;
      if (fernPositions.some(plant => (plant.x - x) ** 2 + (plant.z - z) ** 2 < .58 ** 2)) continue;
      const foreground = z > 2;
      const height = foreground ? .68 + random() * .52 : .45 + random() * .53;
      fernPositions.push({ x, z, height, variant: index % fernTemplates.length });
    }
  }

  function fernMaterial(source, kind) {
    if (!source) return undefined;
    let material = fernMaterialCopies.get(source);
    if (!material) {
      material = windyMaterial(source, .028, `fern-${kind}`);
      if (material.isMeshStandardMaterial) {
        material.roughness = .94;
        material.metalness = 0;
      }
      fernMaterialCopies.set(source, material);
    }
    return material;
  }

  for (let variant = 0; variant < fernTemplates.length; variant++) {
    const placements = fernPositions.filter(plant => plant.variant === variant);
    if (!placements.length) continue;
    const template = fernTemplates[variant];
    const source = Array.isArray(template.material) ? template.material[0] : template.material;
    const mesh = new THREE.InstancedMesh(template.geometry, fernMaterial(source, 'leaves'), placements.length);
    mesh.name = `Scanned garden fern bank ${variant + 1}`;
    mesh.userData.gardenPlantType = 'fern';
    mesh.castShadow = true;
    mesh.customDepthMaterial = fernMaterial(template.customDepthMaterial, 'depth');
    mesh.customDistanceMaterial = fernMaterial(template.customDistanceMaterial, 'distance');
    for (let index = 0; index < placements.length; index++) {
      const { x, z, height } = placements[index];
      plant(mesh, index, x, z, height, .88 + random() * .24, .08);
    }
    finish(mesh, .12);
  }

  const counts = {
    grassClusters: grassCount, grassBlades: grassCount * BLADES_PER_CLUSTER,
    ferns: fernPositions.length, drawCalls: group.children.length,
  };
  group.userData.vegetationCounts = counts;

  function setControls(values = {}) {
    if (disposed) return;
    const oldHeight = controls.height, oldWidth = controls.width, oldDensity = controls.density;
    for (const [key, [minimum, maximum]] of Object.entries(limits)) {
      if (typeof values[key] === 'number' && Number.isFinite(values[key])) {
        controls[key] = THREE.MathUtils.clamp(values[key], minimum, maximum);
      }
    }
    if (typeof values.color === 'string' && /^#[\da-f]{6}$/i.test(values.color)) controls.color = values.color.toLowerCase();
    if (controls.height !== oldHeight || controls.width !== oldWidth) {
      const matrices = grass.instanceMatrix.array;
      for (let index = 0; index < grassCount; index++) {
        const offset = index * 16;
        for (let entry = 0; entry < 16; entry++) {
          const factor = entry < 3 || (entry >= 8 && entry < 11) ? controls.width
            : entry >= 4 && entry < 7 ? controls.height : 1;
          matrices[offset + entry] = grassBaseMatrices[offset + entry] * factor;
        }
      }
      grass.instanceMatrix.needsUpdate = true;
    }
    grass.count = Math.round(grassCount * controls.density * drawQuality);
    grass.visible = grass.count > 0;
    if (grass.count && (controls.height !== oldHeight || controls.width !== oldWidth || controls.density !== oldDensity)) {
      grass.computeBoundingBox();
      grass.computeBoundingSphere();
      if (grass.boundingSphere) grass.boundingSphere.radius += .4;
    }
    counts.grassClusters = grass.count;
    counts.grassBlades = grass.count * BLADES_PER_CLUSTER;
    grassMaterial.color.copy(grassBaseColor).multiply(tint.set(controls.color));
    grassMaterial.roughness = controls.roughness;
    grassBrightness.value = controls.brightness;
    grassSaturation.value = controls.saturation;
    grassBreeze.value = lastReducedMotion ? 0 : controls.breeze;
  }

  setControls(controls);
  return {
    group,
    counts,
    setControls,
    setQuality(value) {
      const quality=Number.isFinite(value)?THREE.MathUtils.clamp(value,.25,1):1;
      if (quality===drawQuality) return;
      drawQuality=quality;
      setControls(controls);
    },
    get controls() { return { ...controls }; },
    update(time = 0, reducedMotion = false) {
      if (disposed) return;
      const nextTime = Number.isFinite(time) ? time : 0;
      const delta = previousTime === null ? 0 : Math.max(0, Math.min(.1, nextTime - previousTime));
      previousTime = nextTime;
      lastReducedMotion = Boolean(reducedMotion);
      if (!reducedMotion && controls.breeze > 0 && controls.speed > 0) grassTime.value += delta * controls.speed;
      grassBreeze.value = reducedMotion ? 0 : controls.breeze;
      breezeTime.value = nextTime;
      breezeAmount.value = reducedMotion ? 0 : 1;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of group.children) mesh.dispose();
      grassGeometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      group.clear();
    },
  };
}
