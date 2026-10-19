import assert from 'node:assert/strict';
import { createPreloader } from '../src/preloader.js';

const originals = Object.fromEntries(['requestAnimationFrame', 'setTimeout', 'matchMedia'].map(key => [key, globalThis[key]]));
let frames = [], timers = [], reduced = false;
globalThis.requestAnimationFrame = callback => frames.push(callback);
globalThis.setTimeout = (callback, delay) => timers.push({ callback, delay });
globalThis.matchMedia = () => ({ matches: reduced });
function element() {
  const attributes = new Map(), classes = new Set();
  return { attributes, classes, style: {}, inert: true, hidden: false,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key), hasAttribute: key => attributes.has(key),
    addEventListener(type, callback) { this[type] = callback; },
  };
}
function fixture() {
  const layer = element(), bar = element(), fill = element(), counter = element();
  const header = element(), main = element(), html = element();
  html.classes.add('is-loading'); main.setAttribute('aria-busy', 'true');
  layer.querySelector = selector => ({ '[role="progressbar"]': bar, '.preloader__fill': fill, '#load-percent': counter })[selector];
  const loader = createPreloader({ querySelector: () => layer, querySelectorAll: () => [header, main], documentElement: html });
  return { loader, layer, bar, fill, counter, header, main, html };
}
try {
  const scene = fixture();
  scene.loader.progress(40); scene.loader.progress(12); scene.loader.progress(NaN);
  assert.equal(scene.counter.textContent, '40%', 'Dynamic asset discovery never moves progress backwards');
  scene.loader.progress(150);
  assert.equal(scene.bar.attributes.get('aria-valuenow'), '99', 'Only a rendered scene can complete progress');
  scene.loader.finish(); scene.loader.finish(); scene.loader.progress(25);
  assert.equal(scene.counter.textContent, '100%');
  assert.equal(frames.length, 1, 'Completion is idempotent');
  frames.shift()();
  assert(scene.main.inert && scene.html.classes.has('is-loading'), 'Content stays blocked until the completed frame can be presented');
  frames.shift()();
  assert(scene.layer.classes.has('ready') && !scene.header.inert && !scene.main.inert);
  assert.equal(scene.main.attributes.get('aria-busy'), 'false');
  assert(!scene.html.classes.has('is-loading'), 'Scroll unlocks after the first scene');
  scene.layer.transitionend({ target: scene.layer, propertyName: 'opacity' });
  assert(scene.layer.hidden, 'The faded overlay leaves the accessibility tree');
  assert.equal(timers.pop().delay, 650, 'A missing transition event cannot leave the overlay mounted');

  reduced = true;
  const fallback = fixture(); fallback.loader.progress(4); fallback.loader.finish(false);
  frames.shift()(); frames.shift()();
  assert.equal(fallback.counter.textContent, '4%', 'Static fallback does not claim assets loaded');
  assert(!fallback.main.inert && !fallback.html.classes.has('is-loading'), 'Fallback never traps navigation or scroll');
  const immediate = timers.pop(); assert.equal(immediate.delay, 0); immediate.callback();
  assert(fallback.layer.hidden, 'Reduced motion skips the exit fade');
  console.log('Preloader checks passed: real completion gate, monotonic progress, focus/scroll release, fallback and reduced motion');
} finally {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}
