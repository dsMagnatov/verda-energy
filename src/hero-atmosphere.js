import * as THREE from 'three';
import { createDefaultSceneSettings, getSceneControlLimits } from './scene-settings.js';

const controlRanges = getSceneControlLimits('rays');
const backgroundRanges = getSceneControlLimits('background');

function viewportAspect() {
  const width = Number(globalThis.innerWidth), height = Number(globalThis.innerHeight);
  return width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : 16 / 9;
}

// Warm light in suspended dust, fading to a near-black horizon.
export function createHeroAtmosphere(scene) {
  const uniforms = {aspect:{value:viewportAspect()},
    deep:{value:new THREE.Color('#090b09')},earth:{value:new THREE.Color('#665643')},
    amber:{value:new THREE.Color('#b37d49')},light:{value:new THREE.Color('#d1aa75')},
    backgroundBrightness:{value:1},backgroundGradient:{value:.72},
    backgroundGlowStrength:{value:.53},backgroundGlowSize:{value:1},backgroundNoise:{value:.055}};
  for (const [key,value] of Object.entries(createDefaultSceneSettings().rays)) uniforms[`ray${key[0].toUpperCase()}${key.slice(1)}`] = { value };
  const material = new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,.999,1.);}',
    fragmentShader:`varying vec2 vUv;uniform float aspect;uniform vec3 deep;uniform vec3 earth;uniform vec3 amber;uniform vec3 light;
      uniform float rayIntensity;uniform float rayWidth;uniform float raySpread;uniform float rayAngle;
      uniform float raySourceX;uniform float raySourceY;uniform float raySoftness;uniform float rayWarmth;uniform float rayLength;
      uniform float backgroundBrightness;uniform float backgroundGradient;uniform float backgroundGlowStrength;
      uniform float backgroundGlowSize;uniform float backgroundNoise;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float shaft(float angle,float direction,float width){
        direction=-2.2+(direction+2.2)*raySpread+rayAngle;
        float difference=angle-direction;
        float offset=abs(atan(sin(difference),cos(difference)))/(width*rayWidth);
        return exp(-pow(offset,2./sqrt(raySoftness)));
      }
      void main(){
        vec2 q=(vUv-vec2(raySourceX-.34,raySourceY-.37))*vec2(aspect,1.);
        float glow=exp(-dot(q,q)*1.4/(backgroundGlowSize*backgroundGlowSize));
        float horizon=smoothstep(.04,.95,vUv.y);
        float gradientWeight=backgroundGradient<=1. ? horizon*backgroundGradient
          : 1.-pow(1.-horizon,backgroundGradient);
        vec3 color=mix(deep,earth,gradientWeight);
        color=mix(color,amber,min(glow*backgroundGlowStrength,1.));
        color+=light*pow(glow,3.)*.42*(backgroundGlowStrength/.53);
        color*=backgroundBrightness;
        // A common off-screen source keeps the light shafts directional.
        // Broad dust-lit volumes surround a few brighter, still soft cores.
        vec2 sun=(vUv-vec2(raySourceX,raySourceY))*vec2(aspect,1.);
        float angle=length(sun)<.0001 ? -2.2 : atan(sun.y,sun.x);
        float broad=shaft(angle,-2.47,.080)*.70
          +shaft(angle,-2.27,.105)
          +shaft(angle,-2.06,.075)*.80
          +shaft(angle,-1.82,.095)*.45;
        float coreWidth=sqrt(raySoftness);
        float cores=shaft(angle,-2.44,.014*coreWidth)*.60
          +shaft(angle,-2.25,.022*coreWidth)
          +shaft(angle,-2.03,.016*coreWidth)*.65;
        float distanceFromSun=length(sun);
        float reachFloor=.02+(1.-rayLength)*.55;
        float falloff=exp(-distanceFromSun*.36/rayLength)*smoothstep(reachFloor,reachFloor+.25,vUv.y);
        float haze=.84+.16*sin(distanceFromSun*4.2+angle*9.);
        color+=light*(broad*.17+cores*.085)*falloff*haze*rayIntensity;
        color*=mix(.64,1.,smoothstep(.0,.70,vUv.y));
        color=max(mix(vec3(dot(color,vec3(.2126,.7152,.0722))),color,rayWarmth),vec3(0.));
        color+=vec3(hash(vUv*1500.)-.5)*backgroundNoise*.0327*backgroundBrightness;
        gl_FragColor=vec4(max(color,vec3(0.)),1.);
      }`});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
  mesh.frustumCulled=false; mesh.renderOrder=-100; mesh.name='Amber light and atmospheric depth';scene.add(mesh);
  return {
    resize(){uniforms.aspect.value=viewportAspect();},
    setControls(params = {}) {
      if (!params || typeof params !== 'object') return;
      for (const [key, [min, max]] of Object.entries(controlRanges)) {
        const input = params[key];
        if (typeof input !== 'number' || !Number.isFinite(input)) continue;
        const value = THREE.MathUtils.clamp(input, min, max);
        uniforms[`ray${key[0].toUpperCase()}${key.slice(1)}`].value = key === 'angle' ? THREE.MathUtils.degToRad(value) : value;
      }
    },
    setBackground(params = {}) {
      if (!params || typeof params !== 'object') return;
      for (const [key, uniform] of [['bottomColor','deep'],['topColor','earth'],['glowColor','amber']]) {
        if (typeof params[key] === 'string' && /^#[0-9a-f]{6}$/i.test(params[key])) uniforms[uniform].value.set(params[key]);
      }
      for (const [key,[min,max]] of Object.entries(backgroundRanges)) {
        const uniform=uniforms[`background${key[0].toUpperCase()}${key.slice(1)}`];
        if (!uniform) continue;
        if (typeof params[key] !== 'number' || !Number.isFinite(params[key])) continue;
        uniform.value = THREE.MathUtils.clamp(params[key],min,max);
      }
    },
  };
}
