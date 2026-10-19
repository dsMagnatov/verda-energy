import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getSceneFraming } from '../src/responsive.js';
import { createTimeline, getPose } from '../src/journey.js';
import { createSolarGarden } from '../src/solar-garden.js';
import { createSolarSpecs } from '../src/solar-specs.js';
import { createDefaultSceneSettings } from '../src/scene-settings.js';

const sizes=[[320,640],[360,740],[390,844],[430,932],[768,1024],[844,390]];
const garden=createSolarGarden(),settings=createDefaultSceneSettings();
garden.update(0,1.3,true);garden.group.updateMatrixWorld(true);
const grass=garden.vegetation.group.children.find(mesh=>mesh.userData.gardenPlantType==='grass');
const originalCount=grass.count,originalMatrices=grass.instanceMatrix,originalControls=garden.vegetation.controls;
garden.vegetation.setQuality(.5);
assert.equal(grass.count,Math.round(originalCount*.5),'Mobile halves vegetation draw work');
garden.vegetation.setControls({...settings.gardenGrass,density:.6});
assert.equal(grass.count,Math.round(originalCount*.6*.5),'Saved density still applies independently');
assert.equal(grass.instanceMatrix,originalMatrices,'Device changes retain GPU instance buffers');
garden.vegetation.setControls(originalControls);garden.vegetation.setQuality(1);
assert.equal(grass.count,originalCount,'Returning to desktop restores full density');
assert.deepEqual(garden.vegetation.controls,originalControls,'Device quality never changes shared controls');

for(const[width,height]of sizes){
  const framing=getSceneFraming(width,height,3);
  assert(framing.compact && framing.pixelRatio<=1.25 && framing.heroFov>=43 && framing.heroFov<=82);
  const camera=new THREE.PerspectiveCamera(Math.min(110,getPose(1).landFov*framing.gardenFovScale),width/height,.1,220);
  const pose=getPose(1);camera.position.copy(pose.landPosition);camera.lookAt(pose.landTarget);camera.updateMatrixWorld(true);
  const cards=Object.fromEntries(['power','efficiency','yield'].map(id=>[id,{style:{setProperty(key,value){this[key]=value}},inert:true}]));
  const overlay={style:{},querySelector:selector=>cards[selector.match(/data-panel-anchor="(\w+)"/)[1]]};
  const specs=createSolarSpecs(overlay,garden.panel,camera);
  specs.update(1.3,width,height,true,.88);
  const halfWidth=(width>height&&height<=540?132:Math.min(180,Math.max(132,width*.37)))/2;
  for(const card of Object.values(cards)){
    assert.equal(card.inert,false,'Panel cards remain visible at phone and tablet aspect ratios');
    const x=parseFloat(card.style.left);
    assert(x-halfWidth>=13.9 && x+halfWidth<=width-13.9,'Card edges stay inside the phone viewport');
  }
}
assert.deepEqual(getSceneFraming(1280,720,2),{compact:false,heroFov:43,gardenFovScale:1,pixelRatio:1.65},'Desktop lens and quality remain unchanged');

// Real phone browser bars resize height during a swipe, unlike orientation.
const listeners=new Map(),variables=new Map();
let journeyHeight=844*10.1;
globalThis.document={documentElement:{style:{setProperty(key,value){variables.set(key,value);journeyHeight=parseFloat(value)*10.1}}},querySelector:()=>({get offsetHeight(){return journeyHeight}})};
globalThis.window={innerWidth:390,innerHeight:844,scrollY:0,addEventListener:(type,listener)=>listeners.set(type,listener),matchMedia:()=>({matches:false}),scrollTo:({top})=>{window.scrollY=top}};
const timeline=createTimeline();
window.scrollY=844*7*.52;listeners.get('scroll')();
assert(Math.abs(timeline.read(.1,true)-.52)<1e-10);
window.innerHeight=760;listeners.get('resize')();
assert(Math.abs(timeline.read(.1,true)-.52)<1e-10,'Collapsing browser chrome preserves exact story progress');
assert.equal(variables.get('--journey-viewport'),'844px');
window.innerWidth=844;window.innerHeight=390;listeners.get('resize')();
assert(Math.abs(timeline.read(.1,true)-.52)<1e-10,'Orientation changes reframe without losing the story position');
assert.equal(variables.get('--journey-viewport'),'390px');
timeline.jump(1.26);listeners.get('scroll')();
assert(Math.abs(timeline.read(.1,true)-1.26)<1e-10,'Mobile menu can reach the full card reveal');
window.scrollY=390*7*1.35;listeners.get('scroll')();
window.innerWidth=360;window.innerHeight=740;listeners.get('resize')();
assert(Math.abs(window.scrollY/(740*7)-1.35)<1e-10,'Orientation preserves the closing-section position beyond the camera journey');
console.log(JSON.stringify({ok:true,viewports:sizes,checks:['mobile camera and pixel budget','cards within viewport','saved density preserved','GPU buffers reused','desktop quality restored','browser-bar stability','orientation progress preserved','full scroll reveal reachable']},null,2));
