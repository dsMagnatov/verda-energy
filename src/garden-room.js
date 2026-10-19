import * as THREE from 'three';
import { createDefaultSceneSettings, getSceneControlLimits } from './scene-settings.js';

const CENTER_Z=-3.5;

function sweptGeometry(rings, start=-Math.PI, end=Math.PI, segments=192, closeProfile=false) {
  const positions=[],uvs=[],indices=[];
  for(let segment=0;segment<=segments;segment++) {
    const angle=THREE.MathUtils.lerp(start,end,segment/segments);
    for(const [rx,rz,y] of rings) {
      positions.push(Math.sin(angle)*rx,y,CENTER_Z-Math.cos(angle)*rz);
      uvs.push((angle-start)*rx,y);
    }
    if(segment===segments)continue;
    const faces=closeProfile?rings.length:rings.length-1;
    for(let ring=0;ring<faces;ring++) {
      const nextRing=(ring+1)%rings.length;
      const a=segment*rings.length+ring,b=(segment+1)*rings.length+ring;
      const c=segment*rings.length+nextRing,d=(segment+1)*rings.length+nextRing;
      indices.push(a,b,c,b,d,c);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

function roomGeometries(state,heightAt) {
  const radius=state.radius,height=state.wallHeight,thickness=state.roofThickness;
  const innerX=Math.min(state.openingWidth,radius-.85),innerZ=Math.min(state.openingDepth,radius-.85);
  const bevel=Math.min(.10,thickness*.22);
  const wallRings=[[radius-.23,radius-.23,-.65],[radius-.23,radius-.23,height-.07],
    [radius-.19,radius-.19,height],[radius+.19,radius+.19,height],
    [radius+.23,radius+.23,height-.07],[radius+.23,radius+.23,-.65]];
  const wall=sweptGeometry(wallRings,-Math.PI*.75,Math.PI*.75,180,false);
  const roofRings=[
    [radius+.25,radius+.25,height],
    [innerX+bevel,innerZ+bevel,height],
    [innerX,innerZ,height+bevel],
    [innerX,innerZ,height+thickness-bevel],
    [innerX+bevel,innerZ+bevel,height+thickness],
    [radius+.25,radius+.25,height+thickness],
    [radius+.30,radius+.30,height+thickness-bevel],
    [radius+.30,radius+.30,height+bevel],
  ];
  const roof=sweptGeometry(roofRings,-Math.PI,Math.PI,192,true);
  const floor=new THREE.RingGeometry(0,radius+.29,128,24);
  floor.rotateX(-Math.PI/2);floor.translate(0,0,CENTER_Z);
  const floorPositions=floor.attributes.position;
  for(let i=0;i<floorPositions.count;i++)floorPositions.setY(i,heightAt(floorPositions.getX(i),floorPositions.getZ(i))-.018);
  floor.computeVertexNormals();
  floor.computeBoundingBox();floor.computeBoundingSphere();
  return {wall,roof,floor,opening:[innerX,innerZ]};
}

/** Solid round room, with a real empty oval oculus and a front camera cutaway. */
export function createGardenRoom({groundMaterial,heightAt=()=>.1}={}) {
  const state={...createDefaultSceneSettings().gardenRoom};
  const limits=getSceneControlLimits('gardenRoom');
  const group=new THREE.Group();group.name='Round concrete garden room and open oval ceiling';
  const textureScale={value:state.textureScale},textureStrength={value:state.textureStrength};
  const poresBytes=new Uint8Array(64*64*4);
  for(let i=0;i<64*64;i++) {
    const grain=226+Math.round(Math.sin(i*17.719)*7+Math.cos(i*.733)*5);
    poresBytes[i*4]=poresBytes[i*4+1]=poresBytes[i*4+2]=grain;poresBytes[i*4+3]=255;
  }
  const pores=new THREE.DataTexture(poresBytes,64,64,THREE.RGBAFormat);
  pores.wrapS=pores.wrapT=THREE.RepeatWrapping;pores.generateMipmaps=true;
  pores.minFilter=THREE.LinearMipmapLinearFilter;pores.magFilter=THREE.LinearFilter;pores.needsUpdate=true;
  const material=new THREE.MeshStandardMaterial({color:state.color,roughness:state.roughness,
    bumpMap:pores,bumpScale:.006,side:THREE.DoubleSide});
  material.name='Pale poured concrete with restrained pores and patina';
  material.onBeforeCompile=shader=>{
    shader.uniforms.uRoomTextureScale=textureScale;shader.uniforms.uRoomTextureStrength=textureStrength;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vRoomPoint;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvRoomPoint=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vRoomPoint;
      uniform float uRoomTextureScale;
      uniform float uRoomTextureStrength;
      float roomHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float roomNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(roomHash(i),roomHash(i+vec2(1.,0.)),f.x),mix(roomHash(i+vec2(0.,1.)),roomHash(i+vec2(1.)),f.x),f.y);}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec2 roomUv=vec2(vRoomPoint.x+vRoomPoint.z*.73,vRoomPoint.y)*max(.05,uRoomTextureScale);
        float roomBroad=roomNoise(roomUv*2.1+vec2(11.,7.));
        float roomFine=roomNoise(roomUv*63.);
        float roomBase=(1.-smoothstep(-.1,1.1,vRoomPoint.y))*.10;
        float roomPatina=(roomBroad-.5)*.17+(roomFine-.5)*.055-roomBase;
        diffuseColor.rgb*=max(.4,1.+roomPatina*uRoomTextureStrength);`);
  };
  material.customProgramCacheKey=()=> 'garden-room-concrete-v1';
  material.userData.roomControls={textureScale,textureStrength};
  const initial=roomGeometries(state,heightAt);
  const wall=new THREE.Mesh(initial.wall,material);wall.name='High curved room wall, open behind the camera';
  const roof=new THREE.Mesh(initial.roof,material);roof.name='Solid ceiling annulus with open oval oculus';
  const floor=new THREE.Mesh(initial.floor,groundMaterial||new THREE.MeshStandardMaterial({color:'#52613e',roughness:1}));
  floor.name='Continuous floor beneath the round enclosure';
  for(const mesh of [wall,roof,floor]) {mesh.receiveShadow=true;mesh.castShadow=mesh!==floor;group.add(mesh);}
  let rebuilds=0;
  function metadata() {
    group.userData.room={radius:state.radius,wallHeight:state.wallHeight,roofThickness:state.roofThickness,
      opening:[Math.min(state.openingWidth,state.radius-.85),Math.min(state.openingDepth,state.radius-.85)],frontCutawayDegrees:90};
  }
  function setControls(values={}) {
    let rebuild=false;
    for(const[key,[minimum,maximum]]of Object.entries(limits)) {
      if(typeof values[key]!=='number'||!Number.isFinite(values[key]))continue;
      const value=THREE.MathUtils.clamp(values[key],minimum,maximum);
      if(state[key]!==value&&['wallHeight','radius','openingWidth','openingDepth','roofThickness'].includes(key))rebuild=true;
      state[key]=value;
    }
    if(typeof values.color==='string'&&/^#[\da-f]{6}$/i.test(values.color))state.color=values.color;
    if(rebuild) {
      const geometries=roomGeometries(state,heightAt);
      for(const key of ['wall','roof','floor']) {const mesh={wall,roof,floor}[key];mesh.geometry.dispose();mesh.geometry=geometries[key];}
      rebuilds++;
    }
    material.color.set(state.color);material.roughness=state.roughness;
    textureScale.value=state.textureScale;textureStrength.value=state.textureStrength;
    pores.repeat.set(state.textureScale*2,state.textureScale*2);material.bumpScale=state.textureStrength*.012;
    metadata();
  }
  setControls(state);
  return {group,wall,roof,floor,material,controls:state,setControls,get rebuildCount(){return rebuilds;},dispose(){
    wall.geometry.dispose();roof.geometry.dispose();floor.geometry.dispose();material.dispose();pores.dispose();
    if(!groundMaterial)floor.material.dispose();group.clear();
  }};
}
