import './style.css';
import './hero.css';
import './contact.css';
import './title-hover.css';
import * as THREE from 'three';
import { loadStone, createFloatingRocks } from './rocks.js';
import { createSolarGarden } from './solar-garden.js';
import { createTimeline, getPose, range } from './journey.js';
import { loadHeroAssets } from './hero-assets.js';
import { createHeroAtmosphere } from './hero-atmosphere.js';
import { createTitleHover } from './title-hover.js';
import { createHeroDust } from './hero-dust.js';
import { createJourneyCompositeMaterial } from './hero-optics.js';
import { createSceneControls } from './scene-controls.js';
import { createHeroLighting } from './hero-lighting.js';
import { createHeroTitle } from './hero-title.js';
import { loadHeroFernTemplates } from './hero-ferns.js';
import { createDefaultSceneSettings } from './scene-settings.js';
import { createSolarSpecs } from './solar-specs.js';
import { createContactForms } from './contact.js';
import { createMobileNavigation, getSceneFraming } from './responsive.js';
import { createPreloader } from './preloader.js';
import { createGardenIntroArt } from './garden-intro-art.js';
import { createGardenIntroReveal } from './garden-intro-reveal.js';
import './mobile.css';
import './garden-intro.css';

const canvas = document.querySelector('#scene');
const preloader = createPreloader();
preloader.progress(4);
const media = window.matchMedia('(prefers-reduced-motion: reduce)');
const titleHover = createTitleHover(document.querySelector('#hero-title'));
let ambientPaused = media.matches;
const motionButton = document.querySelector('#motion-toggle');
function setMotionUI() {
  titleHover.setPaused(ambientPaused);
  motionButton.setAttribute('aria-pressed', String(ambientPaused));
  motionButton.setAttribute('aria-label', ambientPaused ? 'Resume ambient animation' : 'Pause ambient animation');
  document.querySelector('#motion-label').textContent = ambientPaused ? 'Motion off' : 'Motion on';
  motionButton.querySelector('.motion-symbol').textContent = ambientPaused ? '▷' : 'Ⅱ';
}
setMotionUI();
motionButton.addEventListener('click', () => { ambientPaused = !ambientPaused; setMotionUI(); });
media.addEventListener('change', () => { ambientPaused = media.matches; setMotionUI(); });

const timeline = createTimeline();
createMobileNavigation();
document.querySelectorAll('[data-progress]').forEach(link => link.addEventListener('click', event => {
  if (document.body.classList.contains('no-webgl')) return;
  event.preventDefault(); timeline.jump(Number(link.dataset.progress));
}));

const dialog = document.querySelector('#contact-dialog');
document.querySelectorAll('[data-contact]').forEach(button => button.addEventListener('click', () => dialog.showModal()));
dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
createContactForms();

const ui = {
  hero: document.querySelector('.hero-copy'),
  gardenIntro: document.querySelector('.garden-intro-copy'),
  garden: document.querySelector('.garden-copy'),
  nav: [...document.querySelectorAll('.nav-link')],
};
const gardenIntroReveal = createGardenIntroReveal(ui.gardenIntro);
function visibility(element, opacity, offset = 0) {
  element.style.opacity = opacity.toFixed(3);
  element.style.transform = `translateY(${offset.toFixed(1)}px)`;
  element.inert = opacity < .08;
  if (element.classList.contains('story-copy')) element.style.pointerEvents = opacity > .2 ? 'auto' : 'none';
}
let lastUIProgress = -1;
function updateUI(progress) {
  if (Math.abs(progress - lastUIProgress) < .00008) return;
  lastUIProgress = progress;
  const intro = 1 - range(.035, .19, progress);
  visibility(ui.hero, intro, -(1 - intro) * 25);
  const gardenArrival = range(.425, .455, progress) * (1 - range(.61, .70, progress));
  visibility(ui.gardenIntro, gardenArrival, (1 - gardenArrival) * 18);
  const garden = range(.80, .90, progress);
  visibility(ui.garden, garden, (1 - garden) * 18);
  ui.nav.forEach((link, i) => link.classList.toggle('active', i === (progress < .455 ? 0 : progress < .84 ? 1 : 2)));
}

