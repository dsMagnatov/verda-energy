import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createSolarPanel } from './solar-panel.js';
import { createGardenVegetation } from './garden-vegetation.js';
import { createGardenRoom } from './garden-room.js';
import { createDefaultSceneSettings, getSceneControlLimits } from './scene-settings.js';
import { fbm, noise2, rand, smoothstep } from './verdant/math.js';

const POND_X = 4.8, POND_Z = 3.6, POND_CENTER_Z = -3.5, WATER_Y = .02;

/** Quiet, gently raised planting beds and a genuinely recessed pond basin. */
export function gardenHeight(x, z) {
  const radius = Math.hypot(x / POND_X, (z - POND_CENTER_Z) / POND_Z);
  const bed = .10 + fbm(x * .43 + 16, z * .39 + 11) * .19 + Math.sin(x * .53 + z * .29) * .024;
  const bank = smoothstep(.96, 1.11, radius);
  const pondFloor = -.48 + .15 * Math.min(1, radius);
  let height = THREE.MathUtils.lerp(pondFloor, bed, bank);
  if (z >= .42 && z <= 15.8) {
    const path = 1 - smoothstep(.79, 1.11, Math.abs(x));
    height = THREE.MathUtils.lerp(height, .058 + Math.sin(z * .47) * .006, path);
  }
  return height;
}

/** Shared exclusion footprint keeps every planted root off stone and water. */
export function isGardenPlantable(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 13.3 || z < -16.6 || z > 15.5) return false;
  if(z<-.3&&Math.hypot(x,z-POND_CENTER_Z)>13.45)return false;
  if (Math.hypot(x / POND_X, (z - POND_CENTER_Z) / POND_Z) < 1.105) return false;
  return !(Math.abs(x) < .97 && z > .33);
}

function stoneTexture(seed = 2) {
  const size = 128, bytes = new Uint8Array(size * size * 4), random = rand(seed);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const broad = fbm(x * .072 + seed, y * .072 + seed);
    const fine = noise2(x * .91, y * .91);
    const fleck = random();
    const value = Math.max(50, Math.min(240, 147 + broad * 79 + fine * 24 + (fleck - .5) * 18 - (fleck < .018 ? 38 : 0)));
    const i = (y * size + x) * 4;
    bytes[i] = value; bytes[i + 1] = value - 3; bytes[i + 2] = value - 10; bytes[i + 3] = 255;
  }
  const map = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

function finishInstances(mesh) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  return mesh;
}

