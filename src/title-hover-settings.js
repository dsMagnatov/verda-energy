import { SCENE_CONTROL_GROUPS } from './scene-settings.js';

// The editor, saved presets and both rendering paths share one set of limits.
export function readTitleHoverControls(values, current = {}) {
  const source = values && typeof values === 'object' ? values : {};
  const controls = SCENE_CONTROL_GROUPS.find(group => group.id === 'title')?.controls || [];
  return Object.fromEntries(controls.map(control => {
    const candidate = source[control.key] ?? current[control.key] ?? control.default;
    if (control.type === 'color') {
      return [control.key, typeof candidate === 'string' && /^#[\da-f]{6}$/i.test(candidate)
        ? candidate.toLowerCase() : control.default];
    }
    const value = typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : control.default;
    return [control.key, Math.max(control.min, Math.min(control.max, value))];
  }));
}
