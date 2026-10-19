import * as THREE from 'three';
import { readTitleHoverControls } from './title-hover-settings.js';

// The DOM h1 remains the accessible/static edition. The title is drawn after the
// scene composite, preserving clean typography while the actual stone depth
// masks its glyphs. The depth lookup follows the same refraction as the rocks.
// Integration: await createHeroTitle(compositeScene, h1, {
//   depthTexture: rockTarget.depthTexture, compositeMaterial,
// }); resize() on viewport changes; update(introOpacity, ambientPaused).
export async function createHeroTitle(scene, element, { depthTexture, compositeMaterial } = {}) {
  const noop = { resize() {}, setControls() {}, update() {}, dispose() {} };
  if (!element) return noop;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: true });
  const blurCanvas = document.createElement('canvas');
  const blurContext = blurCanvas.getContext('2d', { alpha: true });
  const glowCanvas = document.createElement('canvas');
  const glowContext = glowCanvas.getContext('2d', { alpha: true });
  if (!context || !blurContext || !glowContext) return noop;

  function createTitleTexture(source) {
    const titleTexture = new THREE.CanvasTexture(source);
    titleTexture.minFilter = THREE.LinearFilter;
    titleTexture.magFilter = THREE.LinearFilter;
    titleTexture.generateMipmaps = false;
    return titleTexture;
  }
  let texture = createTitleTexture(canvas);
  let blurTexture = createTitleTexture(blurCanvas);
  let glowTexture = createTitleTexture(glowCanvas);
  let controls = readTitleHoverControls();
  const color = new THREE.Color(getComputedStyle(element).color);
  const uniforms = {
    titleMap: { value: texture },
    titleBlurMap: { value: blurTexture },
    titleGlowMap: { value: glowTexture },
    titleColor: { value: color },
    glowColor: { value: new THREE.Color(controls.glowColor) },
    glowIntensity: { value: controls.glow },
    blurStrength: { value: controls.blur },
    lensSoftness: { value: controls.softness },
    lensDistortion: { value: controls.distortion },
    resolution: { value: new THREE.Vector2(1, 1) },
    opacity: { value: 1 },
    lift: { value: 0 },
    lens: { value: new THREE.Vector2(-2, -2) },
    lensAmount: { value: 0 },
    lensRadius: { value: controls.radius },
    stoneDepth: { value: depthTexture || null },
    hasStoneDepth: { value: depthTexture ? 1 : 0 },
    time: { value: 0 },
    progress: { value: 0 },
    opticalAmount: { value: 0 },
    opticalArea: { value: .65 },
    stretch: { value: 0 },
    cornerGains: { value: new THREE.Vector4(1, 1, 1, 1) },
  };
  // Share uniform objects rather than copying values each frame, so the mask
  // cannot lag behind animated optics or live control-panel changes.
  for (const name of ['time', 'progress', 'opticalAmount', 'opticalArea', 'stretch', 'cornerGains']) {
    if (compositeMaterial?.uniforms?.[name]) uniforms[name] = compositeMaterial.uniforms[name];
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0., 1.);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D titleMap;
      uniform sampler2D titleBlurMap;
      uniform sampler2D titleGlowMap;
      uniform vec3 titleColor;
      uniform vec3 glowColor;
      uniform float glowIntensity;
      uniform float blurStrength;
      uniform float lensSoftness;
      uniform float lensDistortion;
      uniform vec2 resolution;
      uniform float opacity;
      uniform float lift;
      uniform vec2 lens;
      uniform float lensAmount;
      uniform float lensRadius;
      uniform sampler2D stoneDepth;
      uniform float hasStoneDepth;
      uniform float time;
      uniform float progress;
      uniform float opticalAmount;
      uniform float opticalArea;
      uniform float stretch;
      uniform vec4 cornerGains;
      vec2 stoneUv(vec2 uv) {
        vec2 p = uv * 2. - 1.;
        float border = smoothstep(1. - opticalArea, 1., max(abs(p.x), abs(p.y)));
        float corners = mix(mix(cornerGains.z, cornerGains.w, uv.x),
          mix(cornerGains.x, cornerGains.y, uv.x), uv.y);
        float mask = border * corners * (1. - smoothstep(.15, .92, progress));
        if (mask < .0001) return uv;
        float rawWarp = opticalAmount * mask;
        float warp = rawWarp / (1. + rawWarp * .18) * min(1., opticalArea / .65);
        float opticalLens = (.055 + .012 * sin(time * .28 + p.x * 1.4 + p.y * 1.7)) * warp;
        vec2 refracted = p / (1. + dot(p, p) * opticalLens);
        vec2 flow = vec2(sin(p.y * 2.4 + time * .24), cos(p.x * 2.1 - time * .21));
        float flowGain = 1. - exp(-.10 * stretch * warp);
        refracted += flow * (1. - abs(refracted)) * flowGain;
        vec2 halfPixel = .5 / resolution;
        return clamp(refracted * .5 + .5, halfPixel, 1. - halfPixel);
      }
      float titleAlpha(vec2 uv) {
        if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 0.;
        return texture2D(titleMap, uv).a;
      }
      float titleBlurAlpha(vec2 uv) {
        if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 0.;
        return texture2D(titleBlurMap, uv).a;
      }
      float titleGlowAlpha(vec2 uv) {
        if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 0.;
        return texture2D(titleGlowMap, uv).a;
      }
      void main() {
        // The depth mask follows scene optics; the letters use only their local
        // cursor lens and keep the editorial layout clear of scene RGB effects.
        if (hasStoneDepth > .5 && texture2D(stoneDepth, stoneUv(vUv)).x < .99998) discard;
        vec2 uv = vUv - vec2(0., lift / resolution.y);
        vec2 delta = (vUv - lens) * resolution;
        float distanceToLens = length(delta);
        float innerRadius = lensRadius * (1. - lensSoftness);
        float softLens = (1. - smoothstep(innerRadius, lensRadius, distanceToLens)) * lensAmount;
        // A bounded radial pull and gentle twist bend only the hovered region.
        // Both terms approach zero at its boundary, leaving surrounding type still.
        if (softLens > .001 && lensDistortion > .001) {
          vec2 direction = delta / max(distanceToLens, 1.);
          vec2 tangent = vec2(-direction.y, direction.x);
          float curve = sin(clamp(distanceToLens / lensRadius, 0., 1.) * 3.14159265);
          vec2 bend = (direction * 12. * smoothstep(0., lensRadius * .32, distanceToLens)
            + tangent * curve * 5.) * lensDistortion * softLens;
          uv += bend / resolution;
        }
        float sharp = titleAlpha(uv);
        float alpha = sharp;
        float glowEnergy = 0.;
        float edgeEnergy = 0.;
        if (softLens > .001) {
          // A broad feather eases from real defocus into untouched typography.
          // At the lens core no crisp letter copy remains under the haze.
          float blurred = titleBlurAlpha(uv);
          alpha = mix(sharp, blurred, softLens * blurStrength);
          if (glowIntensity > .001) {
            // The halo is a Gaussian image of the glyphs, never a cursor disc.
            float glowPlate = titleGlowAlpha(uv);
            glowEnergy = glowPlate * glowIntensity * (softLens * .70 + softLens * softLens * .65);
            edgeEnergy = sharp * glowIntensity * (4. * softLens * (1. - softLens)) * .32;
          }
        }
        float haloAlpha = min(.95, glowEnergy * .46);
        float combinedAlpha = alpha + haloAlpha * (1. - alpha);
        if (combinedAlpha * opacity < .001) discard;
        vec3 light = titleColor * alpha + glowColor * (glowEnergy * .8 + edgeEnergy);
        gl_FragColor = vec4(light / max(combinedAlpha, .00001), combinedAlpha * opacity);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.name = 'Editorial title behind floating stones';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  scene.add(mesh);

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const point = new THREE.Vector2(-2, -2);
  const target = new THREE.Vector2(-2, -2);
  let targetAmount = 0;
  let width = 1, height = 1, resizeFrame = 0, disposed = false;
  let canvasRatio = 1;
  let layoutDirty = true, blurDirty = true, glowDirty = true;
  let layoutLift = 0;
  let lastTime = performance.now();

  function rows() {
    const sharp = element.querySelector('.title-hover__sharp') || element;
    return [...sharp.querySelectorAll('.hero-title-line')];
  }

  function drawLine(line) {
    const style = getComputedStyle(line);
    const bounds = line.getBoundingClientRect();
    const text = line.textContent.trim();
    if (!text || bounds.width <= 0 || bounds.height <= 0) return;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    const spacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    if ('letterSpacing' in context) context.letterSpacing = spacing;
    const metrics = context.measureText(text);
    const fontSize = parseFloat(style.fontSize);
    const ascent = metrics.fontBoundingBoxAscent ?? fontSize * .8;
    const descent = metrics.fontBoundingBoxDescent ?? fontSize * .2;
    const lineHeight = parseFloat(style.lineHeight) || bounds.height;
    const baseline = bounds.top + layoutLift + (lineHeight - ascent - descent) / 2 + ascent;
    const available = bounds.width;
    const textWidth = metrics.width;
    const align = style.textAlign;
    const inset = align === 'right' || align === 'end' ? available - textWidth
      : align === 'center' ? (available - textWidth) / 2 : 0;
    context.fillText(text, bounds.left + inset, baseline);
  }

  function paint() {
    resizeFrame = 0;
    if (disposed || !element.isConnected) return;
    if (!layoutDirty) {
      refreshPlates();
      return;
    }
    const lines = rows();
    if (!lines.length) return;
    width = Math.max(1, innerWidth);
    height = Math.max(1, innerHeight);
    // Stay inside baseline WebGL texture limits even on ultrawide desktops.
    const ratio = canvasRatio = Math.min(devicePixelRatio || 1, 2, 4096 / width, 4096 / height);
    const nextWidth = Math.max(1, Math.round(width * ratio));
    const nextHeight = Math.max(1, Math.round(height * ratio));
    const resized = canvas.width !== nextWidth || canvas.height !== nextHeight;
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    if (resized) {
      // GPU texture storage is immutable after upload. A new aspect ratio
      // needs fresh storage, while the material and uniform objects persist.
      texture.dispose();
      texture = createTitleTexture(canvas);
      uniforms.titleMap.value = texture;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#fff';
    // updateUI translates the DOM copy while leaving its layout intact. Remove
    // that temporary lift from the measured plate; the uniform applies it once.
    const hero = element.closest('.hero-copy');
    const transform = hero ? getComputedStyle(hero).transform : 'none';
    layoutLift = transform !== 'none' ? -new DOMMatrixReadOnly(transform).m42 : 0;
    for (const line of lines) drawLine(line);
    layoutDirty = false;
    blurDirty = glowDirty = true;
    refreshPlates();
    uniforms.resolution.value.set(width, height);
    color.set(getComputedStyle(element).color);
    texture.needsUpdate = true;
    document.body.classList.add('webgl-title-ready');
  }

  function refreshPlate(targetCanvas, targetContext, targetTexture, size) {
    const resized = targetCanvas.width !== canvas.width || targetCanvas.height !== canvas.height;
    targetCanvas.width = canvas.width;
    targetCanvas.height = canvas.height;
    if (resized) {
      targetTexture.dispose();
      targetTexture = createTitleTexture(targetCanvas);
    }
    targetContext.setTransform(1, 0, 0, 1, 0, 0);
    targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetContext.filter = size > 0 ? `blur(${size * canvasRatio}px)` : 'none';
    targetContext.drawImage(canvas, 0, 0);
    targetContext.filter = 'none';
    targetTexture.needsUpdate = true;
    return targetTexture;
  }

  function refreshPlates() {
    if (blurDirty) uniforms.titleBlurMap.value = blurTexture = refreshPlate(blurCanvas, blurContext, blurTexture, controls.blurSize);
    if (glowDirty) uniforms.titleGlowMap.value = glowTexture = refreshPlate(glowCanvas, glowContext, glowTexture, controls.glowSize);
    blurDirty = glowDirty = false;
  }

  function schedulePaint() {
    if (!disposed && !resizeFrame) resizeFrame = requestAnimationFrame(paint);
  }

  function resize() { layoutDirty = true; schedulePaint(); }

  function setControls(values) {
    if (disposed) return;
    const next = readTitleHoverControls(values, controls);
    if (next.blurSize !== controls.blurSize) blurDirty = true;
    if (next.glowSize !== controls.glowSize) glowDirty = true;
    controls = next;
    uniforms.blurStrength.value = controls.blur;
    uniforms.lensRadius.value = controls.radius;
    uniforms.lensSoftness.value = controls.softness;
    uniforms.lensDistortion.value = controls.distortion;
    uniforms.glowIntensity.value = controls.glow;
    uniforms.glowColor.value.set(controls.glowColor);
    if (blurDirty || glowDirty) schedulePaint();
  }

  function reset() { targetAmount = 0; }
  function move(event) {
    if (event.pointerType === 'touch' || reducedMotion.matches || !finePointer.matches || document.hidden) return reset();
    target.set(event.clientX / width, 1 - event.clientY / height);
    if (uniforms.lensAmount.value < .001) point.copy(target);
    targetAmount = 1;
  }

  element.addEventListener('pointermove', move, { passive: true });
  element.addEventListener('pointerleave', reset);
  element.addEventListener('pointercancel', reset);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  reducedMotion.addEventListener('change', reset);
  finePointer.addEventListener('change', reset);
  const observer = new ResizeObserver(resize);
  observer.observe(element);

  // Font loading normally resolves before assets do; the bounded wait also
  // keeps the semantic heading usable if a font request cannot complete.
  if (document.fonts?.ready) {
    await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2500))]);
    document.fonts.ready.then(resize);
  }
  if (disposed) return noop;
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  paint();

  return {
    resize,
    setControls,
    get controls() { return { ...controls }; },
    uniforms,
    update(opacity = 1, paused = false) {
      const now = performance.now();
      const dt = Math.min(.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      const visible = Number.isFinite(opacity) ? THREE.MathUtils.clamp(opacity, 0, 1) : 0;
      uniforms.opacity.value = visible;
      uniforms.lift.value = (1 - visible) * 25;
      mesh.visible = visible > .001;
      const enabled = !paused && !reducedMotion.matches && finePointer.matches && !document.hidden && visible > .2;
      if (!enabled) {
        uniforms.lensAmount.value = 0;
        targetAmount = 0;
        return;
      }
      const ease = 1 - Math.exp(-dt * controls.response);
      point.lerp(target, ease);
      uniforms.lens.value.copy(point);
      uniforms.lensAmount.value += (targetAmount - uniforms.lensAmount.value) * ease;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', reset);
      element.removeEventListener('pointercancel', reset);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
      reducedMotion.removeEventListener('change', reset);
      finePointer.removeEventListener('change', reset);
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      blurTexture.dispose();
      glowTexture.dispose();
      document.body.classList.remove('webgl-title-ready');
    },
  };
}
