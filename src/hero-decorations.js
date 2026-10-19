import * as THREE from 'three';
import { createSolarPanel } from './solar-panel.js';
import { fitRockPanel } from './rock-surface.js';
import { createHeroFern, createFernAppearance } from './hero-ferns.js';
import { createDefaultSceneSettings, createDefaultFernInstanceSettings, sanitizeFernInstanceSettings, getSceneControlLimits } from './scene-settings.js';
import { FERN_INSTANCES, FERN_INSTANCE_CONTROL_KEYS } from './fern-instances.js';

const up = new THREE.Vector3(0, 1, 0);

function addSupport(parent, from, to, material) {
  const direction = new THREE.Vector3().subVectors(from, to);
  const length = direction.length();
  if (length < .003) return;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(.018, .025, length, 8), material);
  foot.name = 'Rock-fitted panel support';
  foot.position.copy(from).add(to).multiplyScalar(.5);
  foot.quaternion.setFromUnitVectors(up, direction.normalize());
  foot.castShadow = foot.receiveShadow = true;
  parent.add(foot);
}

function mountPanel(rock) {
  const fit = fitRockPanel(rock, {centerX: .08, centerZ: .2, width: 1.65, depth: 1.05, clearance: .018});
  if (!fit) throw new Error('No supported patch for the solar panel');
  const assembly = new THREE.Group();
  assembly.name = 'Surface-mounted solar panel';
  const panel = createSolarPanel({width: fit.width, depth: fit.depth});
  panel.position.copy(fit.position);
  panel.quaternion.copy(fit.quaternion);
  assembly.add(panel);
  const supportMaterial = new THREE.MeshStandardMaterial({color:'#545b5d',metalness:.75,roughness:.43});
  for (const contact of fit.contacts) addSupport(assembly, contact.mount, contact.surface, supportMaterial);
  assembly.userData.fit = fit;
  assembly.userData.panel = panel;
  rock.add(assembly);
  return assembly;
}

// Cast in world space: the companion stones have different authored rotations.
// Roots follow their real upper triangles, while foliage grows mostly upward.
function plantOnRock(rock, templates, {x=0,z=0,height=.5,variant=0,yaw=0}={}) {
  rock.updateWorldMatrix(true, false);
  if (!rock.geometry.boundingBox) rock.geometry.computeBoundingBox();
  const bounds = rock.geometry.boundingBox.clone().applyMatrix4(rock.matrixWorld);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(new THREE.Vector3(center.x+x*size.x, bounds.max.y+size.y+1, center.z+z*size.z), new THREE.Vector3(0,-1,0));
  let hit = ray.intersectObject(rock, false)[0];
  // An authored offset can miss a particularly narrow scan variant. A real
  // center hit is preferable to a floating plant or a silently missing cluster.
  if (!hit && (x !== 0 || z !== 0)) {
    ray.ray.origin.set(center.x, bounds.max.y+size.y+1, center.z);
    hit = ray.intersectObject(rock, false)[0];
  }
  if (!hit) return null;
  const worldNormal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(rock.matrixWorld));
  if (worldNormal.y < 0) worldNormal.negate();
  const axis = up.clone().lerp(worldNormal, .28).normalize();
  const worldRotation = new THREE.Quaternion().setFromUnitVectors(up,axis)
    .multiply(new THREE.Quaternion().setFromAxisAngle(up,yaw));
  const rockRotation = rock.getWorldQuaternion(new THREE.Quaternion());
  const rockScale = rock.getWorldScale(new THREE.Vector3()).x;
  const fern = createHeroFern(templates, {height:height/rockScale,variant});
  fern.name = 'Rock-rooted fern';
  fern.position.copy(rock.worldToLocal(hit.point.clone().addScaledVector(worldNormal,-.012)));
  fern.quaternion.copy(rockRotation.invert().multiply(worldRotation));
  fern.userData.rootSurface = hit.point.toArray();
  fern.userData.rootSurfaceLocal = rock.worldToLocal(hit.point.clone()).toArray();
  rock.add(fern);
  return fern;
}

