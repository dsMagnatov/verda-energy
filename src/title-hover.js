import { readTitleHoverControls } from './title-hover-settings.js';

// A soft cursor lens, using ordinary DOM text and complementary CSS masks.
export function createTitleHover(element) {
  const noop = { setControls() {}, setPaused() {}, dispose() {} };
  if (!element || !CSS.supports('mask-image', 'radial-gradient(black, transparent)')) return noop;

  const sharp = document.createElement('span');
  sharp.className = 'title-hover__sharp';
  sharp.append(...element.childNodes);
  const blurred = sharp.cloneNode(true);
  blurred.className = 'title-hover__blur';
  blurred.setAttribute('aria-hidden', 'true');
  blurred.inert = true;
  const glow = sharp.cloneNode(true);
  glow.className = 'title-hover__glow';
  glow.setAttribute('aria-hidden', 'true');
  glow.inert = true;
  element.classList.add('title-hover');
  element.append(glow, sharp, blurred);

  const hero = element.closest('.hero-copy') || element;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const point = { x: 0, y: 0, amount: 0 };
  const target = { x: 0, y: 0, amount: 0 };
  let frame = 0, previousTime = 0, disposed = false;
  let paused = false;
  let controls = readTitleHoverControls();

  function available() {
    if (disposed || paused || document.hidden || reducedMotion.matches || !finePointer.matches || !element.isConnected || hero.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(hero);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > .2;
  }

  function paint() {
    const radius = Math.max(1, controls.radius);
    const values = {
      x: `${point.x.toFixed(2)}px`, y: `${point.y.toFixed(2)}px`, amount: point.amount.toFixed(4),
      'shift-x': `${(Math.sin(point.x / radius) * controls.distortion * 5 * point.amount).toFixed(3)}px`,
      'shift-y': `${(Math.cos(point.y / radius) * controls.distortion * 5 * point.amount).toFixed(3)}px`,
    };
    for (const [name, value] of Object.entries(values)) {
      const property = `--title-hover-${name}`;
      if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
    }
  }

  function setControls(values) {
    if (disposed) return;
    controls = readTitleHoverControls(values, controls);
    const properties = {
      blur: controls.blur,
      'blur-size': `${controls.blurSize}px`,
      radius: `${controls.radius}px`,
      inner: `${((1 - controls.softness) * 100).toFixed(3)}%`,
      middle: `${((1 - controls.softness * .5) * 100).toFixed(3)}%`,
      glow: controls.glow,
      'glow-size': `${controls.glowSize}px`,
      'glow-color': controls.glowColor,
    };
    for (const [name, value] of Object.entries(properties)) element.style.setProperty(`--title-hover-${name}`, value);
    paint();
  }

  function reset() {
    cancelAnimationFrame(frame);
    frame = previousTime = 0;
    point.amount = target.amount = 0;
    paint();
  }

  function tick(time) {
    frame = 0;
    if (!available()) return reset();
    const elapsed = previousTime ? Math.min(time - previousTime, 50) : 1000 / 60;
    previousTime = time;
    const ease = 1 - Math.exp(-elapsed / 1000 * controls.response);
    point.x += (target.x - point.x) * ease;
    point.y += (target.y - point.y) * ease;
    point.amount += (target.amount - point.amount) * ease;
    const settled = Math.abs(target.x - point.x) < .1 && Math.abs(target.y - point.y) < .1 && Math.abs(target.amount - point.amount) < .002;
    if (settled) Object.assign(point, target);
    paint();
    if (!settled) frame = requestAnimationFrame(tick);
    else previousTime = 0;
  }

  function animate() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function move(event) {
    if (event.pointerType === 'touch' || !available()) return reset();
    const bounds = element.getBoundingClientRect();
    target.x = event.clientX - bounds.left;
    target.y = event.clientY - bounds.top;
    if (!point.amount && !target.amount) {
      point.x = target.x;
      point.y = target.y;
    }
    target.amount = 1;
    animate();
  }

  function leave() {
    target.amount = 0;
    animate();
  }

  function checkVisibility() {
    if (!available()) reset();
  }

  const observer = new MutationObserver(checkVisibility);
  observer.observe(hero, { attributes: true, attributeFilter: ['style', 'class', 'inert', 'hidden', 'aria-hidden'] });
  if (hero !== document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'inert', 'hidden'] });
  element.addEventListener('pointerenter', move);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerleave', leave);
  element.addEventListener('pointercancel', reset);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', checkVisibility);
  reducedMotion.addEventListener('change', reset);
  finePointer.addEventListener('change', reset);
  setControls(controls);

  return {
    setControls,
    setPaused(value) {
      paused = Boolean(value);
      if (paused) reset();
    },
    get controls() { return { ...controls }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      observer.disconnect();
      element.removeEventListener('pointerenter', move);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('pointercancel', reset);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', checkVisibility);
      reducedMotion.removeEventListener('change', reset);
      finePointer.removeEventListener('change', reset);
      element.replaceChildren(...sharp.childNodes);
      element.classList.remove('title-hover');
      for (const name of ['x', 'y', 'amount', 'shift-x', 'shift-y', 'blur', 'blur-size', 'radius',
        'inner', 'middle', 'glow', 'glow-size', 'glow-color']) element.style.removeProperty(`--title-hover-${name}`);
    },
  };
}
