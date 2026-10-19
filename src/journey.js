import * as THREE from 'three';
import { smoothstep } from './verdant/math.js';
import { createDefaultSceneSettings, getSceneControlLimits } from './scene-settings.js';

export const clamp = value => Math.max(0, Math.min(1, value));
export const range = (a, b, value) => smoothstep(a, b, value);
// The original 700vh camera journey is followed by 210vh for the panel cards.
// Keep this in sync with the 1010vh .journey height (including its viewport).
export const JOURNEY_SCROLL_END = 1.3;

// One reversible timeline drives both camera poses, the organic aperture and HTML.
export function getPose(progress, reducedMotion = false, gardenCamera = {}) {
  const push = range(.12, .39, progress);
  const defaults = gardenCameraDefaults;
  const value = key => {
    const candidate = gardenCamera?.[key];
    const [minimum, maximum] = gardenCameraLimits[key];
    return Number.isFinite(candidate) ? Math.max(minimum, Math.min(maximum, candidate)) : defaults[key];
  };
  const start = Math.min(value('moveStart'), value('moveEnd')) / 100;
  const end = Math.max(start + .01, Math.max(value('moveStart'), value('moveEnd')) / 100);
  const retreat = range(start, end, progress);
  return {
    introPosition: new THREE.Vector3(.5, 1.9 - push * 1.2, 12.7 - push * 9.2),
    introTarget: new THREE.Vector3(.5, .15 + push * .3, 0),
    landPosition: new THREE.Vector3(
      value('positionX'),
      THREE.MathUtils.lerp(value('startHeight'), value('endHeight'), retreat),
      THREE.MathUtils.lerp(value('startDistance'), value('endDistance'), retreat),
    ),
    landTarget: new THREE.Vector3(0, THREE.MathUtils.lerp(.25, value('targetHeight'), retreat), value('targetZ')),
    landFov: value('fov'),
    aperture: range(.285, .455, progress),
    rockTurn: (reducedMotion ? .35 : 1) * push,
  };
}

const gardenCameraDefaults = createDefaultSceneSettings().gardenCamera;
const gardenCameraLimits = getSceneControlLimits('gardenCamera');

export function createTimeline() {
  let raw = 0, smooth = 0, scrollProgress = 0;
  const element = document.querySelector('#journey');
  let viewportWidth=window.innerWidth, journeyViewport=window.innerHeight;
  document.documentElement.style.setProperty('--journey-viewport', `${journeyViewport}px`);
  const measureDistance = () => Math.max(1, (element.offsetHeight - journeyViewport) / JOURNEY_SCROLL_END);
  let journeyDistance=measureDistance();
  const scrollDistance = () => journeyDistance;
  const updateRaw = () => {
    scrollProgress = Math.max(0, window.scrollY / scrollDistance());
    raw = Math.min(JOURNEY_SCROLL_END, scrollProgress);
  };
  window.addEventListener('scroll', updateRaw, { passive: true });
  window.addEventListener('resize', () => {
    // Mobile browser chrome and the keyboard must not change story progress.
    if (window.innerWidth>900 || Math.abs(window.innerWidth-viewportWidth)>2) {
      const progress=scrollProgress;
      viewportWidth=window.innerWidth;journeyViewport=window.innerHeight;
      document.documentElement.style.setProperty('--journey-viewport', `${journeyViewport}px`);
      journeyDistance=measureDistance();
      window.scrollTo({top:progress*scrollDistance(),behavior:'instant'});
    }
    updateRaw();
  });
  updateRaw(); smooth = raw;
  return {
    read(dt, reducedMotion) {
      smooth += (raw - smooth) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 7));
      if (Math.abs(raw - smooth) < .000015) smooth = raw;
      return smooth;
    },
    jump(progress) {
      const y = Math.max(0, Math.min(JOURNEY_SCROLL_END, progress)) * scrollDistance();
      window.scrollTo({ top: y, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    },
  };
}