function fallback(message) {
  console.warn('VERDA ENERGY:', message);
  document.body.classList.add('no-webgl');
  gardenIntroReveal.showStatic();
  document.body.classList.remove('webgl-title-ready');
  document.querySelector('#fallback-note').hidden = false;
  preloader.finish(false);
  for (const element of [ui.hero, ui.gardenIntro, ui.garden]) { element.removeAttribute('style'); element.inert = false; }
  document.querySelector('.solar-specs').inert = false;
  document.querySelectorAll('.solar-spec-card').forEach(card => card.inert = false);
  canvas.style.display = 'none';
  document.body.classList.remove('garden-active');
  const syncStaticHeader = () => document.body.classList.toggle('hero-active', document.querySelector('#closing').getBoundingClientRect().top > 90);
  syncStaticHeader();
  window.addEventListener('scroll', syncStaticHeader, { passive: true });
}

async function init() {
  let framing = getSceneFraming(innerWidth, innerHeight, devicePixelRatio);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !framing.compact, powerPreference: 'high-performance', alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const introScene = new THREE.Scene(), landScene = new THREE.Scene();
  introScene.background = new THREE.Color('#16140f');
  introScene.fog = new THREE.FogExp2('#604729', .016);
  const atmosphere = createHeroAtmosphere(introScene);
  const gardenAtmosphere = createHeroAtmosphere(landScene);
  const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, .08, 180);
  const landCamera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, .10, 220);
  const heroLighting = createHeroLighting(introScene);
  const gardenLighting = createHeroLighting(landScene);
  if (framing.compact) {
    for (const lighting of [heroLighting, gardenLighting]) lighting.key.shadow.mapSize.set(1024,1024);
  }
  landScene.add(new THREE.HemisphereLight('#e2e8db', '#343c2c', 1.1));
  const gardenFill = new THREE.DirectionalLight('#e9ecdf', 1.15);
  gardenFill.position.set(-6, 10, 9); landScene.add(gardenFill);
  const uniforms = {
    time: { value: 0 }, pointerWorld: { value: new THREE.Vector3(1000, 0, 1000) }, pointerActive: { value: 0 },
    pointerRayOrigin: { value: new THREE.Vector3() }, pointerRayDirection: { value: new THREE.Vector3(0, 0, -1) },
    pointerPresence: { value: 0 }, pointerScreen: { value: new THREE.Vector2(-2, -2) },
    renderResolution: { value: new THREE.Vector2(innerWidth, innerHeight) }, hoverRadius: { value: .225 },
  };
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => preloader.progress(5 + loaded / total * 65);
  manager.onError = url => console.warn('Asset failed:', url);
  const fontsReady = document.fonts ? Promise.all([
    document.fonts.load('400 64px Instrument'), document.fonts.load('400 16px Manrope'),
  ]).catch(error => console.warn('Font fallback:', error)) : Promise.resolve();
  const [stone, heroAssets, fernTemplates] = await Promise.all([
    loadStone(manager), loadHeroAssets(manager), loadHeroFernTemplates(manager),
    fontsReady,
  ]);
  preloader.progress(74);
  const rocks = createFloatingRocks(stone, uniforms, {...heroAssets,fernTemplates}); introScene.add(rocks.group);
  const dust=createHeroDust(introScene);
  const landscape = createSolarGarden({ uniforms, stoneMaterial: stone, fernTemplates }); landScene.add(landscape.group);
  const gardenPanelPointer = new THREE.Vector2();
  const solarSpecs = createSolarSpecs(document.querySelector('.solar-specs'), landscape.panel, landCamera);
  const gardenDust = createHeroDust(landScene);

  const targetOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType };
  const rockTarget = new THREE.WebGLRenderTarget(1, 1, targetOptions);
  rockTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const landTarget = new THREE.WebGLRenderTarget(1, 1, targetOptions);
  const gardenOpticTarget = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
  const compositeScene = new THREE.Scene();
  const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const compositeMaterial = createJourneyCompositeMaterial(rockTarget.texture, gardenOpticTarget.texture, innerWidth / innerHeight);
  const gardenCompositeScene = new THREE.Scene();
  const gardenCompositeMaterial = createJourneyCompositeMaterial(landTarget.texture, landTarget.texture, innerWidth / innerHeight);
  gardenCompositeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), gardenCompositeMaterial));
  let sceneSettings = createDefaultSceneSettings();
  let heroTitle, gardenIntroArt;
  const applySceneControls = settings => {
    sceneSettings = settings;
    atmosphere.setControls(settings.rays);
    heroLighting.setControls(settings.rays);
    gardenLighting.setControls(settings.gardenRays);
    atmosphere.setBackground(settings.background);
    gardenAtmosphere.setControls(settings.gardenRays);
    gardenAtmosphere.setBackground(settings.gardenBackground);
    dust.setControls(settings.particles);
    dust.setLightSource(heroLighting.key, settings.rays);
    gardenDust.setControls(settings.gardenParticles);
    gardenDust.setLightSource(gardenLighting.key, settings.gardenRays);
    landscape.setAppearance(settings.solar);
    landscape.setControls(settings);
    gardenCompositeMaterial.setControls(settings.gardenOptics);
    gardenCompositeMaterial.setBackground(settings.gardenBackground);
    compositeMaterial.setControls(settings.optics);
    compositeMaterial.setBackground(settings.background);
    rocks.main.children[0].material.setControls(settings.stone);
    rocks.decorations.setControls(settings);
    titleHover.setControls(settings.title);
    heroTitle?.setControls(settings.title);
    gardenIntroArt?.setControls(settings);
    document.documentElement.style.setProperty('--hero-grain-opacity', settings.background.noise);
    document.documentElement.style.setProperty('--hero-shade-opacity', Math.min(1, settings.background.vignette/.13));
    document.documentElement.style.setProperty('--garden-grain-opacity', settings.gardenBackground.noise);
    document.documentElement.style.setProperty('--garden-shade-opacity', Math.min(1, settings.gardenBackground.vignette/.13));
  };
  const sceneControls = await createSceneControls({
    onChange: applySceneControls,
    onFernSelection: id => rocks.decorations.selectFern(id),
    onSceneSelection: scope => timeline.jump(scope === 'garden' ? .52 : 0),
  });
  applySceneControls(sceneControls.settings);
  preloader.progress(80);
  compositeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial));
  heroTitle = await createHeroTitle(compositeScene, document.querySelector('#hero-title'), {
    depthTexture: rockTarget.depthTexture, compositeMaterial,
  });
  heroTitle.setControls(sceneControls.settings.title);
  gardenIntroArt = await createGardenIntroArt({
    canvas: document.querySelector('#garden-intro-art'),
    rockGeometry: heroAssets.mainGeometry, stoneMaterial: stone, fernTemplates, compact: framing.compact,
  }).catch(error => { console.warn('Garden card artwork:', error); return null; });
  gardenIntroArt?.setControls(sceneControls.settings);
  if (gardenIntroArt) document.querySelector('.garden-intro-art').classList.add('is-ready');
  let pixelRatio = framing.pixelRatio;
  function resize() {
    framing = getSceneFraming(innerWidth, innerHeight, devicePixelRatio);
    pixelRatio = Math.min(pixelRatio, framing.pixelRatio);
    landscape.vegetation.setQuality(framing.compact ? .5 : 1);
    const reflection=landscape.pond.getRenderTarget(), reflectionSize=framing.compact?512:768;
    if (reflection.width!==reflectionSize) reflection.setSize(reflectionSize,reflectionSize);
    renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight);
    camera.aspect = landCamera.aspect = innerWidth / innerHeight;
    camera.fov = framing.heroFov;
    camera.updateProjectionMatrix(); landCamera.updateProjectionMatrix();
    rockTarget.setSize(Math.round(innerWidth * pixelRatio), Math.round(innerHeight * pixelRatio));
    landTarget.setSize(Math.round(innerWidth * pixelRatio), Math.round(innerHeight * pixelRatio));
    gardenOpticTarget.setSize(Math.round(innerWidth * pixelRatio), Math.round(innerHeight * pixelRatio));
    compositeMaterial.uniforms.aspect.value = camera.aspect;
    compositeMaterial.uniforms.resolution.value.set(innerWidth, innerHeight);
    gardenCompositeMaterial.uniforms.aspect.value = camera.aspect;
    gardenCompositeMaterial.uniforms.resolution.value.set(innerWidth, innerHeight);
    atmosphere.resize();
    gardenAtmosphere.resize();
    heroTitle.resize();
    dust.resize(innerHeight,pixelRatio);
    gardenDust.resize(innerHeight,pixelRatio);
    gardenIntroArt?.resize();
    uniforms.renderResolution.value.set(innerWidth * pixelRatio, innerHeight * pixelRatio);
  }
  resize(); window.addEventListener('resize', resize);
  // Warm both scenes, the water reflection and postprocessing while covered.
  // The second scene's module must also be visible during shader preparation.
  await new Promise(resolve => requestAnimationFrame(resolve));
  const startingProgress = timeline.read(0, media.matches);
  const startingPose = getPose(startingProgress, media.matches, sceneSettings.gardenCamera);
  const gardenPose = getPose(1, media.matches, sceneSettings.gardenCamera);
  camera.position.copy(startingPose.introPosition); camera.lookAt(startingPose.introTarget); camera.updateMatrixWorld();
  landCamera.position.copy(gardenPose.landPosition); landCamera.lookAt(gardenPose.landTarget);
  landCamera.fov = Math.min(110, gardenPose.landFov * framing.gardenFovScale); landCamera.updateProjectionMatrix(); landCamera.updateMatrixWorld();
  rocks.update(0, startingPose.rockTurn, media.matches);
  landscape.update(0, 1, true);
  heroLighting.update(0, camera); gardenLighting.update(0, landCamera);
  await renderer.compileAsync(introScene, camera);
  preloader.progress(86);
  await renderer.compileAsync(landScene, landCamera);
  preloader.progress(92);
  await renderer.compileAsync(gardenCompositeScene, compositeCamera);
  await renderer.compileAsync(compositeScene, compositeCamera);
  renderer.setRenderTarget(rockTarget); renderer.render(introScene, camera);
  renderer.setRenderTarget(landTarget); renderer.render(landScene, landCamera);
  renderer.setRenderTarget(gardenOpticTarget); renderer.render(gardenCompositeScene, compositeCamera);
  renderer.setRenderTarget(null);
  landscape.update(0, startingProgress, media.matches || ambientPaused);
  preloader.progress(98);
  const pointer = new THREE.Vector2(), ray = new THREE.Raycaster();
  const rockInteraction={pointer:new THREE.Vector2(),presence:0,strength:1};
  const dustPointer=new THREE.Vector2();
  let pointerInside = false;
  window.addEventListener('pointermove', event => {
    if (event.target instanceof Element && event.target.closest('[data-scene-controls],.site-header,dialog')) {
      pointerInside = false;
      return;
    }
    pointer.set(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2);
    uniforms.pointerScreen.value.set(event.clientX / innerWidth, 1 - event.clientY / innerHeight);
    pointerInside = true;
  }, { passive: true });
  const resetTouch = event => { if (event.pointerType === 'touch') pointerInside = false; };
  window.addEventListener('pointerup', resetTouch, { passive: true });
  window.addEventListener('pointercancel', () => pointerInside = false, { passive: true });
  document.addEventListener('pointerleave', () => pointerInside = false);
  window.addEventListener('blur',()=>pointerInside=false);
  let last = performance.now(), elapsed = 0, rendered = false, average = 16, frames = 0, visible = !document.hidden;
  let controlsScene = 'hero';
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; last = performance.now(); });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); renderer.setAnimationLoop(null); fallback('Graphics context lost'); });

  renderer.setAnimationLoop(now => {
    if (!visible) return;
    const frameMs = now - last, dt = Math.min(.05, frameMs / 1000); last = now;
    if (!ambientPaused) elapsed += dt;
    const progress = timeline.read(dt, media.matches);
    const pose = getPose(progress, media.matches, sceneSettings.gardenCamera);
    heroTitle.update(1-range(.035,.19,progress), ambientPaused);
    camera.position.copy(pose.introPosition); camera.lookAt(pose.introTarget);
    landCamera.position.copy(pose.landPosition); landCamera.lookAt(pose.landTarget);
    const landFov=Math.min(110,pose.landFov*(1+(framing.gardenFovScale-1)*range(.55,.88,progress)));
    if (landCamera.fov !== landFov) { landCamera.fov = landFov; landCamera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(); landCamera.updateMatrixWorld();
    heroLighting.update(elapsed, camera);
    gardenLighting.update(elapsed, landCamera);
    uniforms.time.value = elapsed;
    if(!ambientPaused){
      const follow=1-Math.exp(-dt*4.5);
      rockInteraction.pointer.lerp(pointer,follow);
      rockInteraction.presence+=((pointerInside?1:0)-rockInteraction.presence)*follow;
    }
    rockInteraction.strength=1-range(.08,.27,progress);
    rocks.update(elapsed, pose.rockTurn, media.matches,rockInteraction);
    dustPointer.copy(rockInteraction.pointer).multiplyScalar(rockInteraction.presence*rockInteraction.strength);
    dust.update(elapsed,camera,media.matches?null:dustPointer);
    gardenDust.update(elapsed,landCamera,media.matches?null:dustPointer);
    gardenPanelPointer.copy(rockInteraction.pointer).multiplyScalar(rockInteraction.presence * range(.455, .55, progress));
    landscape.update(elapsed,progress,media.matches || ambientPaused,gardenPanelPointer);
    if (pointerInside) {
      ray.setFromCamera(pointer, progress < .4 ? camera : landCamera);
      uniforms.pointerRayOrigin.value.copy(ray.ray.origin);
      uniforms.pointerRayDirection.value.copy(ray.ray.direction);
    }
    uniforms.pointerPresence.value += ((pointerInside ? 1 : 0) - uniforms.pointerPresence.value) * Math.min(1, dt * 5);
    if (pose.aperture < 1) { renderer.setRenderTarget(rockTarget); renderer.render(introScene, camera); }
    if (pose.aperture > 0) {
      renderer.setRenderTarget(landTarget); renderer.render(landScene, landCamera);
      gardenCompositeMaterial.updateTime(elapsed);
      renderer.setRenderTarget(gardenOpticTarget); renderer.render(gardenCompositeScene, compositeCamera);
    }
    compositeMaterial.uniforms.progress.value = pose.aperture;
    compositeMaterial.updateTime(elapsed);
    renderer.setRenderTarget(null); renderer.render(compositeScene, compositeCamera);
    updateUI(progress);
    gardenIntroReveal.update(progress, media.matches || ambientPaused);
    gardenIntroArt?.update(elapsed, !ui.gardenIntro.inert, media.matches || ambientPaused);
    const footerTop = document.querySelector('#closing').getBoundingClientRect().top;
    const cameraFinish = Math.max(sceneSettings.gardenCamera.moveStart, sceneSettings.gardenCamera.moveEnd) / 100;
    solarSpecs.update(progress, innerWidth, innerHeight, progress >= .455 && footerTop > 90, cameraFinish);
    document.body.classList.toggle('garden-active', progress > .455 && footerTop > 90);
    document.body.classList.toggle('hero-active', progress < .30);
    const nextControlsScene = progress >= .455 ? 'garden' : 'hero';
    if (nextControlsScene !== controlsScene) {
      controlsScene = nextControlsScene;
      sceneControls.setScene(controlsScene);
    }
    sceneControls.setVisible((progress < .30 || progress >= .455) && footerTop >= innerHeight - 1);
    if (!rendered) { preloader.finish(); rendered = true; }
    if (frames++ > 90 && frameMs < 250) {
      average += (frameMs - average) * .025;
      if (frames % 180 === 0 && average > 29 && pixelRatio > 1.05) { pixelRatio = Math.max(1, pixelRatio - .20); resize(); }
    }
    // Read-only diagnostics for the manual desktop review.
    window.__VERDA__ = { progress, aperture: pose.aperture, rockCount: 1+rocks.satellites.length, plantedRockCount: rocks.decorations.plantedRockCount, meanFrameMs: average, pixelRatio, sceneReady: rendered, garden: true, panelHeight: landscape.panelRig.position.y };
  });
}

if (new URLSearchParams(location.search).get('view') === 'static') {
  fallback('Static edition selected');
  document.querySelector('#fallback-note').textContent = 'You are exploring the static edition.';
} else {
  init().catch(error => { console.error(error); fallback(error.message); });
}
