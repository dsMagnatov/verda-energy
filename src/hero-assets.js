import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function centeredRock(source) {
  const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const scale = 2.8 / Math.max(size.x, size.z);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

// Load only scan geometry. The restored Dark Rock maps supply every surface.
export async function loadHeroAssets(manager) {
  const base = '/assets/nature/rock_moss_set_01/';
  const definition = await new THREE.FileLoader(manager).setResponseType('json').loadAsync(base + 'rock_moss_set_01_2k.gltf');
  definition.images = []; definition.textures = []; definition.samplers = [];
  definition.materials = [{ pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } }];
  for (const mesh of definition.meshes) for (const primitive of mesh.primitives) primitive.material = 0;
  const file = await new GLTFLoader(manager).parseAsync(definition, base);
  file.scene.updateMatrixWorld(true);
  const rocks = [];
  file.scene.traverse(mesh => { if (mesh.isMesh) rocks.push(mesh); });
  if (rocks.length < 4) throw new Error('Rock geometry is incomplete');
  const main = rocks.find(mesh => mesh.name.endsWith('rock04')) ?? rocks[0];
  return { mainGeometry: centeredRock(main), satelliteGeometries: rocks.filter(mesh => mesh !== main).map(centeredRock) };
}
