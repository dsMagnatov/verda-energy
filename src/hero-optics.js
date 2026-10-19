import * as THREE from 'three';
import { getSceneControlLimits } from './scene-settings.js';

// Refract the rendered opening itself, so silhouettes and stone detail bend
// together. HTML typography stays sharp above the canvas.
export function createJourneyCompositeMaterial(rockTexture, landTexture, aspect) {
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      rockScene: { value: rockTexture },
      landScene: { value: landTexture },
      progress: { value: 0 },
      aspect: { value: aspect },
      time: { value: 0 },
      resolution: { value: new THREE.Vector2(1600, 900) },
      opticalAmount: { value: .55 },
      opticalArea: { value: .65 },
      opticalSpeed: { value: .4 },
      blurLevel: { value: .45 },
      blurSize: { value: 6 },
      chromaticSize: { value: 10 },
      stretch: { value: .35 },
      cornerGains: { value: new THREE.Vector4(1, 1, 1, 1) },
      backgroundVignette: { value: .13 },
    },
    vertexShader: `varying vec2 vUv;
      void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D rockScene;
      uniform sampler2D landScene;
      uniform float progress;
      uniform float aspect;
      uniform float time;
      uniform vec2 resolution;
      uniform float opticalAmount;
      uniform float opticalArea;
      uniform float opticalSpeed;
      uniform float blurLevel;
      uniform float blurSize;
      uniform float chromaticSize;
      uniform float stretch;
      uniform vec4 cornerGains;
      uniform float backgroundVignette;

      float noise(vec2 p) {
        return sin(p.x*15.+sin(p.y*11.)*2.)*.5+sin(p.y*23.+p.x*7.)*.25;
      }

      vec2 boundedUv(vec2 uv) {
        vec2 halfPixel = .5 / resolution;
        return clamp(uv, halfPixel, 1.-halfPixel);
      }

      vec3 separatedSample(vec2 uv, vec2 split) {
        return vec3(
          texture2D(rockScene, boundedUv(uv+split)).r,
          texture2D(rockScene, boundedUv(uv)).g,
          texture2D(rockScene, boundedUv(uv-split)).b
        );
      }

      vec3 refractedOpening(vec2 uv) {
        vec2 p = uv*2.-1.;
        float border = smoothstep(1.-opticalArea, 1., max(abs(p.x), abs(p.y)));
        // TL, TR, BL, BR form a smooth independently adjustable corner field.
        float corners = mix(mix(cornerGains.z, cornerGains.w, uv.x),
          mix(cornerGains.x, cornerGains.y, uv.x), uv.y);
        float mask = border*corners*(1.-smoothstep(.15, .92, progress));
        vec3 result = texture2D(rockScene, uv).rgb;
        if (mask >= .0001) {
          float t = time;
          float rawWarp = opticalAmount*mask;
          // A narrow effect zone needs less geometric pull to avoid foldover.
          // The independent blur and channel separation keep their full range.
          float warp = rawWarp/(1.+rawWarp*.18)*min(1.,opticalArea/.65);
          // Lens refraction instead of the former rubber-like deformation.
          float lens = (.055+.012*sin(t*.28+p.x*1.4+p.y*1.7))*warp;
          vec2 refracted = p/(1.+dot(p,p)*lens);
          vec2 flow = vec2(sin(p.y*2.4+t*.24), cos(p.x*2.1-t*.21));
          float flowGain = 1.-exp(-.10*stretch*warp);
          refracted += flow*(1.-abs(refracted))*flowGain;
          vec2 lensUv = refracted*.5+.5;
          // Pixels are CSS pixels: the look stays stable as render DPR adapts.
          vec2 radialPixels = normalize(p*resolution + vec2(.0001));
          vec2 split = radialPixels/resolution*chromaticSize*mask;
          vec3 sharp = separatedSample(lensUv, split);
          float blurMix = clamp(blurLevel*mask, 0., 1.);
          result = sharp;
          if (blurMix >= .001 && blurSize >= .01) {
            vec2 axis = normalize(radialPixels+vec2(-radialPixels.y,radialPixels.x)*.28);
            vec2 radius = axis/resolution*blurSize*mask*max(1.,blurLevel);
            // Five Gaussian taps keep the separated red/blue edges soft.
            vec3 blurred = sharp*.40
              +separatedSample(lensUv+radius*.5,split)*.24
              +separatedSample(lensUv-radius*.5,split)*.24
              +separatedSample(lensUv+radius,split)*.06
              +separatedSample(lensUv-radius,split)*.06;
            result = mix(sharp, blurred, blurMix);
          }
        }
        return result;
      }

      void main() {
        vec2 uv=(vUv-vec2(.5,.51))*vec2(aspect,1.);
        float d=length(uv);
        float edge=noise(uv*2.8)*.045+noise(uv*7.)*.012;
        float radius=mix(-.15,1.5,progress);
        float aperture=1.-smoothstep(radius-.13,radius+.09,d+edge);
        if(progress<.001)aperture=0.;
        if(progress>.999)aperture=1.;
        float vignette=max(0.,1.-backgroundVignette*smoothstep(.25,1.2,length((vUv-.5)*vec2(1.25,1.))));
        vec3 col=mix(refractedOpening(vUv)*vignette,texture2D(landScene,vUv).rgb,aperture);
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const limits = getSceneControlLimits('optics');
  const uniformNames = { amount:'opticalAmount', area:'opticalArea', speed:'opticalSpeed',
    blur:'blurLevel', blurSize:'blurSize', chromatic:'chromaticSize', stretch:'stretch' };
  let previousTime = null, opticalTime = 0;
  material.setBackground = (values = {}) => {
    const [min,max] = getSceneControlLimits('background').vignette;
    if (Number.isFinite(values.vignette)) material.uniforms.backgroundVignette.value = THREE.MathUtils.clamp(values.vignette, min, max);
  };
  material.updateTime = elapsed => {
    if (!Number.isFinite(elapsed)) return;
    const delta = previousTime === null ? Math.max(0, elapsed) : Math.max(0, elapsed-previousTime);
    opticalTime += delta*material.uniforms.opticalSpeed.value;
    previousTime = elapsed;
    material.uniforms.time.value = opticalTime;
  };
  material.setControls = (values = {}) => {
    if (!values || typeof values !== 'object') return;
    for (const [key, uniform] of Object.entries(uniformNames)) {
      const [min,max] = limits[key];
      if (Number.isFinite(values[key])) material.uniforms[uniform].value = THREE.MathUtils.clamp(values[key], min, max);
    }
    const gains = material.uniforms.cornerGains.value;
    for (const [key, component] of [['topLeft', 'x'], ['topRight', 'y'], ['bottomLeft', 'z'], ['bottomRight', 'w']]) {
      const [min,max] = limits[key];
      if (Number.isFinite(values[key])) gains[component] = THREE.MathUtils.clamp(values[key], min, max);
    }
  };
  return material;
}
