import * as THREE from 'three';
import { createDarkRockMaterial } from './rock-material.js';
import { createHeroFern, createFernAppearance } from './hero-ferns.js';

const UP = new THREE.Vector3(0, 1, 0);

// CPU-only assembly also makes placement and ownership testable without a
// browser or a second copy of the scan-loading pipeline.
export function createGardenIntroModel({ rockGeometry, stoneMaterial, fernTemplates }) {
  if (!rockGeometry?.isBufferGeometry || !stoneMaterial?.isMaterial || !fernTemplates?.length) {
    throw new TypeError('The garden card requires the loaded rock and fern scans.');
  }

  const geometry = rockGeometry.clone();
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const scale = 2.8 / Math.max(size.x, size.z, .001);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(scale * 1.12, scale * .76, scale);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = createDarkRockMaterial(stoneMaterial);
  const model = new THREE.Group();
  model.name = 'Garden arrival card — rock and fern';

  const rock = new THREE.Mesh(geometry, material);
  rock.name = 'Arrival card Dark Rock';
  rock.rotation.set(.04, -.38, -.055);
  rock.castShadow = rock.receiveShadow = true;
  model.add(rock);
  rock.updateWorldMatrix(true, false);

  // A real upper-triangle hit roots the foliage; its growth axis stays mostly
  // upright rather than inheriting the scan's arbitrary authored orientation.
  const bounds = new THREE.Box3().setFromObject(rock);
  const rockCenter = bounds.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(
    new THREE.Vector3(rockCenter.x - .12, bounds.max.y + 2, rockCenter.z + .03),
    new THREE.Vector3(0, -1, 0),
  );
  const surface = ray.intersectObject(rock, false)[0];
  if (!surface?.face) {
    geometry.dispose();
    material.dispose();
    throw new Error('The arrival card fern could not find an upper rock surface.');
  }
  const normal = surface.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(rock.matrixWorld)).normalize();
  if (normal.y < 0) normal.negate();
  const fern = createHeroFern(fernTemplates, { height: 1.65, variant: 0 });
  // A slightly tighter frond crown lets the stone remain legible in the
  // card's wide, short viewport without cutting off the outer leaves.
  fern.scale.x *= .8;
  fern.scale.z *= .8;
  fern.name = 'Arrival card rock-rooted fern';
  fern.position.copy(surface.point).addScaledVector(normal, -.018);
  fern.userData.rootSurfaceLocal = rock.worldToLocal(surface.point.clone()).toArray();
  fern.quaternion.setFromUnitVectors(UP, UP.clone().lerp(normal, .2).normalize())
    .multiply(new THREE.Quaternion().setFromAxisAngle(UP, -.28));
  // Geometry and cutout shadow materials remain shared with the loaded asset.
  // createFernAppearance owns only the cloned visible leaf material.
  model.add(fern);
  const fernAppearance = createFernAppearance([fern]);
  const fernPose = fern.quaternion.clone();
  const breeze = new THREE.Quaternion();
  const breezeAngles = new THREE.Euler();

  const composition = new THREE.Box3().setFromObject(model);
  const compositionCenter = composition.getCenter(new THREE.Vector3());
  model.position.sub(compositionCenter);

  let disposed = false;
  let breezeStrength = 1;
  let breezeSpeed = 1;
  function setControls(settings = {}) {
    if (disposed || !settings || typeof settings !== 'object') return;
    material.setControls(settings.stone);
    if (settings.ferns && typeof settings.ferns === 'object') {
      fernAppearance.setControls(settings.ferns);
      if (Number.isFinite(settings.ferns.breeze)) breezeStrength = THREE.MathUtils.clamp(settings.ferns.breeze, 0, 8);
      if (Number.isFinite(settings.ferns.breezeSpeed)) breezeSpeed = THREE.MathUtils.clamp(settings.ferns.breezeSpeed, 0, 8);
    }
  }
  function update(time = 0, reducedMotion = false) {
    if (disposed) return;
    const clock = Number.isFinite(time) ? time : 0;
    const motion = reducedMotion ? 0 : 1;
    model.rotation.y = Math.sin(clock * .18) * .055 * motion;
    model.rotation.z = Math.sin(clock * .14) * .014 * motion;
    breezeAngles.set(Math.sin(clock * breezeSpeed * .65) * .026 * breezeStrength * motion, 0, Math.sin(clock * breezeSpeed * .48 + 1.1) * .018 * breezeStrength * motion);
    breeze.setFromEuler(breezeAngles);
    fern.quaternion.copy(fernPose).multiply(breeze);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    model.removeFromParent();
    geometry.dispose();
    material.dispose();
    for (const leafMaterial of fernAppearance.materials) leafMaterial.dispose();
    model.clear();
  }
  return { group: model, rock, fern, setControls, update, dispose };
}

