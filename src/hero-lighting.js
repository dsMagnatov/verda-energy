import * as THREE from 'three';
import { createDefaultSceneSettings, getSceneControlLimits } from './scene-settings.js';

const ranges = getSceneControlLimits('rays');
const nonnegativeColor = color => color.setRGB(Math.max(0,color.r),Math.max(0,color.g),Math.max(0,color.b));

// These are real scene lights: any Standard/Physical material added later is
// illuminated without a material hook or registration with this component.
export function createHeroLighting(scene) {
  const group = new THREE.Group();
  group.name = 'Scene-wide soft sunlight';
  scene.add(group);
  const settings = {...createDefaultSceneSettings().rays};
  const neutral = new THREE.Color('#f5f2ea'), warm = new THREE.Color('#ffd1a0');
  const coolFill = new THREE.Color('#c6d0d8'), warmFill = new THREE.Color('#d5c5b0');
  const key = new THREE.SpotLight(neutral, 4.2, 34, 1.31, .945, 0);
  key.name = 'Shadow-casting sunlight';
  key.castShadow = true;
  key.shadow.mapSize.set(2048,2048);
  key.shadow.camera.near = .25;
  key.shadow.bias = -.00015;
  key.shadow.normalBias = .035;
  group.add(key,key.target);
  const ambient = new THREE.HemisphereLight('#d9d9d1','#191a17',.32);
  ambient.name = 'Minimal ambient visibility'; group.add(ambient);
  const fill = new THREE.DirectionalLight(coolFill,.22);
  fill.name = 'Soft neutral camera-side fill'; fill.position.set(-5,2,10); group.add(fill,fill.target);
  const rim = new THREE.DirectionalLight(neutral,.75);
  rim.name = 'Sunlight reflected around stone edges';
  rim.position.set(-7,6,-8); group.add(rim,rim.target);

  // Visible haze is drawn by the background and suspended particles. There is
  // deliberately no cone surface to intersect a rock or leave a circular band.

  const fallbackCamera = new THREE.PerspectiveCamera(43,16/9,.08,180);
  fallbackCamera.position.set(.5,1.9,12.7); fallbackCamera.lookAt(.5,.15,0); fallbackCamera.updateMatrixWorld();
  let activeCamera = fallbackCamera, disposed = false;
  const cameraPosition = new THREE.Vector3(), forward = new THREE.Vector3(), sourceRay = new THREE.Vector3();
  const source = new THREE.Vector3(), direction = new THREE.Vector3();
  const focus = new THREE.Vector3(1,-.65,-2);

  function syncPlacement(camera = activeCamera) {
    if (!camera?.isCamera) camera = fallbackCamera;
    activeCamera = camera;
    camera.getWorldPosition(cameraPosition);
    camera.getWorldDirection(forward);
    sourceRay.set(settings.sourceX*2-1,settings.sourceY*2-1,.5).unproject(camera).sub(cameraPosition).normalize();
    // A fixed camera-depth plane keeps the physical source aligned with the
    // background's screen-space sun while retaining full world-space shadows.
    source.copy(cameraPosition).addScaledVector(sourceRay,7.5/Math.max(.15,sourceRay.dot(forward)));
    direction.subVectors(focus,source);
    if (direction.lengthSq()<1e-8) direction.copy(forward);
    else direction.normalize();
    direction.applyAxisAngle(forward,-THREE.MathUtils.degToRad(settings.angle));
    key.position.copy(source); key.target.position.copy(source).addScaledVector(direction,18);
    rim.position.copy(source).multiplyScalar(-.85); rim.position.y = Math.abs(source.y)*.7+2;
    rim.target.position.copy(focus);
    group.updateMatrixWorld(true);
  }

  function setControls(params = {}) {
    if (disposed || !params || typeof params !== 'object') return;
    for (const [name,[min,max]] of Object.entries(ranges)) {
      if (typeof params[name] === 'number' && Number.isFinite(params[name])) settings[name] = THREE.MathUtils.clamp(params[name],min,max);
    }
    key.color.lerpColors(neutral,warm,settings.warmth);
    nonnegativeColor(key.color);
    key.intensity = 4.2*settings.intensity;
    // A broad, almost entirely feathered beam has no bright inner cookie edge.
    // Width/spread stay responsive throughout the expanded control ranges.
    const coverage = Math.sqrt(settings.width)*settings.spread**.25;
    key.angle = 1.12+.38*coverage/(1.+coverage);
    key.penumbra = .90+.09*settings.softness/(1.+settings.softness);
    key.distance = 34*settings.length;
    key.shadow.camera.far = key.distance;
    key.shadow.radius = 1.2+settings.softness*1.8;
    fill.color.lerpColors(coolFill,warmFill,settings.warmth);
    nonnegativeColor(fill.color);
    rim.color.copy(key.color); rim.intensity = .75*settings.intensity;
    syncPlacement();
  }

  setControls();
  return {
    group,key,
    setControls,
    update(time,camera) {
      if (disposed) return;
      syncPlacement(camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true; group.removeFromParent();
      key.dispose();
    },
  };
}
