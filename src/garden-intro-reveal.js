const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const TILT_CARDS = new Set(['.garden-intro-main', '.garden-intro-left', '.garden-intro-right']);

// Time-based entrances continue when scrolling stops. Scroll still owns the
// whole section's exit, so a fast skip never delays the next scene.
export function createGardenIntroReveal(root) {
  if (!root || typeof root.animate !== 'function') {
    return { update() {}, showStatic() {}, dispose() {} };
  }

  const items = [];
  const add = (selector, delay, duration, transform, scope = root) => {
    const element = scope.querySelector(selector);
    if (!element) return;
    element.dataset.arrivalItem = '';
    items.push({ element, delay, duration, additiveTransform: TILT_CARDS.has(selector), frames: [
      { opacity: 0, transform }, { opacity: 1, transform: 'none' },
    ] });
  };
  add('.garden-intro-heading', 0, 820, 'translateY(24px)');
  add('.garden-intro-main', 130, 960, 'translateY(48px)');
  add('.garden-intro-art', 310, 1100, 'translateY(26px)');
  add('.garden-intro-left', 430, 820, 'translateX(-44px) rotate(-3deg)');
  add('.garden-intro-left-inset', 650, 680, 'translateY(16px)');
  add('.garden-intro-right', 630, 880, 'translateX(44px) rotate(3deg)');
  add('.garden-intro-main-title', 740, 660, 'translateY(16px)');
  root.querySelectorAll('.garden-intro-metric').forEach((metric, index) => {
    add('.garden-intro-metric-label', 860 + index * 220, 680, 'translateY(12px)', metric);
    add('.garden-intro-chart', 900 + index * 240, 600, 'translateY(8px)', metric);
    const line = metric.querySelector('.garden-intro-chart path:last-child');
    if (!line) return;
    const length = line.getTotalLength();
    line.dataset.arrivalItem = '';
    items.push({ element: line, delay: 950 + index * 240, duration: 1000, frames: [
      { opacity: 1, strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
      { opacity: 1, strokeDasharray: `${length}`, strokeDashoffset: '0' },
    ] });
  });
  add('.garden-intro-right button', 1200, 650, 'translateY(12px)');
  add('.garden-intro-description', 1330, 800, 'translateY(18px)');

  const button = root.querySelector('.garden-intro-right button');
  let animations = [];
  let entered = false;
  let staticMode = false;
  let disposed = false;
  let visit = 0;
  root.classList.add('arrival-motion-ready');
  if (button) button.inert = true;

  function cancel() {
    visit++;
    for (const animation of animations) animation.cancel();
    animations = [];
  }

  function enter() {
    entered = true;
    root.dataset.arrivalVisible = '';
    const currentVisit = ++visit;
    for (const item of items) {
      // Backwards fill hides each item during its own delay, then releases
      // every transform/opacity effect on finish. Persistent parent effects
      // would interfere with the cards' live backdrop blur.
      const options = { delay: item.delay, duration: item.duration, easing: EASE, fill: 'backwards' };
      // Only the entrance displacement adds to the live perspective tilt.
      // Opacity remains a replacement effect, so delayed cards stay hidden.
      const frames = item.additiveTransform ? item.frames.map(({ opacity }) => ({ opacity })) : item.frames;
      const animation = item.element.animate(frames, options);
      animations.push(animation);
      if (item.additiveTransform) animations.push(item.element.animate(
        item.frames.map(({ transform }) => ({ transform })), { ...options, composite: 'add' },
      ));
      if (item.element === button) {
        animation.finished.then(() => {
          if (!disposed && entered && visit === currentVisit) button.inert = false;
        }).catch(() => {});
      }
    }
  }

  function update(progress, reducedMotion = false) {
    if (disposed || staticMode || !Number.isFinite(progress)) return;
    if (progress <= .425 || progress >= .70) {
      if (entered) {
        cancel();
        entered = false;
        delete root.dataset.arrivalVisible;
        if (button) button.inert = true;
      }
      return;
    }
    if (reducedMotion) {
      if (animations.length) cancel();
      entered = true;
      root.dataset.arrivalVisible = '';
      if (button) button.inert = false;
    } else if (!entered && progress >= .435) {
      enter();
    }
  }

  function showStatic() {
    cancel();
    staticMode = true;
    root.classList.remove('arrival-motion-ready');
    delete root.dataset.arrivalVisible;
    if (button) button.inert = false;
  }

  function dispose() {
    if (disposed) return;
    showStatic();
    disposed = true;
    for (const { element } of items) delete element.dataset.arrivalItem;
  }

  return { update, showStatic, dispose };
}