// The card is an independent, small transparent view of the already loaded
// scans. Its renderer never starts a loop: the main scene supplies visibility
// and time, so an offscreen card costs no rendering work.
export async function createGardenIntroArt({ canvas, rockGeometry, stoneMaterial, fernTemplates, compact = false }) {
  if (!canvas) throw new TypeError('The garden card requires a canvas.');
  const art = createGardenIntroModel({ rockGeometry, stoneMaterial, fernTemplates });
  const model = art.group;
  const scene = new THREE.Scene();
  scene.add(model);

  const ambient = new THREE.HemisphereLight('#edf0e6', '#525a40', 1.1);
  const key = new THREE.DirectionalLight('#fff2d9', 1.8);
  key.position.set(-3.5, 5, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.left = key.shadow.camera.bottom = -3.5;
  key.shadow.camera.right = key.shadow.camera.top = 3.5;
  key.shadow.camera.near = .5;
  key.shadow.camera.far = 15;
  key.shadow.bias = -.00015;
  key.shadow.normalBias = .015;
  key.shadow.radius = 2;
  const fill = new THREE.DirectionalLight('#d3e2cd', .8);
  fill.position.set(4, 1.5, 2);
  const rim = new THREE.DirectionalLight('#f8f4d9', .9);
  rim.position.set(1, 4, -3);
  scene.add(ambient, key, key.target, fill, rim);

  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 30);
  // A slightly higher view exposes the stone's upper fractures as well as
  // its front face, while retaining the upright silhouette of the fern.
  camera.position.set(0, 1.65, 8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  } catch (error) {
    art.dispose();
    key.dispose();
    throw error;
  }

  let disposed = false;
  let dirty = true;
  let lastRender = -Infinity;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let lastReducedMotion = null;
  const cameraBounds = new THREE.Box3();
  const vertex = new THREE.Vector3();
  const meshToCamera = new THREE.Matrix4();
  const neutralSunlight = new THREE.Color('#f1f3ea');
  const warmSunlight = new THREE.Color('#ffd5aa');

  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const nextWidth = Math.round(rect.width), nextHeight = Math.round(rect.height);
    const nextRatio = Math.min(globalThis.devicePixelRatio || 1, compact ? 1.5 : 2, (compact ? 768 : 1024) / Math.max(nextWidth, nextHeight));
    if (width === nextWidth && height === nextHeight && pixelRatio === nextRatio) return;
    width = nextWidth;
    height = nextHeight;
    pixelRatio = nextRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);

    // Project the actual scan vertices rather than a rotated world bounding
    // box: its empty corners previously left a substantial border around the
    // close-up. This resize-only pass keeps every outer frond in view while
    // allowing the rock texture to occupy more of the enlarged card.
    model.updateWorldMatrix(true, true);
    cameraBounds.makeEmpty();
    model.traverse(mesh => {
      const positions = mesh.isMesh && mesh.geometry.getAttribute('position');
      if (!positions || !mesh.visible) return;
      meshToCamera.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
      for (let index = 0; index < positions.count; index++) {
        vertex.fromBufferAttribute(positions, index).applyMatrix4(meshToCamera);
        cameraBounds.expandByPoint(vertex);
      }
    });
    const centerX = (cameraBounds.min.x + cameraBounds.max.x) * .5;
    const centerY = (cameraBounds.min.y + cameraBounds.max.y) * .5;
    const halfWidth = (cameraBounds.max.x - cameraBounds.min.x) * .5 * 1.04;
    const halfHeight = (cameraBounds.max.y - cameraBounds.min.y) * .5 * 1.04;
    const aspect = width / height;
    const fitHeight = Math.max(halfHeight, halfWidth / aspect, .1);
    camera.left = centerX - fitHeight * aspect;
    camera.right = centerX + fitHeight * aspect;
    camera.top = centerY + fitHeight;
    camera.bottom = centerY - fitHeight;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  function setControls(settings = {}) {
    if (disposed || !settings || typeof settings !== 'object') return;
    art.setControls(settings);
    const sunlight = settings.gardenRays ?? settings.rays;
    if (sunlight && typeof sunlight === 'object') {
      // Preserve the saved garden's warmth and intensity response, with a
      // smaller exposure range suited to a close-up transparent card view.
      // High scene-light values must not erase the scan's fracture detail.
      const intensity = Number.isFinite(sunlight.intensity) ? THREE.MathUtils.clamp(sunlight.intensity, 0, 12) : 1;
      const warmth = Number.isFinite(sunlight.warmth) ? THREE.MathUtils.clamp(sunlight.warmth, 0, 1) : .58;
      const energy = .7 + Math.sqrt(intensity) * .14;
      key.color.lerpColors(neutralSunlight, warmSunlight, warmth);
      rim.color.copy(key.color);
      key.intensity = 1.8 * energy;
      ambient.intensity = 1.1 * energy;
      fill.intensity = .8 * energy;
      rim.intensity = .9 * energy;
    }
    dirty = true;
  }

  function update(time = 0, visible = false, reducedMotion = false) {
    if (disposed || !visible || width === 0 || height === 0) return;
    const clock = Number.isFinite(time) ? time : 0;
    if (lastReducedMotion !== reducedMotion) dirty = true;
    if (!dirty && (reducedMotion || clock - lastRender < 1 / (compact ? 24 : 30))) return;
    art.update(clock, reducedMotion);
    renderer.render(scene, camera);
    lastRender = clock;
    lastReducedMotion = reducedMotion;
    dirty = false;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    art.dispose();
    key.dispose();
    renderer.dispose();
    scene.clear();
  }

  try {
    resize();
    // A detached or initially collapsed card still gets shader warmup before
    // resolving. Its normal resize later allocates the final drawing buffer.
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
  } catch (error) {
    dispose();
    throw error;
  }

  return { setControls, resize, update, dispose };
}
