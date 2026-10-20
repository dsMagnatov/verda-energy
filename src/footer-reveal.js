// The native sticky footer first pauses with only its contact strip visible.
// Its parent's bottom edge then pushes the rest into view. Measuring intrinsic
// content keeps that reveal valid across fonts, orientation and form feedback.
export function createFooterReveal(footer) {
  const wrapper = footer?.parentElement;
  if (!wrapper) return { dispose() {} };
  let disposed = false;
  let lastHeight = 0;
  let lastPeek = 0;
  const contact = footer.querySelector('.closing-top');
  function measure() {
    if (disposed) return;
    const height = Math.ceil(footer.getBoundingClientRect().height);
    if (height > 0 && height !== lastHeight) {
      wrapper.style.setProperty('--footer-total-height', `${height}px`);
      lastHeight = height;
    }
    const peek = Math.ceil(contact?.getBoundingClientRect().height || 0);
    if (peek > 0 && peek !== lastPeek) {
      wrapper.style.setProperty('--footer-peek-offset', `${peek}px`);
      lastPeek = peek;
    }
  }
  const observer = new ResizeObserver(measure);
  observer.observe(footer);
  if (contact) observer.observe(contact);
  document.fonts.ready.then(measure);
  measure();
  return { dispose() { disposed = true; observer.disconnect(); } };
}