function slabGeometry(width, length, depth, bevel = .012) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -length / 2); shape.lineTo(width / 2, -length / 2);
  shape.lineTo(width / 2, length / 2); shape.lineTo(-width / 2, length / 2); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled:true, bevelThickness:bevel, bevelSize:bevel, bevelSegments:1, steps:1, curveSegments:1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function copingGeometry() {
  // Each wedge has its own narrow mortar joint. Four rings give the real stone
  // lip a softened edge instead of a conspicuous perfect torus around the lake.
  const positions = [], colors = [], uvs = [], indices = [];
  const stoneColor = new THREE.Color();
  const sections = 64, rings = [
    [4.775,3.575,.052], [4.79,3.59,.12], [5.025,3.825,.14], [5.055,3.855,.105],
  ];
  for (let section = 0; section < sections; section++) {
    const start = section / sections * Math.PI * 2 + .0017;
    const end = (section + 1) / sections * Math.PI * 2 - .0017;
    const offset = positions.length / 3;
    stoneColor.setHSL(.105,.08,.57 + noise2(section * 4.1, 2) * .09);
    for (let ring = 0; ring < rings.length; ring++) for (const angle of [start,end]) {
      const [rx,rz,y] = rings[ring];
      const wear = Math.sin(section * 3.71) * .0035;
      positions.push(Math.cos(angle)*rx,y+wear,POND_CENTER_Z+Math.sin(angle)*rz);
      stoneColor.toArray(colors, colors.length);
      uvs.push(angle * 3.5,ring * .15);
    }
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const i = offset + ring * 2;
      indices.push(i,i+1,i+2,i+1,i+3,i+2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

const waterShader = {
  name:'Garden rippled reflecting water',
  uniforms:{color:{value:new THREE.Color('#203b32')},tDiffuse:{value:null},textureMatrix:{value:new THREE.Matrix4()},
    basinMap:{value:null},time:{value:0},waveStrength:{value:1},waveScale:{value:1},waveSpeed:{value:1},
    reflection:{value:.75},transparency:{value:.25},roughness:{value:.15},brightness:{value:1},depth:{value:1},
    shine:{value:1},shineSize:{value:1}},
  vertexShader:`
    uniform mat4 textureMatrix;
    uniform float time;
    uniform float waveStrength;
    uniform float waveScale;
    uniform float waveSpeed;
    varying vec4 vReflection;
    varying vec3 vWorld;
    void main(){
      vReflection=textureMatrix*vec4(position,1.);
      vec4 world=modelMatrix*vec4(position,1.);
      world.y+=sin((world.x*4.4+world.z*2.8)*waveScale+time*waveSpeed*.7)*.005*waveStrength;
      vWorld=world.xyz;
      gl_Position=projectionMatrix*viewMatrix*world;
    }`,
  fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform sampler2D basinMap;
    uniform vec3 color;
    uniform float time;
    uniform float waveStrength;
    uniform float waveScale;
    uniform float waveSpeed;
    uniform float reflection;
    uniform float transparency;
    uniform float roughness;
    uniform float brightness;
    uniform float depth;
    uniform float shine;
    uniform float shineSize;
    varying vec4 vReflection;
    varying vec3 vWorld;
    void main(){
      vec2 p=vWorld.xz*waveScale;
      float t=time*waveSpeed;
      float waveA=sin(p.x*4.4+p.y*2.8+t*.7);
      float waveB=sin(p.y*8.6-p.x*1.9-t*.51);
      float waveC=cos(p.x*13.1+p.y*4.7+t*.36);
      vec2 flow=vec2(waveA+waveB*.36,waveB*.58+waveC*.25)*waveStrength;
      vec2 uv=vReflection.xy/max(vReflection.w,.0001);
      uv+=flow*.00125;
      float blur=.00015+roughness*roughness*.018;
      vec3 mirror=texture2D(tDiffuse,clamp(uv,vec2(.001),vec2(.999))).rgb*.36;
      mirror+=texture2D(tDiffuse,clamp(uv+vec2(blur,0.),vec2(.001),vec2(.999))).rgb*.16;
      mirror+=texture2D(tDiffuse,clamp(uv-vec2(blur,0.),vec2(.001),vec2(.999))).rgb*.16;
      mirror+=texture2D(tDiffuse,clamp(uv+vec2(0.,blur),vec2(.001),vec2(.999))).rgb*.16;
      mirror+=texture2D(tDiffuse,clamp(uv-vec2(0.,blur),vec2(.001),vec2(.999))).rgb*.16;
      vec3 eye=normalize(cameraPosition-vWorld);
      vec3 normal=normalize(vec3(flow.x*.027,1.,flow.y*.021));
      float incidence=clamp(dot(eye,normal),0.,1.);
      float fresnel=(.27+.70*pow(1.-incidence,3.5))*reflection;
      vec2 basinUv=vec2(vWorld.x/9.6+.5,(vWorld.z+3.5)/7.2+.5)+flow*.0018;
      vec4 basin=texture2D(basinMap,clamp(basinUv,vec2(.001),vec2(.999)));
      float opticalDepth=basin.a*.65*depth;
      vec3 absorption=vec3(2.1,1.1,1.65)*opticalDepth;
      vec3 transmitted=basin.rgb*exp(-absorption)+color*(1.-exp(-opticalDepth))* .34;
      float caustic=pow(max(0.,sin(p.x*9.+waveB*.7)*sin(p.y*10.+waveA*.6)),5.);
      transmitted+=vec3(.04,.047,.026)*caustic*waveStrength*.1;
      vec3 water=color*(.26+.08*(1.-exp(-depth)));
      vec3 shaded=mix(water,transmitted,transparency);
      shaded=mix(shaded,mirror*vec3(.91,.98,.92),fresnel);
      // A low, broad sunlight reflection breaks into moving highlights on the
      // small wave slopes. Strength stays independent of the mirror slider.
      float slopeA=cos(p.x*4.4+p.y*2.8+t*.7);
      float slopeB=cos(p.y*8.6-p.x*1.9-t*.51);
      float slopeC=-sin(p.x*13.1+p.y*4.7+t*.36);
      vec2 slope=vec2(4.4*slopeA-1.9*.36*slopeB+13.1*.25*slopeC,
        2.8*slopeA+8.6*.36*slopeB+4.7*.25*slopeC)*.012*waveStrength;
      vec3 sparkleNormal=normalize(vec3(-slope.x,1.,-slope.y));
      vec3 sunlight=normalize(vec3(-.24,.20,-1.));
      float alignment=max(0.,dot(reflect(-sunlight,sparkleNormal),eye));
      float lobe=clamp(300./pow(max(.1,shineSize),1.65),12.,4096.);
      lobe=mix(lobe,12.,roughness*roughness);
      float glint=pow(alignment,lobe);
      float sheen=pow(alignment,max(4.,lobe*.18));
      shaded+=vec3(1.,.94,.78)*shine*(glint*1.2+sheen*.08)*(1.-roughness*.72);
      float surfaceAlpha=clamp(1.-transparency*(1.-fresnel)*.86,.12,1.);
      gl_FragColor=vec4(max(vec3(0.),shaded)*brightness,surfaceAlpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/** Architectural garden replacing the former open wind-turbine landscape. */
export function createSolarGarden({uniforms={},fernTemplates=[],stoneMaterial}={}) {
  const group = new THREE.Group();
  group.name = 'VERDA quiet solar garden';
  group.userData.bounds = {min:[-14.3,-.65,-17.8],max:[14.3,8.65,16]};
  const defaults=createDefaultSceneSettings();
  const controls={gardenPanel:{...defaults.gardenPanel},gardenWater:{...defaults.gardenWater},
    gardenGround:{...defaults.gardenGround}};
  const limits=Object.fromEntries(Object.keys(controls).map(key=>[key,getSceneControlLimits(key)]));
  const map = stoneTexture(19), groundMap = stoneTexture(73);
  groundMap.repeat.set(22,24);
  const groundMaterial = new THREE.MeshStandardMaterial({map:groundMap,bumpMap:groundMap,bumpScale:.027,
    vertexColors:true,roughness:.98,color:'#d1e6b6'});
  const groundUniforms=Object.fromEntries(['brightness','textureStrength','saturation','contrast'].map(key=>[key,{value:controls.gardenGround[key]}]));
  groundMaterial.onBeforeCompile=shader=>{
    for(const[key,uniform]of Object.entries(groundUniforms))shader.uniforms[`uGround${key[0].toUpperCase()+key.slice(1)}`]=uniform;
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform float uGroundBrightness;
      uniform float uGroundTextureStrength;
      uniform float uGroundSaturation;
      uniform float uGroundContrast;`)
      .replace('#include <map_fragment>',`#ifdef USE_MAP
        vec4 gardenGroundTexel=texture2D(map,vMapUv);
        diffuseColor.rgb*=max(vec3(0.),mix(vec3(1.),gardenGroundTexel.rgb,uGroundTextureStrength));
        diffuseColor.a*=gardenGroundTexel.a;
        #endif`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        float groundLuminance=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
        diffuseColor.rgb=max(vec3(0.),mix(vec3(groundLuminance),diffuseColor.rgb,uGroundSaturation));
        diffuseColor.rgb=max(vec3(0.),(diffuseColor.rgb-vec3(.12))*uGroundContrast+vec3(.12))*uGroundBrightness;`);
  };
  groundMaterial.customProgramCacheKey=()=> 'garden-ground-live-v1';
  groundMaterial.userData.groundControls=groundUniforms;
  const terrain = new THREE.PlaneGeometry(28,32,112,128);
  terrain.rotateX(-Math.PI/2);
  const positions = terrain.attributes.position, colors = new Float32Array(positions.count*3);
  // Vertex colors carry gentle growth variation; the live material color
  // supplies the actual turf hue, avoiding two dark green tints multiplying.
  const color = new THREE.Color(), dark = new THREE.Color('#8fa07b'), light = new THREE.Color('#c5d3a5');
  for (let i=0;i<positions.count;i++) {
    const x=positions.getX(i),z=positions.getZ(i);
    positions.setY(i,gardenHeight(x,z));
    color.copy(dark).lerp(light,fbm(x*.8+12,z*.8+8)); color.toArray(colors,i*3);
  }
  terrain.setAttribute('color',new THREE.BufferAttribute(colors,3));
  terrain.computeVertexNormals(); terrain.computeBoundingSphere();
  const ground = new THREE.Mesh(terrain,groundMaterial);
  ground.name='Sculpted moss beds and recessed pond basin'; ground.receiveShadow=true; group.add(ground);

  const pathMaterial = new THREE.MeshStandardMaterial({color:'#c5c1b4',map,bumpMap:map,bumpScale:.022,roughness:.72});
  const pathGeometry = slabGeometry(1.58,.99,.07,.012);
  const pathCount = 14, path = new THREE.InstancedMesh(pathGeometry,pathMaterial,pathCount);
  path.name='Fourteen jointed warm-grey walking stones'; path.castShadow=true;
  const random=rand(937622),dummy=new THREE.Object3D();
  for (let i=0;i<pathCount;i++) {
    const z=.6+.495+i*1.03;
    dummy.position.set((random()-.5)*.012,.075,z); dummy.rotation.set(0,(random()-.5)*.008,0);
    dummy.scale.set(1,1,1); dummy.updateMatrix(); path.setMatrixAt(i,dummy.matrix);
    color.setHSL(.105,.055,.78+random()*.1); path.setColorAt(i,color);
  }
  group.add(finishInstances(path));

  const coping = new THREE.Mesh(copingGeometry(),new THREE.MeshStandardMaterial({map,bumpMap:map,bumpScale:.021,
    vertexColors:true,roughness:.78,color:'#e3e0d2',side:THREE.DoubleSide}));
  coping.name='Jointed worn limestone pond coping'; coping.receiveShadow=true; coping.castShadow=true; group.add(coping);
  const room=createGardenRoom({groundMaterial,heightAt:gardenHeight});group.add(room.group);
  const wall=room.wall;

  const pebbleGeometry = new THREE.IcosahedronGeometry(1,1);
  const pebblePosition=pebbleGeometry.attributes.position;
  for (let i=0;i<pebblePosition.count;i++) {
    const x=pebblePosition.getX(i),y=pebblePosition.getY(i),z=pebblePosition.getZ(i);
    const relief=.85+noise2(x*3.8+11,y*3.8+z)*.24;
    pebblePosition.setXYZ(i,x*relief,y*.57*relief,z*relief);
  }
  pebbleGeometry.computeVertexNormals(); pebbleGeometry.computeBoundingSphere();
  const pebbleMaterial = stoneMaterial || new THREE.MeshStandardMaterial({color:'#6f7467',map,bumpMap:map,bumpScale:.026,roughness:.96});
  const pebbles = new THREE.InstancedMesh(pebbleGeometry,pebbleMaterial,116);
  pebbles.name='Natural damp stones between moss and pond edge'; pebbles.castShadow=true;
  for (let i=0;i<pebbles.count;i++) {
    const angle=random()*Math.PI*2, radius=1.08+random()*.12;
    let x=Math.cos(angle)*POND_X*radius,z=POND_CENTER_Z+Math.sin(angle)*POND_Z*radius;
    if (Math.abs(x)<1.15 && z>-.1) x=Math.sign(x||1)*(1.25+random()*.6);
    const scale=.045+Math.pow(random(),2)*.19;
    dummy.position.set(x,gardenHeight(x,z)+scale*.14,z);
    dummy.rotation.set(random()*.4,random()*Math.PI*2,random()*.3); dummy.scale.set(scale*(1+random()),scale,scale);
    dummy.updateMatrix(); pebbles.setMatrixAt(i,dummy.matrix);
    color.setHSL(.105,.045,.58+random()*.24); pebbles.setColorAt(i,color);
  }
  group.add(finishInstances(pebbles));

  const waterGeometry=new THREE.RingGeometry(0,1,128,24);
  waterGeometry.scale(POND_X,POND_Z,1);
  const pond=new Reflector(waterGeometry,{textureWidth:768,textureHeight:768,clipBias:.003,multisample:0,shader:waterShader,color:'#203b32'});
  pond.name='Living oval pond with real solar-panel reflection';
  pond.rotation.x=-Math.PI/2; pond.position.set(0,WATER_Y,POND_CENTER_Z);
  pond.userData={center:[0,WATER_Y,POND_CENTER_Z],radii:[POND_X,POND_Z],waterSurface:true};
  pond.material.depthWrite=false;pond.material.transparent=true;pond.material.toneMapped=true;pond.renderOrder=2;group.add(pond);
  // The bed texture stores the same recessed terrain's depth in alpha and its
  // mineral/moss albedo in RGB. Transparency reveals that refracted, attenuated
  // basin rather than merely lowering the whole surface's opacity.
  const basinBytes=new Uint8Array(128*128*4),basinColor=new THREE.Color();
  for(let iz=0;iz<128;iz++)for(let ix=0;ix<128;ix++) {
    const x=(ix/127-.5)*9.6,z=(iz/127-.5)*7.2-3.5,index=(iz*128+ix)*4;
    const grain=noise2(x*17+23,z*17+9),broad=fbm(x*3+4,z*3+13);
    basinColor.setRGB(.11+broad*.13+grain*.025,.135+broad*.15+grain*.026,.085+broad*.11+grain*.016);
    basinBytes[index]=Math.round(basinColor.r*255);basinBytes[index+1]=Math.round(basinColor.g*255);basinBytes[index+2]=Math.round(basinColor.b*255);
    basinBytes[index+3]=Math.round(THREE.MathUtils.clamp((WATER_Y-gardenHeight(x,z))/.65,0,1)*255);
  }
  const basinMap=new THREE.DataTexture(basinBytes,128,128,THREE.RGBAFormat);
  basinMap.magFilter=THREE.LinearFilter;basinMap.minFilter=THREE.LinearFilter;basinMap.needsUpdate=true;
  pond.material.uniforms.basinMap.value=basinMap;

  const vegetation=createGardenVegetation({fernTemplates,uniforms,heightAt:gardenHeight,isPlantable:isGardenPlantable});
  group.add(vegetation.group);

  const panelRig=new THREE.Group(); panelRig.name='Descending portrait solar installation';
  panelRig.userData={finalCenter:[0,3.4,POND_CENTER_Z],portraitHeight:6.6,portraitWidth:3.3,descentRange:[.55,.84]};
  // Preserve the hero module's authored frame, wafer gaps and electrode widths
  // when enlarging it into a portrait installation. Recomputing a huge native
  // panel would leave those physical details imperceptibly thin at this view.
  const panel=createSolarPanel({width:1.65,depth:.825});
  panel.scale.setScalar(4);
  panel.name='Portrait solar module suspended over the lake';
  const portrait=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(1,0,0)));
  const facing=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.024,-.08,0));
  panel.quaternion.copy(facing).multiply(portrait);
  panelRig.add(panel); group.add(panelRig);
  const waterTime=pond.material.uniforms.time;
  const panelAngles=new THREE.Euler();
  const pointerAngles=new THREE.Euler(),pointerTilt=new THREE.Quaternion();
  let lastTime=0,lastProgress=0,lastReducedMotion=true;
  let lastInteraction=null;
  function setAppearance(values={}) {panel.setAppearance(values);}
  function copyControls(id,values) {
    if(!values||typeof values!=='object'||Array.isArray(values))return;
    for(const[key,[minimum,maximum]]of Object.entries(limits[id])) {
      if(typeof values[key]==='number'&&Number.isFinite(values[key]))controls[id][key]=THREE.MathUtils.clamp(values[key],minimum,maximum);
    }
    if(typeof values.color==='string'&&/^#[\da-f]{6}$/i.test(values.color))controls[id].color=values.color;
  }
  function setControls(settings={}) {
    for(const id of Object.keys(limits))copyControls(id,settings[id]);
    if(settings.gardenRoom)room.setControls(settings.gardenRoom);
    if(settings.gardenGrass)vegetation.setControls(settings.gardenGrass);
    const water=controls.gardenWater;
    for(const key of Object.keys(limits.gardenWater))pond.material.uniforms[key].value=water[key];
    pond.material.uniforms.color.value.set(water.color);
    const turf=controls.gardenGround;
    groundMaterial.color.set(turf.color);
    groundMaterial.roughness=turf.roughness;
    groundMaterial.bumpScale=.027*turf.relief*turf.textureStrength;
    groundMap.repeat.set(22*turf.textureScale,24*turf.textureScale);
    for(const key of Object.keys(groundUniforms))groundUniforms[key].value=turf[key];
    const roomState=room.controls;
    group.userData.bounds={min:[-roomState.radius-.3,-.65,Math.min(-16,POND_CENTER_Z-roomState.radius-.3)],
      max:[roomState.radius+.3,roomState.wallHeight+roomState.roofThickness,16]};
    update(lastTime,lastProgress,lastReducedMotion,lastInteraction);
  }
  function update(time=0,progress=0,reducedMotion=false,interaction=null) {
    if (Number.isFinite(time)) lastTime=time;
    const p=THREE.MathUtils.clamp(Number.isFinite(progress)?progress:0,0,1);
    lastProgress=p;lastReducedMotion=Boolean(reducedMotion);lastInteraction=interaction;
    const tuning=controls.gardenPanel;
    let start=Math.min(tuning.descentStart,tuning.descentEnd)/100,end=Math.max(tuning.descentStart,tuning.descentEnd)/100;
    if(end-start<.001){start=Math.min(start,.999);end=start+.001;}
    const descent=smoothstep(start,end,p);
    panelRig.visible=p>=start-.03;
    panelRig.position.set(tuning.positionX,THREE.MathUtils.lerp(tuning.startHeight,3.4,descent)+tuning.positionY,POND_CENTER_Z+tuning.positionZ);
    panelRig.scale.set(tuning.scale*tuning.width,tuning.scale*tuning.height,tuning.scale);
    panelAngles.set(THREE.MathUtils.degToRad(tuning.tiltX),THREE.MathUtils.degToRad(tuning.rotation),THREE.MathUtils.degToRad(tuning.tiltZ));
    panelRig.quaternion.setFromEuler(panelAngles);
    if (!reducedMotion && interaction) {
      const x=Number.isFinite(interaction.x)?THREE.MathUtils.clamp(interaction.x,-1,1):0;
      const y=Number.isFinite(interaction.y)?THREE.MathUtils.clamp(interaction.y,-1,1):0;
      pointerAngles.set(THREE.MathUtils.degToRad(-y*18),THREE.MathUtils.degToRad(x*24),THREE.MathUtils.degToRad(-x*6+y*2));
      panelRig.quaternion.multiply(pointerTilt.setFromEuler(pointerAngles));
    }
    panelRig.userData.descentRange[0]=start;panelRig.userData.descentRange[1]=end;
    // Scrolling, including reverse scrolling, determines the architectural
    // reveal exactly. Reduced motion freezes only environmental animation.
    waterTime.value=reducedMotion?0:lastTime;
    vegetation.update(lastTime,reducedMotion);
  }
  setControls(defaults);
  const counts={pathTiles:pathCount,copingSections:64,shoreStones:pebbles.count,...vegetation.counts};
  controls.gardenRoom=room.controls;
  return {group,panel,panelRig,pond,ground,path,coping,wall,roof:room.roof,room,vegetation,update,setControls,setAppearance,controls,counts};
}
