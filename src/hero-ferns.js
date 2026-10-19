import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createDefaultSceneSettings, getSceneControlLimits } from './scene-settings.js';

const FERN_ROOT = '/assets/nature/fern_02/';
const VARIANT_ORDER = ['fern_02_b', 'fern_02_c', 'fern_02_a', 'fern_02_d'];

/** Load the authored fern UVs and dedicated leaf mask, with a root at local Y=0. */
export async function loadHeroFernTemplates(manager) {
  const [asset, alphaMap] = await Promise.all([
    new GLTFLoader(manager).loadAsync(`${FERN_ROOT}fern_02_2k.gltf`),
    new THREE.TextureLoader(manager).loadAsync(`${FERN_ROOT}textures/fern_02_alpha_2k.png`),
  ]);

  // The source glTF diffuse is JPEG, so its declared MASK needs this separate mask.
  alphaMap.flipY = false;
  alphaMap.colorSpace = THREE.NoColorSpace;
  alphaMap.anisotropy = 4;
  alphaMap.needsUpdate = true;

  const materials = new Map();
  const meshes = [];
  asset.scene.traverse((source) => {
    if (!source.isMesh || !source.geometry.getAttribute('position')) return;

    const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
    let surface = materials.get(sourceMaterial);
    if (!surface) {
      const material = sourceMaterial.clone();
      material.name = 'Hero fern leaves';
      material.alphaMap = alphaMap;
      material.alphaTest = 0.5;
      material.transparent = false;
      material.depthWrite = true;
      material.side = THREE.DoubleSide;
      material.shadowSide = THREE.DoubleSide;
      material.roughness = 0.92;
      material.metalness = 0;
      material.envMapIntensity = 0.45;
      material.needsUpdate = true;

      const cutout = {
        map: material.map,
        alphaMap,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      };
      surface = {
        material,
        depth: new THREE.MeshDepthMaterial({ ...cutout, depthPacking: THREE.RGBADepthPacking }),
        distance: new THREE.MeshDistanceMaterial(cutout),
      };
      materials.set(sourceMaterial, surface);
    }

    const geometry = source.geometry.clone();
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const height = bounds.max.y - bounds.min.y;
    if (height <= 0) {
      geometry.dispose();
      return;
    }
    const centerX = (bounds.min.x + bounds.max.x) * 0.5;
    const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
    geometry.translate(-centerX, -bounds.min.y, -centerZ);
    geometry.scale(1 / height, 1 / height, 1 / height);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const template = new THREE.Mesh(geometry, surface.material);
    template.name = source.name;
    template.castShadow = true;
    template.receiveShadow = true;
    template.customDepthMaterial = surface.depth;
    template.customDistanceMaterial = surface.distance;
    template.userData.heroFern = true;
    meshes.push(template);
  });

  meshes.sort((a, b) => VARIANT_ORDER.indexOf(a.name) - VARIANT_ORDER.indexOf(b.name));
  if (!meshes.length) throw new Error('The fern asset contains no usable plant geometry.');
  return meshes;
}

/** Instances share the loaded maps/materials and unit-height geometry. */
export function createHeroFern(templates, { height = 0.4, variant = 0 } = {}) {
  if (!templates?.length) throw new Error('Fern templates must be loaded before creating a plant.');
  const index = ((Math.trunc(variant) % templates.length) + templates.length) % templates.length;
  const template = templates[index];
  const fern = new THREE.Mesh(template.geometry, template.material);
  fern.name = `Hero ${template.name}`;
  fern.scale.setScalar(Number.isFinite(height) && height > 0 ? height : 0.4);
  fern.castShadow = true;
  fern.receiveShadow = true;
  fern.customDepthMaterial = template.customDepthMaterial;
  fern.customDistanceMaterial = template.customDistanceMaterial;
  fern.userData.heroFern = true;
  return fern;
}

/** A single controlled material per source keeps shared scan maps and cutouts. */
export function createFernAppearance(ferns) {
  const defaults = createDefaultSceneSettings().ferns;
  const limits = getSceneControlLimits('ferns');
  const state = { ...defaults };
  const surfaces = new Map();
  const brightness = { value: state.brightness }, saturation = { value: state.saturation };
  for (const fern of ferns) {
    const sources = Array.isArray(fern.material) ? fern.material : [fern.material];
    const controlled = sources.map(source => {
      if (!surfaces.has(source)) {
        const material = source.clone();
        const baseColor = source.color.clone();
        material.name = `${source.name || 'Fern leaves'} — scene controls`;
        material.onBeforeCompile = shader => {
          shader.uniforms.uFernBrightness = brightness;
          shader.uniforms.uFernSaturation = saturation;
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
              uniform float uFernBrightness;
              uniform float uFernSaturation;`)
            .replace('#include <color_fragment>', `#include <color_fragment>
              float fernLuminance = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
              diffuseColor.rgb = max(vec3(0.), mix(vec3(fernLuminance), diffuseColor.rgb, uFernSaturation)) * uFernBrightness;`);
        };
        material.customProgramCacheKey = () => 'hero-fern-live-color-v1';
        material.userData.fernControls = { brightness, saturation };
        surfaces.set(source, { material, baseColor });
      }
      return surfaces.get(source).material;
    });
    fern.material = Array.isArray(fern.material) ? controlled : controlled[0];
  }
  const tint = new THREE.Color();
  function setControls(settings = {}) {
    for (const key of ['brightness','saturation','roughness']) {
      const value = settings[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const [minimum, maximum] = limits[key];
      state[key] = THREE.MathUtils.clamp(value, minimum, maximum);
    }
    if (typeof settings.tint === 'string' && /^#[\da-f]{6}$/i.test(settings.tint)) state.tint = settings.tint;
    tint.set(state.tint);
    brightness.value = state.brightness;
    saturation.value = state.saturation;
    for (const { material, baseColor } of surfaces.values()) {
      material.color.copy(baseColor).multiply(tint);
      material.roughness = THREE.MathUtils.clamp(state.roughness, 0, 1);
    }
  }
  setControls(defaults);
  return { setControls, state, brightness, saturation, materials: [...surfaces.values()].map(surface => surface.material) };
}
