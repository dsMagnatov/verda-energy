import * as THREE from 'three';
import { createDefaultSceneSettings, getSceneControlLimits } from './scene-settings.js';

// Local X is the long side, Z is the short side and +Y is the front. The
// mounting face sits at Y=0 so a caller can fit this group to a scanned surface.
export function createSolarPanel({ width = 1.65, depth = 1.05 } = {}) {
  width = Number.isFinite(width) ? Math.max(.25, width) : 1.65;
  depth = Number.isFinite(depth) ? Math.max(.25, depth) : 1.05;
  const group = new THREE.Group();
  group.name = 'Sixty-cell monocrystalline solar module';
  const height = .041, rail = .022, gap = .008;
  const innerWidth = width - rail * 2, innerDepth = depth - rail * 2;
  const rows = 6, columns = 10;
  const cellWidth = (innerWidth - .014 - gap * (columns - 1)) / columns;
  const cellDepth = (innerDepth - .014 - gap * (rows - 1)) / rows;
  const dummy = new THREE.Object3D();
  const box = new THREE.BoxGeometry(1, 1, 1);

  // A small data texture gives the aluminium a directional brushed finish. It
  // needs no DOM/Canvas, external textures or environment-map download.
  const brushedData = new Uint8Array(128 * 8 * 4);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 128; x++) {
      const offset = (y * 128 + x) * 4;
      const value = 170 + Math.round(28 * Math.sin(x * 4.73) + 12 * Math.sin(x * 1.97 + y * .15));
      brushedData[offset] = brushedData[offset + 1] = brushedData[offset + 2] = value;
      brushedData[offset + 3] = 255;
    }
  }
  const brushed = new THREE.DataTexture(brushedData, 128, 8, THREE.RGBAFormat);
  brushed.wrapS = brushed.wrapT = THREE.RepeatWrapping;
  brushed.minFilter = THREE.LinearMipmapLinearFilter;
  brushed.magFilter = THREE.LinearFilter;
  brushed.generateMipmaps = true; brushed.needsUpdate = true;
  const aluminium = new THREE.MeshStandardMaterial({ color: '#8b999f', metalness: .88, roughness: .48, roughnessMap: brushed });
  const darkEdge = new THREE.MeshStandardMaterial({ color: '#171d22', metalness: .72, roughness: .42 });
  const backing = new THREE.MeshStandardMaterial({ color: '#101820', metalness: .22, roughness: .7 });
  const cellMaterial = new THREE.MeshPhysicalMaterial({
    color: '#102a46', metalness: .24, roughness: .30,
    clearcoat: .55, clearcoatRoughness: .22,
  });
  // Electrodes narrower than one screen pixel need analytic filtering. Thin
  // geometry shimmers at hero distance; this integrates each stripe over its
  // pixel footprint and fades unresolved detail instead of making a grey mesh.
  const gridStrength = { value: 1 };
  cellMaterial.onBeforeCompile = shader => {
    shader.uniforms.uSolarCellSize = { value: new THREE.Vector2(cellWidth, cellDepth) };
    shader.uniforms.uSolarGridStrength = gridStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec2 uSolarCellSize;
        varying vec2 vSolarCellUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSolarCellUv = position.xz / uSolarCellSize + .5;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec2 uSolarCellSize;
        uniform float uSolarGridStrength;
        varying vec2 vSolarCellUv;
        float solarFilteredStroke(float distanceToLine, float halfWidth, float footprint) {
          float pixelWidth = max(footprint, .00001);
          float overlap = clamp((halfWidth + pixelWidth * .5 - distanceToLine) / pixelWidth, 0., 1.);
          return min(2. * halfWidth / pixelWidth, overlap);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 solarPixel = max(fwidth(vSolarCellUv), vec2(.00001));
        float solarBusDistance = min(abs(vSolarCellUv.x - .23), min(abs(vSolarCellUv.x - .5), abs(vSolarCellUv.x - .77)));
        float solarBus = solarFilteredStroke(solarBusDistance, .00042 / uSolarCellSize.x, solarPixel.x);
        solarBus *= 1. - smoothstep(.055, .16, solarPixel.x);
        float solarFingerDistance = abs(fract(vSolarCellUv.y * 15. + .5) - .5) / 15.;
        float solarFingers = solarFilteredStroke(solarFingerDistance, .00012 / uSolarCellSize.y, solarPixel.y);
        solarFingers *= 1. - smoothstep(.22, .62, solarPixel.y * 15.);
        float solarEdge = smoothstep(.015, .035, min(min(vSolarCellUv.x, 1. - vSolarCellUv.x), min(vSolarCellUv.y, 1. - vSolarCellUv.y)));
        float solarMetalCoverage = clamp(max(solarBus * .58, solarFingers * .22) * solarEdge * uSolarGridStrength, 0., 1.);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.24, .31, .38), solarMetalCoverage);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .28, solarMetalCoverage);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, .72, solarMetalCoverage);`);
  };
  cellMaterial.customProgramCacheKey = () => 'solar-wafer-filtered-electrodes-v2';
  const conductor = new THREE.MeshStandardMaterial({ color: '#a2b3c3', metalness: .82, roughness: .36 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#9fb8cf', roughness: .15, metalness: .02,
    transparent: true, opacity: .035, depthWrite: false,
    clearcoat: .65, clearcoatRoughness: .15, ior: 1.5,
  });

  function mesh(geometry, material, name, castShadow = true) {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.castShadow = castShadow; object.receiveShadow = true;
    group.add(object); return object;
  }
  function instances(geometry, material, count, name, castShadow = false) {
    const object = new THREE.InstancedMesh(geometry, material, count);
    object.name = name;
    object.castShadow = castShadow; object.receiveShadow = true;
    object.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    group.add(object); return object;
  }
  function setInstance(object, index, x, y, z, sx, sy, sz) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0);
    dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
    object.setMatrixAt(index, dummy.matrix);
  }

  const back = mesh(box, backing, 'Rigid charcoal module backsheet');
  back.position.y = .013;
  back.scale.set(innerWidth, .026, innerDepth);
  const frame = instances(box, aluminium, 4, 'Brushed aluminium perimeter frame', true);
  setInstance(frame, 0, -width / 2 + rail / 2, height / 2, 0, rail, height, depth);
  setInstance(frame, 1, width / 2 - rail / 2, height / 2, 0, rail, height, depth);
  setInstance(frame, 2, 0, height / 2, -depth / 2 + rail / 2, innerWidth, height, rail);
  setInstance(frame, 3, 0, height / 2, depth / 2 - rail / 2, innerWidth, height, rail);
  const seal = instances(box, darkEdge, 4, 'Dark anodised glass seal');
  setInstance(seal, 0, -innerWidth / 2 + .003, .032, 0, .006, .008, innerDepth);
  setInstance(seal, 1, innerWidth / 2 - .003, .032, 0, .006, .008, innerDepth);
  setInstance(seal, 2, 0, .032, -innerDepth / 2 + .003, innerWidth, .008, .006);
  setInstance(seal, 3, 0, .032, innerDepth / 2 - .003, innerWidth, .008, .006);

  // The clipped corners and physical gaps distinguish real individual wafers
  // from a flat printed grid. Ten columns by six rows form a landscape module.
  const cx = cellWidth / 2, cz = cellDepth / 2, cut = Math.min(cellWidth, cellDepth) * .075;
  const wafer = new THREE.Shape();
  wafer.moveTo(-cx + cut, -cz);
  wafer.lineTo(cx - cut, -cz); wafer.lineTo(cx, -cz + cut);
  wafer.lineTo(cx, cz - cut); wafer.lineTo(cx - cut, cz);
  wafer.lineTo(-cx + cut, cz); wafer.lineTo(-cx, cz - cut);
  wafer.lineTo(-cx, -cz + cut); wafer.closePath();
  const cellGeometry = new THREE.ExtrudeGeometry(wafer, { depth: .00065, bevelEnabled: false, curveSegments: 1, steps: 1 });
  cellGeometry.rotateX(-Math.PI / 2);
  const cells = instances(cellGeometry, cellMaterial, rows * columns, 'Sixty individually cut blue-black silicon wafers');
  const tint = new THREE.Color();
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = (column - (columns - 1) / 2) * (cellWidth + gap);
      const z = (row - (rows - 1) / 2) * (cellDepth + gap);
      setInstance(cells, index, x, .027, z, 1, 1, 1);
      tint.setRGB(.94 + .025 * Math.sin(index * 7.2), .95 + .025 * Math.sin(index * 3.71), .98);
      cells.setColorAt(index++, tint);
    }
  }
  const cover = mesh(box, glass, 'Single protective low-iron glass cover', false);
  cover.position.y = .032;
  cover.scale.set(innerWidth - .009, .003, innerDepth - .009);
  cover.renderOrder = 1;

  const screwGeometry = new THREE.CylinderGeometry(.0027, .0027, .0007, 8);
  const screws = instances(screwGeometry, conductor, 8, 'Recessed perimeter fixings');
  const fixingPoints = [
    [-width / 2 + rail / 2, -depth / 2 + rail / 2],
    [width / 2 - rail / 2, -depth / 2 + rail / 2],
    [-width / 2 + rail / 2, depth / 2 - rail / 2],
    [width / 2 - rail / 2, depth / 2 - rail / 2],
    [-width / 2 + rail / 2, 0], [width / 2 - rail / 2, 0],
    [0, -depth / 2 + rail / 2], [0, depth / 2 - rail / 2],
  ];
  fixingPoints.forEach(([x, z], i) => setInstance(screws, i, x, .0407, z, 1, 1, 1));
  for (const child of group.children) {
    if (child.isInstancedMesh) {
      child.instanceMatrix.needsUpdate = true;
      child.computeBoundingBox(); child.computeBoundingSphere();
    }
  }
  group.userData.dimensions = { width, depth, height: .04105 };
  group.userData.frontNormal = [0, 1, 0];
  group.userData.supportPoints = [
    [-width * .38, 0, -depth * .35], [width * .38, 0, -depth * .35],
    [-width * .38, 0, depth * .35], [width * .38, 0, depth * .35],
  ];
  // Material controls keep the real wafer/frame geometry and share uniforms
  // across compiled shader variants. Updating a slider does not rebuild either.
  const defaults = createDefaultSceneSettings().solar ?? {
    roughness: .30, metalness: .24, glassOpacity: .035, brightness: 1,
    gridStrength: 1, frameRoughness: .48, tint: '#ffffff', frameColor: '#8b999f',
  };
  const limits = getSceneControlLimits('solar');
  const controlledMaterials = [aluminium, darkEdge, backing, cellMaterial, conductor, glass];
  const baseColors = controlledMaterials.map(material => material.color.clone());
  const solarTint = new THREE.Color(), frameTint = new THREE.Color();
  const state = { ...defaults };
  const numericKeys = ['roughness','metalness','glassOpacity','brightness','gridStrength','frameRoughness'];
  group.setAppearance = (settings = {}) => {
    for (const key of numericKeys) {
      const value = settings[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const [minimum, maximum] = limits[key] ?? [0, key === 'brightness' || key === 'gridStrength' ? 4 : 1];
      state[key] = THREE.MathUtils.clamp(value, minimum, maximum);
    }
    for (const key of ['tint','frameColor']) if (typeof settings[key] === 'string' && /^#[\da-f]{6}$/i.test(settings[key])) state[key] = settings[key];
    solarTint.set(state.tint); frameTint.set(state.frameColor);
    for (let i = 0; i < controlledMaterials.length; i++) {
      controlledMaterials[i].color.copy(baseColors[i]).multiply(solarTint).multiplyScalar(state.brightness);
    }
    aluminium.color.copy(frameTint).multiplyScalar(state.brightness);
    cellMaterial.roughness = THREE.MathUtils.clamp(state.roughness, 0, 1);
    cellMaterial.metalness = THREE.MathUtils.clamp(state.metalness, 0, 1);
    aluminium.roughness = THREE.MathUtils.clamp(state.frameRoughness, 0, 1);
    glass.opacity = THREE.MathUtils.clamp(state.glassOpacity, 0, 1);
    gridStrength.value = state.gridStrength;
  };
  group.userData.appearance = state;
  group.userData.gridStrength = gridStrength;
  group.setAppearance(defaults);
  return group;
}
