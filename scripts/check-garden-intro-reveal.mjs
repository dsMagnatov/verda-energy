import assert from 'node:assert/strict';
import { createGardenIntroReveal } from '../src/garden-intro-reveal.js';

// Finished promises are lazy, as in WAAPI. A queued completion can outlive
// cancel(), which is the important race when scrolling between visits.
class Animation {
  constructor(frames, options) { this.frames = frames; this.options = options; this.state = 'pending'; this.cancellations = 0; }
  get finished() {
    return this.promise ??= new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  }
  finish() { if (this.state === 'pending') { this.state = 'finished'; this.resolve?.(this); } }
  cancel() {
    this.cancellations++;
    if (this.state === 'pending') { this.state = 'cancelled'; this.reject?.(new Error('Cancelled')); }
  }
}

function element() {
  const classes = new Set();
  return {
    dataset: {}, inert: false, animations: [], selectors: new Map(),
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
    querySelector(selector) { return this.selectors.get(selector) ?? null; },
    querySelectorAll() { return []; },
    getTotalLength() { return 260; },
    animate(frames, options) { const animation = new Animation(frames, options); this.animations.push(animation); return animation; },
  };
}

function fixture() {
  const root = element();
  for (const selector of ['.garden-intro-heading', '.garden-intro-main', '.garden-intro-art', '.garden-intro-left', '.garden-intro-left-inset', '.garden-intro-right', '.garden-intro-main-title', '.garden-intro-right button', '.garden-intro-description']) root.selectors.set(selector, element());
  const metrics = [element(), element()];
  for (const metric of metrics) {
    metric.selectors.set('.garden-intro-metric-label', element());
    metric.selectors.set('.garden-intro-chart', element());
    metric.selectors.set('.garden-intro-chart path:last-child', element());
  }
  root.querySelectorAll = selector => selector === '.garden-intro-metric' ? metrics : [];
  const items = [...root.selectors.values(), ...metrics.flatMap(metric => [...metric.selectors.values()])];
  const button = root.querySelector('.garden-intro-right button');
  return { root, button, items, reveal: createGardenIntroReveal(root), animations: () => items.flatMap(item => item.animations) };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

const visit = fixture();
assert(visit.root.classList.contains('arrival-motion-ready'));
assert(visit.button.inert, 'An unrevealed CTA cannot receive focus');
visit.reveal.update(.42); visit.reveal.update(.43);
assert.equal(visit.animations().length, 0, 'The preceding screen does not start the entrance');
visit.reveal.update(.435);
const entrance = visit.animations();
assert.equal(entrance.length, visit.items.length);
assert(new Set(entrance.map(animation => animation.options.delay)).size >= 8, 'The composition has distinct entrance timings');
for (let frame = 0; frame < 180; frame++) visit.reveal.update(.52);
assert.equal(visit.animations().length, entrance.length, 'Pausing scroll never restarts time-based entrances');
for (const animation of entrance) assert.equal(animation.options.fill, 'backwards', 'Completed opacity/transforms do not retain a backdrop root');
entrance.filter(animation => animation !== visit.button.animations[0]).forEach(animation => animation.finish());
await flush();
assert(visit.button.inert, 'Other cards completing cannot prematurely enable the CTA');
visit.button.animations[0].finish(); await flush();
assert.equal(visit.button.inert, false);
visit.reveal.update(.425);
assert(entrance.every(animation => animation.cancellations === 1));
assert(!Object.hasOwn(visit.root.dataset, 'arrivalVisible'));
assert(visit.button.inert);
visit.reveal.update(.60);
assert.equal(visit.animations().length, entrance.length * 2, 'Reverse scrolling into the interval creates a fresh visit');
visit.reveal.update(.9);
assert(visit.animations().slice(entrance.length).every(animation => animation.cancellations === 1), 'Skipping onward cancels pending entrance work');

const race = fixture();
race.reveal.update(.52);
race.button.animations[0].finish(); // The completion callback is queued.
race.reveal.update(.70); race.reveal.update(.52);
await flush();
assert(race.button.inert, 'A stale finished callback cannot unlock the next visit');
race.button.animations[1].finish(); await flush();
assert.equal(race.button.inert, false);
race.reveal.dispose(); await flush();

const reduced = fixture();
reduced.reveal.update(.52, true);
assert.equal(reduced.animations().length, 0);
assert.equal(reduced.button.inert, false, 'Reduced motion shows all content immediately');
reduced.reveal.update(.2); reduced.reveal.update(.52);
assert(reduced.button.inert);
const interrupted = reduced.animations();
reduced.reveal.update(.52, true); await flush();
assert(interrupted.every(animation => animation.cancellations === 1));
assert.equal(reduced.button.inert, false, 'Enabling reduced motion mid-entrance cancels delays');
reduced.reveal.update(.52, false);
assert.equal(reduced.animations().length, interrupted.length, 'Returning to normal motion does not replay the current visit');
reduced.reveal.dispose(); await flush();

const fallback = fixture();
fallback.reveal.update(.52); fallback.reveal.showStatic(); await flush();
assert(!fallback.root.classList.contains('arrival-motion-ready'));
assert.equal(fallback.button.inert, false, 'WebGL fallback keeps its static contact button usable');
const before = fallback.animations().length;
fallback.reveal.update(.1); fallback.reveal.update(.52);
assert.equal(fallback.animations().length, before, 'Static fallback never starts hidden animations');
fallback.reveal.dispose(); fallback.reveal.dispose();
assert(fallback.items.every(item => !Object.hasOwn(item.dataset, 'arrivalItem')));
assert(fallback.animations().every(animation => animation.cancellations === 1), 'Repeated disposal does not cancel resources twice');
visit.reveal.dispose(); await flush();
createGardenIntroReveal(null).update(.52);
createGardenIntroReveal({}).showStatic();
console.log('Garden arrival reveal passed: staggered timings, paused/reverse/skip visits, CTA completion races, reduced motion and static fallback');
