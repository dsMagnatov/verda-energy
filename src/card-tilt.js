const SELECTOR = '.garden-intro-main, .garden-intro-left, .garden-intro-right, .solar-spec-card';
const PROPERTIES = ['--card-tilt-x', '--card-tilt-y'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// CSS owns both the entrance transforms and the solar cards' panel anchors.
// Only two independent tilt inputs are written here, from the existing RAF.
export function createCardTilt(root = document) {
  const doc = root.ownerDocument || root;
  const view = doc.defaultView;
  if (!view?.matchMedia || !root.querySelectorAll) return { update() {}, resize() {}, dispose() {} };

  const finePointer = view.matchMedia('(hover: hover) and (pointer: fine)');
  const cards = [...root.querySelectorAll(SELECTOR)].map(element => ({
    element, maximum: element.matches('.solar-spec-card') ? 7 : 10,
    x: 0, y: 0, targetX: 0, targetY: 0, bounds: null, written: false,
    original: PROPERTIES.map(name => [element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]),
    lastX: '', lastY: '',
  }));
  const listeners = [];
  let active = null;
  let paused = false;
  let disposed = false;

  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    listeners.push(() => target.removeEventListener(type, listener, options));
  }

  function restore(card) {
    if (card.written) {
      PROPERTIES.forEach((name, index) => {
        const [value, priority] = card.original[index];
        if (value) card.element.style.setProperty(name, value, priority);
        else card.element.style.removeProperty(name);
      });
    }
    card.written = false;
    card.lastX = card.lastY = '';
  }

  function reset() {
    active = null;
    for (const card of cards) {
      card.x = card.y = card.targetX = card.targetY = 0;
      card.bounds = null;
      restore(card);
    }
  }

  const available = card => finePointer.matches && !paused && !doc.hidden &&
    !card.element.closest('[inert], [hidden]') && card.element.isConnected;

  function pointer(card, event) {
    if (disposed || event.pointerType === 'touch' || event.isPrimary === false || !available(card)) return;
    if (active !== card) {
      if (active) active.targetX = active.targetY = 0;
      active = card;
      // Read geometry once per hover. Re-reading the rotated rectangle on each
      // move would feed the tilt back into its own cursor coordinates.
      const rect = card.element.getBoundingClientRect();
      const width = card.element.offsetWidth || rect.width;
      const height = card.element.offsetHeight || rect.height;
      if (!width || !height) { active = null; return; }
      card.bounds = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width, height };
    }
    const { x, y, width, height } = card.bounds;
    card.targetX = -clamp((event.clientY - y) / (height / 2), -1, 1) * card.maximum;
    card.targetY = clamp((event.clientX - x) / (width / 2), -1, 1) * card.maximum;
  }

  for (const card of cards) {
    const move = event => pointer(card, event);
    const leave = () => {
      if (active === card) active = null;
      card.targetX = card.targetY = 0;
      card.bounds = null;
    };
    listen(card.element, 'pointerenter', move, { passive: true });
    listen(card.element, 'pointermove', move, { passive: true });
    listen(card.element, 'pointerleave', leave, { passive: true });
    listen(card.element, 'pointercancel', leave, { passive: true });
  }
  listen(view, 'blur', reset);
  // A scroll can move a solar anchor without another pointerenter. Resetting
  // also keeps the next visit neutral; its next pointermove reacquires bounds.
  listen(view, 'scroll', reset, { capture: true, passive: true });
  listen(view, 'resize', reset, { passive: true });
  listen(doc, 'visibilitychange', reset);
  listen(finePointer, 'change', reset);

  function update(delta = 1 / 60, reducedMotion = false) {
    if (disposed) return;
    paused = reducedMotion;
    if (paused || !finePointer.matches || doc.hidden) { reset(); return; }
    const damping = 1 - Math.exp(-14 * clamp(Number.isFinite(delta) ? delta : 1 / 60, 0, .1));
    for (const card of cards) {
      if (!available(card)) {
        if (active === card) active = null;
        card.x = card.y = card.targetX = card.targetY = 0;
        card.bounds = null;
        restore(card);
        continue;
      }
      if (!card.written && !card.targetX && !card.targetY) continue;
      card.x += (card.targetX - card.x) * damping;
      card.y += (card.targetY - card.y) * damping;
      if (!card.targetX && !card.targetY && Math.abs(card.x) + Math.abs(card.y) < .01) {
        card.x = card.y = 0;
        restore(card);
        continue;
      }
      const x = `${card.x.toFixed(3)}deg`, y = `${card.y.toFixed(3)}deg`;
      if (x !== card.lastX) card.element.style.setProperty(PROPERTIES[0], x);
      if (y !== card.lastY) card.element.style.setProperty(PROPERTIES[1], y);
      card.lastX = x; card.lastY = y;
      card.written = true;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    reset();
    listeners.forEach(remove => remove());
  }

  return { update, resize: reset, dispose };
}
