export const COMPACT_QUERY = '(max-width: 900px)';

/** Fit the hero's horizontal composition without changing any saved controls. */
export function getSceneFraming(width, height, deviceRatio = 1) {
  const compact = width <= 900;
  const aspect = Math.max(.2, width / Math.max(1, height));
  const heroFov = compact
    ? Math.min(82, Math.atan(Math.tan(43 * Math.PI / 360) * Math.max(1, .85 / aspect)) * 360 / Math.PI)
    : 43;
  const gardenFovScale=compact && aspect<1 ? 1+.25*Math.max(0,Math.min(1,(780-height)/140)) : 1;
  return { compact, heroFov, gardenFovScale, pixelRatio: Math.min(deviceRatio, compact ? 1.25 : 1.65) };
}

export function createMobileNavigation() {
  const media = matchMedia(COMPACT_QUERY);
  const button = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#main-navigation');
  const header = document.querySelector('.site-header');
  let open = false;
  function setOpen(value, restoreFocus = false) {
    open = media.matches && value;
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? 'Close' : 'Menu';
    document.body.classList.toggle('menu-open', open);
    nav.inert = media.matches && !open;
    if (restoreFocus) button.focus();
  }
  button.addEventListener('click', () => setOpen(!open));
  nav.addEventListener('click', event => {
    if (event.target.closest('a,button')) setOpen(false);
  });
  document.addEventListener('click', event => {
    if (open && !header.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) setOpen(false, true);
    if (event.key === 'Tab' && open) {
      const items = [button, ...nav.querySelectorAll('a,button')];
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault(); items.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault(); button.focus();
      }
    }
  });
  media.addEventListener('change', () => setOpen(false));
  setOpen(false);
}
