import * as THREE from 'three';
import { getSceneControlLimits } from './scene-settings.js';

// A single draw call for dust at different depths in the opening scene.
export function createHeroDust(scene) {
  const limits = getSceneControlLimits('particles');
  const maxCount = limits.count[1];
  const controls = { count: 480, size: 1, brightness: 1, speed: 1, drift: 1, softness: 1, depth: 1, foreground: 1 };
  const maxSunlight = getSceneControlLimits('rays').intensity[1];
  let seed = 0x71d3a5b9;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const positions = new Float32Array(maxCount * 3);
  const traits = new Float32Array(maxCount * 4);
  const drift = new Float32Array(maxCount * 2);
  const foregroundFlags = new Float32Array(maxCount);
  for (let i = 0; i < maxCount; i++) {
    // Sparse near-camera motes are larger, softer and much more transparent.
    // The first 480 retain the original seeded distribution at the default count.
    const foreground = i < 26 || (i >= 480 && (i - 480) % 18 === 0);
    foregroundFlags[i] = foreground ? 1 : 0;
    positions[i * 3] = (random() - .5) * (foreground ? 18 : 30);
    positions[i * 3 + 1] = random() * 16 - 6;
    positions[i * 3 + 2] = foreground ? 5.8 + random() * 3.3 : -18 + random() * 23;
    traits[i * 4] = foreground ? .070 + random() * .100 : .032 + random() ** 2 * .076;
    traits[i * 4 + 1] = foreground ? .090 + random() * .080 : .27 + random() * .36;
    traits[i * 4 + 2] = random() * Math.PI * 2;
    traits[i * 4 + 3] = .035 + random() * .045;
    drift[i * 2] = .22 + random() * .70;
    drift[i * 2 + 1] = .20 + random() * .55;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTraits', new THREE.BufferAttribute(traits, 4));
  geometry.setAttribute('aDrift', new THREE.BufferAttribute(drift, 2));
  geometry.setAttribute('aForeground', new THREE.BufferAttribute(foregroundFlags, 1));
  geometry.setDrawRange(0, controls.count);
  const uniforms = {
    uTime: { value: 0 },
    uViewportHeight: { value: typeof window === 'undefined' ? 1080 : window.innerHeight },
    uProjectionScale: { value: 2.5 },
    uPointer: { value: new THREE.Vector2() },
    uColor: { value: new THREE.Color('#f0ddbc') },
    uSize: { value: 1 },
    uBrightness: { value: 1 },
    uDrift: { value: 1 },
    uSoftness: { value: 1 },
    uDepth: { value: 1 },
    uForeground: { value: 1 },
    uBeamEnabled: { value: 0 },
    uBeamPosition: { value: new THREE.Vector3() },
    uBeamDirection: { value: new THREE.Vector3(0, -1, 0) },
    uBeamColor: { value: new THREE.Color('#fff0d8') },
    uBeamOuterCos: { value: Math.cos(.64) },
    uBeamInnerCos: { value: Math.cos(.64 * .62) },
    uBeamIntensity: { value: 0 },
    uBeamDistance: { value: 34 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: false,
    vertexShader: `
      uniform float uTime;
      uniform float uViewportHeight;
      uniform float uProjectionScale;
      uniform vec2 uPointer;
      uniform float uSize;
      uniform float uDrift;
      uniform float uDepth;
      uniform float uForeground;
      uniform float uBeamEnabled;
      uniform vec3 uBeamPosition;
      uniform vec3 uBeamDirection;
      uniform float uBeamOuterCos;
      uniform float uBeamInnerCos;
      uniform float uBeamIntensity;
      uniform float uBeamDistance;
      attribute vec4 aTraits;
      attribute vec2 aDrift;
      attribute float aForeground;
      varying float vOpacity;
      varying float vSunlit;
      void main() {
        vec3 p = position;
        float phase = aTraits.z;
        p.y = mod(p.y + 6. + uTime * aTraits.w, 16.) - 6.;
        p.x += sin(uTime * .11 + phase) * aDrift.x * uDrift;
        p.y += sin(uTime * .17 + phase * 1.7) * .14 * uDrift;
        p.z = -5.5 + (p.z + 5.5) * uDepth;
        p.z += sin(uTime * .075 + phase * 2.3) * aDrift.y * uDrift;
        p.xy += uPointer * (.035 + aDrift.x * .12) * uDrift;
        vec4 viewPosition = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * viewPosition;
        float depth = -viewPosition.z;
        float foregroundSize = mix(1., sqrt(uForeground), aForeground);
        float maxSize = min(480., 30. * uSize * max(1., foregroundSize));
        gl_PointSize = clamp(aTraits.x * uSize * foregroundSize * uViewportHeight * .5 * uProjectionScale / max(depth, .2), 1.1 * uSize, maxSize);
        vec2 screen = gl_Position.xy / max(gl_Position.w, .001);
        // Keep the centre quiet so atmospheric detail does not compete with the title.
        float titleClearance = mix(.46, 1., smoothstep(.15, .7, length(screen * vec2(.82, 1.35))));
        float fieldEdge = smoothstep(-6., -3., p.y) * (1. - smoothstep(7., 10., p.y));
        float depthSpread = max(1., uDepth);
        float depthFade = smoothstep(.6, 2.8, depth) * (1. - smoothstep(20.*depthSpread, 38.*depthSpread, depth));
        float breath = .79 + sin(uTime * .19 + phase) * .21;
        vOpacity = aTraits.y * titleClearance * fieldEdge * depthFade * breath * mix(1., uForeground, aForeground);
        vec3 fromLight = (modelMatrix * vec4(p, 1.)).xyz - uBeamPosition;
        float lightDistance = length(fromLight);
        float cone = smoothstep(uBeamOuterCos, uBeamInnerCos, dot(fromLight / max(lightDistance, .0001), uBeamDirection));
        float reach = uBeamDistance > .001 ? 1. - smoothstep(uBeamDistance * .72, uBeamDistance, lightDistance) : 1.;
        vSunlit = cone * reach * uBeamIntensity * uBeamEnabled;
        // The shared sun reveals dust inside its actual world-space cone.
        // Ambient visibility remains when the sun is off or outside that cone.
        vOpacity *= mix(1., .65 + .65 * vSunlit, uBeamEnabled);
        if (depth < .1) vOpacity = 0.;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uBrightness;
      uniform float uSoftness;
      uniform float uBeamEnabled;
      uniform vec3 uBeamColor;
      varying float vOpacity;
      varying float vSunlit;
      void main() {
        vec2 point = gl_PointCoord * 2. - 1.;
        float radius = length(point);
        float edge = clamp(1. - .5 * uSoftness, .05, .92);
        float softness = exp(-radius * radius * 2.8 / max(.16, uSoftness)) * (1. - smoothstep(edge, 1., radius));
        float alpha = min(.95, softness * vOpacity * uBrightness);
        if (alpha < .002) discard;
        vec3 color = mix(uColor, uBeamColor, .22 * clamp(vSunlit, 0., 1.) * uBeamEnabled);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'Soft suspended mineral dust';
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'Hero atmospheric particles';
  group.add(points);
  scene.add(group);
  let previousTime = null;
  let effectTime = 0;
  let lightSource = null;
  let raySettings = null;
  const lightPosition = new THREE.Vector3();
  const lightTarget = new THREE.Vector3();

  function updateLightSource() {
    uniforms.uBeamEnabled.value = 0;
    uniforms.uBeamIntensity.value = 0;
    if (!lightSource?.isSpotLight || !lightSource.target?.isObject3D) return;
    lightSource.getWorldPosition(lightPosition);
    lightSource.target.getWorldPosition(lightTarget);
    if (!Number.isFinite(lightPosition.x) || !Number.isFinite(lightPosition.y) || !Number.isFinite(lightPosition.z)
      || !Number.isFinite(lightTarget.x) || !Number.isFinite(lightTarget.y) || !Number.isFinite(lightTarget.z)) return;
    lightTarget.sub(lightPosition);
    if (lightTarget.lengthSq() < 1e-10) return;
    uniforms.uBeamPosition.value.copy(lightPosition);
    uniforms.uBeamDirection.value.copy(lightTarget).normalize();
    const angle = THREE.MathUtils.clamp(Number.isFinite(lightSource.angle) ? lightSource.angle : .64, .01, Math.PI * .5 - .01);
    const penumbra = THREE.MathUtils.clamp(Number.isFinite(lightSource.penumbra) ? lightSource.penumbra : .38, 0, 1);
    const outerCos = Math.cos(angle);
    uniforms.uBeamOuterCos.value = outerCos;
    uniforms.uBeamInnerCos.value = Math.min(1, Math.max(outerCos + .00001, Math.cos(angle * (1 - penumbra))));
    uniforms.uBeamDistance.value = Number.isFinite(lightSource.distance) ? Math.max(0, lightSource.distance) : 34;
    if (lightSource.color?.isColor && Number.isFinite(lightSource.color.r) && Number.isFinite(lightSource.color.g) && Number.isFinite(lightSource.color.b)) {
      uniforms.uBeamColor.value.copy(lightSource.color);
    }
    // createHeroLighting maps ray intensity 1 to a physical intensity of 4.2.
    // Normalize once instead of multiplying the shared ray gain a second time.
    const intensity = Number.isFinite(lightSource.intensity) ? lightSource.intensity / 4.2
      : Number.isFinite(raySettings?.intensity) ? raySettings.intensity : 1;
    uniforms.uBeamIntensity.value = lightSource.visible ? THREE.MathUtils.clamp(intensity, 0, maxSunlight) : 0;
    uniforms.uBeamEnabled.value = 1;
  }

  return {
    group,
    setLightSource(spotLight, rays = { intensity: 1 }) {
      lightSource = spotLight?.isSpotLight ? spotLight : null;
      raySettings = rays && typeof rays === 'object' ? rays : null;
      updateLightSource();
    },
    setControls(params = {}) {
      if (!params || typeof params !== 'object') return;
      for (const key in limits) {
        const value = params[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const bounded = Math.min(limits[key][1], Math.max(limits[key][0], value));
        controls[key] = key === 'count' ? Math.round(bounded) : bounded;
      }
      geometry.setDrawRange(0, controls.count);
      uniforms.uSize.value = controls.size;
      uniforms.uBrightness.value = controls.brightness;
      uniforms.uDrift.value = controls.drift;
      uniforms.uSoftness.value = controls.softness;
      uniforms.uDepth.value = controls.depth;
      uniforms.uForeground.value = controls.foreground;
    },
    update(time, camera, pointer) {
      if (Number.isFinite(time)) {
        effectTime += (previousTime === null ? Math.max(0, time) : Math.max(0, time - previousTime)) * controls.speed;
        previousTime = time;
      }
      uniforms.uTime.value = effectTime;
      uniforms.uProjectionScale.value = camera.projectionMatrix.elements[5];
      if (pointer) uniforms.uPointer.value.copy(pointer);
      else uniforms.uPointer.value.set(0, 0);
      updateLightSource();
    },
    resize(height = window.innerHeight, pixelRatio = 1) {
      uniforms.uViewportHeight.value = height * pixelRatio;
    },
    dispose() {
      scene.remove(group);
      geometry.dispose();
      material.dispose();
    },
  };
}
