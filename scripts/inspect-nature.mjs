import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const downloads = JSON.parse(fs.readFileSync(path.join(root, 'docs/nature-downloads.json'), 'utf8').replace(/^\uFEFF/, ''));
const rounded = n => Math.round(n * 1e6) / 1e6;
const summary = {
  downloadedOn: '2026-10-19',
  license: 'CC0-1.0',
  licenseUrl: 'https://polyhaven.com/license',
  totalAssetBytes: downloads.flatMap(a => a.files).reduce((n, f) => n + f.bytes, 0),
  loader: 'THREE.GLTFLoader; no Draco, KTX2, or custom extensions needed',
  geometryPlacement: 'Clone mesh.geometry; discard original node translations. For floating rock geometry.center(). For plants center X/Z and translate minimum Y to zero. Keep the authored uv attribute.',
  assets: [],
};
for (const download of downloads) {
  const relative = `public/assets/nature/${download.id}/${download.id}_2k.gltf`;
  const filename = path.join(root, relative);
  const model = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const bin = fs.readFileSync(path.join(path.dirname(filename), model.buffers[0].uri));
  const meshes = model.nodes.filter(n => Number.isInteger(n.mesh)).map(node => {
    const mesh = model.meshes[node.mesh];
    const primitive = mesh.primitives[0];
    const accessor = model.accessors[primitive.attributes.POSITION];
    const view = model.bufferViews[accessor.bufferView];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? 12;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < accessor.count; v++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = bin.readFloatLE(start + v * stride + axis * 4);
        if (!Number.isFinite(value)) throw new Error(`Non-finite position in ${node.name}`);
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(min[axis] - accessor.min[axis]) > 1e-6 || Math.abs(max[axis] - accessor.max[axis]) > 1e-6) {
        throw new Error(`Accessor bounds mismatch in ${node.name}`);
      }
    }
    return {
      name: node.name,
      vertices: accessor.count,
      triangles: model.accessors[primitive.indices].count / 3,
      min: min.map(rounded),
      max: max.map(rounded),
      dimensions: max.map((n, a) => rounded(n - min[a])),
      center: max.map((n, a) => rounded((n + min[a]) / 2)),
      originalTranslation: node.translation ?? [0, 0, 0],
      attributes: Object.keys(primitive.attributes),
    };
  });
  const dependencies = [...model.buffers, ...model.images].map(item => item.uri);
  for (const dependency of dependencies) {
    if (!fs.existsSync(path.join(path.dirname(filename), dependency))) throw new Error(`Missing dependency ${dependency}`);
  }
  summary.assets.push({
    id: download.id,
    authors: download.authors,
    assetUrl: download.assetUrl,
    gltfUrl: '/' + relative.replace(/^public\//, ''),
    suggestedMesh: download.id === 'fern_02' ? 'fern_02_b' : 'rock_moss_set_01_rock04',
    suggestedMeshReason: download.id === 'fern_02' ? 'Broadest, tallest clump for the hero; a and d are compact variants.' : 'Tall irregular boulder, dimensions 2.128 x 1.768 x 1.965; rock03 is a rounder alternative.',
    material: model.materials[0],
    alphaMapUrl: download.id === 'fern_02' ? '/assets/nature/fern_02/textures/fern_02_alpha_2k.png' : null,
    meshes,
  });
}
fs.writeFileSync(path.join(root, 'docs/nature-assets.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ totalAssetBytes: summary.totalAssetBytes, meshes: summary.assets.map(a => ({ id: a.id, names: a.meshes.map(m => m.name) })) }));
