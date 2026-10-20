import assert from 'node:assert/strict';
import { createCardTilt } from '../src/card-tilt.js';

class Events {
  listeners = new Map();
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, values = {}) { for (const fn of this.listeners.get(type) || []) fn({ type, ...values }); }
  get count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}

function fixture() {
  const view = new Events(), fine = new Events();
  fine.matches = true;
  view.matchMedia = () => fine;
  const doc = new Events();
  doc.defaultView = view;
  doc.hidden = false;
  const cards = [false, true].map(solar => {
    const card = new Events(), properties = new Map();
    card.style = {
      setProperty(name, value, priority = '') { properties.set(name, [value, priority]); },
      getPropertyValue: name => properties.get(name)?.[0] || '',
      getPropertyPriority: name => properties.get(name)?.[1] || '',
      removeProperty: name => properties.delete(name),
    };
    card.style.transform = solar ? 'translate(-50%, -50%)' : 'translateY(22px)';
    card.matches = () => solar;
    card.closest = () => card.inert ? {} : null;
    card.isConnected = true;
    card.offsetWidth = 200;
    card.offsetHeight = 100;
    card.rect = { left: 100, top: 100, width: 200, height: 100 };
    card.reads = 0;
    card.getBoundingClientRect = () => { card.reads++; return card.rect; };
    return card;
  });
  doc.querySelectorAll = () => cards;
  const tilt = createCardTilt(doc);
  return { view, fine, doc, cards, tilt };
}

const test = fixture();
const [arrival, solar] = test.cards;
const position = { pointerType: 'mouse', clientX: 300, clientY: 100 };
arrival.emit('pointerenter', position);
test.tilt.update(1 / 60);
const first = parseFloat(arrival.style.getPropertyValue('--card-tilt-x'));
assert(first > 0 && first < 10, 'The card eases towards its pointer target');
for (let i = 0; i < 120; i++) test.tilt.update(1 / 60);
assert.equal(arrival.style.getPropertyValue('--card-tilt-x'), '10.000deg');
assert.equal(arrival.style.getPropertyValue('--card-tilt-y'), '10.000deg');
assert.equal(arrival.style.transform, 'translateY(22px)', 'Reveal transforms remain untouched');

arrival.rect = { left: 135, top: 80, width: 180, height: 95 };
arrival.emit('pointermove', { ...position, clientX: 100, clientY: 200 });
for (let i = 0; i < 120; i++) test.tilt.update(1 / 60);
assert.equal(arrival.reads, 1, 'Rotated bounds do not feed back into cursor tracking');
assert.equal(arrival.style.getPropertyValue('--card-tilt-x'), '-10.000deg');
assert.equal(arrival.style.getPropertyValue('--card-tilt-y'), '-10.000deg');

arrival.emit('pointerleave');
for (let i = 0; i < 120; i++) test.tilt.update(1 / 60);
assert.equal(arrival.style.getPropertyValue('--card-tilt-x'), '', 'Neutral cards release their tilt inputs');
solar.emit('pointermove', position);
for (let i = 0; i < 120; i++) test.tilt.update(1 / 60);
assert.equal(solar.style.getPropertyValue('--card-tilt-y'), '7.000deg');
assert.equal(solar.style.transform, 'translate(-50%, -50%)', 'Solar anchor transforms remain untouched');
test.view.emit('scroll');
assert.equal(solar.style.getPropertyValue('--card-tilt-y'), '', 'Scrolling releases tilt before the solar anchor moves');
solar.emit('pointermove', position);
test.tilt.update(1 / 60);
assert.equal(solar.reads, 2, 'A move after scrolling reacquires bounds without needing pointerenter');

solar.inert = true;
test.tilt.update(1 / 60);
assert.equal(solar.style.getPropertyValue('--card-tilt-y'), '', 'Leaving a scene immediately neutralizes its cards');
solar.inert = false;
solar.emit('pointermove', position);
test.tilt.update(1 / 60, true);
assert.equal(solar.style.getPropertyValue('--card-tilt-y'), '', 'Reduced motion cancels an existing hover');
solar.emit('pointermove', position);
test.tilt.update(1 / 60, false);
assert.equal(solar.style.getPropertyValue('--card-tilt-y'), '', 'Motion does not resume without a fresh cursor move');
solar.emit('pointermove', { ...position, pointerType: 'touch' });
test.tilt.update(1 / 60);
assert.equal(solar.style.getPropertyValue('--card-tilt-y'), '', 'Touch interaction never starts tilt');

test.fine.matches = false;
test.fine.emit('change');
arrival.emit('pointermove', position);
test.tilt.update(1 / 60);
assert.equal(arrival.style.getPropertyValue('--card-tilt-x'), '', 'Coarse pointers retain the static composition');
test.fine.matches = true;
arrival.emit('pointermove', position);
test.tilt.update(1 / 60);
test.view.emit('blur');
assert.equal(arrival.style.getPropertyValue('--card-tilt-x'), '');

test.tilt.dispose(); test.tilt.dispose();
assert.equal([...test.cards, test.view, test.doc, test.fine].reduce((sum, item) => sum + item.count, 0), 0, 'Disposal removes every listener exactly once');
test.tilt.update(1 / 60);
const original = fixture();
original.tilt.dispose();
original.cards[0].style.setProperty('--card-tilt-x', '2deg', 'important');
const restored = createCardTilt(original.doc);
original.cards[0].emit('pointermove', position);
restored.update(.1);
restored.dispose();
assert.equal(original.cards[0].style.getPropertyValue('--card-tilt-x'), '2deg');
assert.equal(original.cards[0].style.getPropertyPriority('--card-tilt-x'), 'important');

createCardTilt({}).dispose();
console.log('Card tilt passed: independent axes, damping, stable hover bounds, reveal/anchor preservation, scroll/reduced/touch resets and listener cleanup');