export function createHeroDecorations(mainRock, satellites, fernTemplates=[]) {
  const solarPanel = mountPanel(mainRock);
  const ferns = [], plantedRocks = [];
  const clusters = [
    {index:0, plants:[[-.15,.10,.42,0,.2],[.17,-.07,.34,2,1.6],[.01,.22,.29,3,3.8]]},
    {index:12,plants:[[.20,-.05,.86,0,.4],[.27,-.15,.76,1,2.7],[.30,-.20,.62,3,4.6]]},
    {index:3, plants:[[0,.12,.62,0,2.3]]},
    {index:15,plants:[[0,.12,.60,1,.8],[-.12,-.06,.45,3,3.4]]},
  ];
  if (fernTemplates.length) for (const cluster of clusters) {
    const rock = satellites[cluster.index]?.mesh;
    if (!rock) continue;
    let planted = 0;
    for (const [plantIndex,[x,z,height,variant,yaw]] of cluster.plants.entries()) {
      const fern = plantOnRock(rock,fernTemplates,{x,z,height,variant,yaw});
      if (fern) {
        // Authored slots identify plants independently of scan hit order or
        // missing clusters, so a saved edit always returns to the same root.
        const instance = FERN_INSTANCES.find(item => item.rockIndex === cluster.index && item.plantIndex === plantIndex);
        if (!instance) throw new Error(`Missing fern instance for rock ${cluster.index}, plant ${plantIndex}`);
        fern.userData.fernId = instance.id;
        fern.name = instance.label;
        ferns.push(fern);planted++;
      }
    }
    if (planted) plantedRocks.push(rock);
  }
  const defaults = createDefaultSceneSettings();
  const solar = { ...defaults.solar }, foliage = { ...defaults.ferns,
    instances:Object.fromEntries(FERN_INSTANCES.map(({id}) => [id,createDefaultFernInstanceSettings()])) };
  const solarLimits = getSceneControlLimits('solar'), fernLimits = getSceneControlLimits('ferns');
  const panel = solarPanel.userData.panel, fit = solarPanel.userData.fit;
  const fitBasis = new THREE.Matrix4().compose(fit.position, fit.quaternion, new THREE.Vector3(1,1,1));
  const inverseFitBasis = fitBasis.clone().invert();
  const solarPosition = new THREE.Vector3(), solarScale = new THREE.Vector3();
  const solarRotation = new THREE.Quaternion(), manualRotation = new THREE.Quaternion(), instanceRotation = new THREE.Quaternion();
  const angles = new THREE.Euler(), instanceAngles = new THREE.Euler(), breezeAngles = new THREE.Euler();
  const breezeRotation = new THREE.Quaternion();
  solarPanel.matrixAutoUpdate = false;
  solarPanel.userData.controls = solar;
  const fernAppearance = createFernAppearance(ferns);
  const centers = new Map();
  for (const rock of plantedRocks) {
    const plants = ferns.filter(fern => fern.parent === rock);
    centers.set(rock, plants.reduce((center,fern) => center.add(fern.position), new THREE.Vector3()).multiplyScalar(1/plants.length));
  }
  const anchoredFerns = ferns.map((fern,index) => ({
    id:fern.userData.fernId, fern, position: fern.position.clone(), quaternion: fern.quaternion.clone(), scale: fern.scale.clone(),
    steadyQuaternion: fern.quaternion.clone(), center: centers.get(fern.parent), phase: index*1.913,
  }));
  // One editor helper is reparented to the selected root. It never modifies
  // leaf materials or shared settings, and costs no per-frame allocations.
  const selectionMarker = new THREE.Mesh(new THREE.RingGeometry(.105,.12,48), new THREE.MeshBasicMaterial({
    color:'#eed2a6',side:THREE.DoubleSide,transparent:true,opacity:.9,depthTest:false,depthWrite:false,toneMapped:false,
  }));
  selectionMarker.name = 'Selected fern root';
  selectionMarker.userData.editorOnly = true;
  selectionMarker.rotation.x = -Math.PI/2;
  selectionMarker.position.y = .015;
  selectionMarker.renderOrder = 100;
  selectionMarker.visible = false;
  let selectedFernId = null;
  function selectFern(id = null) {
    const anchor = anchoredFerns.find(item => item.id === id);
    selectedFernId = anchor?.id ?? null;
    selectionMarker.removeFromParent();
    selectionMarker.visible = Boolean(anchor);
    if (anchor) anchor.fern.add(selectionMarker);
  }
  function copyNumbers(state, values, limits) {
    for (const [key,[minimum,maximum]] of Object.entries(limits)) {
      const value = values[key];
      if (typeof value === 'number' && Number.isFinite(value)) state[key] = THREE.MathUtils.clamp(value,minimum,maximum);
    }
  }
  function applySolar() {
    solarPosition.copy(fit.position).add(new THREE.Vector3(solar.positionX,solar.positionY,solar.positionZ));
    angles.set(THREE.MathUtils.degToRad(solar.tiltX),THREE.MathUtils.degToRad(solar.rotation),THREE.MathUtils.degToRad(solar.tiltZ));
    manualRotation.setFromEuler(angles);
    solarRotation.copy(fit.quaternion).multiply(manualRotation);
    solarScale.set(solar.scale*solar.width,solar.scale,solar.scale*solar.depth);
    // Conjugating about the fitted basis transforms both panel and supports
    // together, while retaining exact rock-local fit data at the neutral pose.
    solarPanel.matrix.compose(solarPosition,solarRotation,solarScale).multiply(inverseFitBasis);
    solarPanel.matrixWorldNeedsUpdate = true;
    panel.setAppearance(solar);
  }
  function applyFerns() {
    angles.set(THREE.MathUtils.degToRad(foliage.tiltX),THREE.MathUtils.degToRad(foliage.rotation),THREE.MathUtils.degToRad(foliage.tiltZ));
    manualRotation.setFromEuler(angles);
    for (const anchor of anchoredFerns) {
      const {id,fern,position,center,scale,quaternion,steadyQuaternion} = anchor;
      const individual = foliage.instances[id];
      fern.position.copy(position);
      fern.position.x = center.x+(position.x-center.x)*foliage.spread+foliage.positionX+individual.positionX;
      fern.position.y += foliage.positionY+individual.positionY;
      fern.position.z = center.z+(position.z-center.z)*foliage.spread+foliage.positionZ+individual.positionZ;
      // Spread opens both the cluster and its individual fronds; width stays an
      // independent shape control even for a single planted fern.
      const opening = Math.sqrt(foliage.spread);
      fern.scale.set(scale.x*foliage.scale*foliage.width*opening*individual.scale*individual.width,
        scale.y*foliage.scale*foliage.height*individual.scale*individual.height,
        scale.z*foliage.scale*foliage.width*opening*individual.scale*individual.width);
      instanceAngles.set(THREE.MathUtils.degToRad(individual.tiltX),THREE.MathUtils.degToRad(individual.rotation),THREE.MathUtils.degToRad(individual.tiltZ));
      instanceRotation.setFromEuler(instanceAngles);
      steadyQuaternion.copy(quaternion).multiply(manualRotation).multiply(instanceRotation);
      fern.quaternion.copy(steadyQuaternion);
    }
    fernAppearance.setControls(foliage);
  }
  function setControls(settings = {}) {
    if (settings.solar && typeof settings.solar === 'object') {
      copyNumbers(solar,settings.solar,solarLimits);
      for (const key of ['tint','frameColor']) if (typeof settings.solar[key] === 'string' && /^#[\da-f]{6}$/i.test(settings.solar[key])) solar[key] = settings.solar[key];
      applySolar();
    }
    if (settings.ferns && typeof settings.ferns === 'object') {
      copyNumbers(foliage,settings.ferns,fernLimits);
      if (typeof settings.ferns.tint === 'string' && /^#[\da-f]{6}$/i.test(settings.ferns.tint)) foliage.tint = settings.ferns.tint;
      const suppliedInstances = settings.ferns.instances;
      if (suppliedInstances && typeof suppliedInstances === 'object' && !Array.isArray(suppliedInstances)) {
        for (const {id} of FERN_INSTANCES) {
          const supplied = suppliedInstances[id];
          if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) continue;
          const sanitized = sanitizeFernInstanceSettings(supplied);
          for (const key of FERN_INSTANCE_CONTROL_KEYS) {
            if (typeof supplied[key] === 'number' && Number.isFinite(supplied[key])) foliage.instances[id][key] = sanitized[key];
          }
        }
      }
      applyFerns();
    }
  }
  function update(time = 0,reducedMotion = false) {
    const clock = Number.isFinite(time) ? time : 0;
    const strength = reducedMotion || foliage.breezeSpeed === 0 ? 0 : foliage.breeze*.035;
    for (const anchor of anchoredFerns) {
      const phase = clock*foliage.breezeSpeed*.65+anchor.phase;
      breezeAngles.set(Math.sin(phase)*strength,0,Math.sin(phase*.83+1.7)*strength*.7);
      breezeRotation.setFromEuler(breezeAngles);
      anchor.fern.quaternion.copy(anchor.steadyQuaternion).multiply(breezeRotation);
    }
  }
  setControls(defaults);
  return {solarPanel,ferns,plantedRocks,plantedRockCount:plantedRocks.length,
    setControls,update,selectFern,selectionMarker,get selectedFernId(){return selectedFernId;},
    controls:{solar,ferns:foliage},fernAppearance};
}
