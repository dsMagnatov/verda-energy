/** The overlay is present in the initial HTML, before the application loads. */
export function createPreloader(root = document) {
  const layer = root.querySelector('#load-status');
  const bar = layer.querySelector('[role="progressbar"]');
  const fill = layer.querySelector('.preloader__fill');
  const counter = layer.querySelector('#load-percent');
  const content = [...root.querySelectorAll('[data-preloader-inert]')];
  let value = 0, finishing = false;
  function paint(next) {
    value = Math.max(value, next);
    counter.textContent = `${value}%`;
    bar.setAttribute('aria-valuenow', String(value));
    fill.style.transform = `scaleX(${value / 100})`;
  }
  return {
    progress(next) {
      if (!finishing && Number.isFinite(next)) paint(Math.max(0, Math.min(99, Math.round(next))));
    },
    finish(complete = true) {
      if (finishing) return;
      finishing = true;
      if (complete) paint(100);
      // Present the completed scene before beginning the overlay's fade.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        layer.classList.add('ready');
        layer.setAttribute('aria-hidden', 'true');
        root.documentElement.classList.remove('is-loading');
        for (const element of content) {
          element.inert = false;
          element.removeAttribute('data-preloader-inert');
          if (element.hasAttribute('aria-busy')) element.setAttribute('aria-busy', 'false');
        }
        const hide = () => { layer.hidden = true; };
        layer.addEventListener('transitionend', event => {
          if (event.target === layer && event.propertyName === 'opacity') hide();
        });
        setTimeout(hide, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650);
      }));
    },
  };
}
