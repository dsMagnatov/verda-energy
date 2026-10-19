import './scene-controls.css';
import {
  createDefaultSceneSettings, createDefaultFernInstanceSettings, sanitizeSceneSettings,
  SCENE_CONTROL_GROUPS,
} from './scene-settings.js';
import { FERN_INSTANCES, FERN_INSTANCE_CONTROL_KEYS } from './fern-instances.js';

const ENDPOINT = '/api/scene-settings';
const LEGACY_KEY = 'verda-scene-settings-v1';
let instanceCount = 0;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function requestSettings(options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(ENDPOINT, {
      credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal,
      headers: { Accept: 'application/json', ...options.headers },
    });
    if (!response.ok) {
      const error = new Error('Settings request failed');
      error.status = response.status;
      throw error;
    }
    const result = await response.json();
    if (!isRecord(result) || (result.settings !== null && !isRecord(result.settings)) ||
      (result.revision !== null && typeof result.revision !== 'string') || typeof result.canSave !== 'boolean') {
      throw new Error('Invalid settings response');
    }
    return result;
  } finally { clearTimeout(timeout); }
}

function formatValue(value, control) {
  const precision = String(control.step).split('.')[1]?.length || 0;
  return `${Number(value.toFixed(precision))}${control.unit || ''}`;
}

export async function createSceneControls({
  onChange = () => {}, onFernSelection = () => {}, onSceneSelection = () => {},
} = {}) {
  let settings = createDefaultSceneSettings();
  let revision = null;
  let canSave = false;
  let statusMessage = '';
  try {
    const published = await requestSettings();
    settings = sanitizeSceneSettings(published.settings);
    revision = published.revision;
    canSave = published.canSave;
    // An owner's old tuning is an unsaved preview only until the first shared save.
    if (published.settings === null && canSave) {
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
        if (isRecord(legacy)) settings = sanitizeSceneSettings(legacy);
      } catch { /* Missing or malformed legacy tuning never blocks shared settings. */ }
    }
    if (!canSave) statusMessage = 'Лише для власника';
  } catch { statusMessage = 'Збереження недоступне'; }

  let activeGroup = 'optics';
  let activeScene = 'hero';
  const lastActiveGroup = { hero: 'optics', garden: 'gardenPanel' };
  const sceneButtons = new Map();
  const groupScope = group => group.scope === 'garden' ? 'garden' : 'hero';
  let open = !matchMedia('(max-width: 900px)').matches;
  let visible = true;
  let busy = false;
  let disposed = false;
  let saved = false;
  let revisionConflict = false;
  let editVersion = 0;
  let selectedFern = 'all';
  let fernSelect;
  let fernReset;
  const fernTransformKeys = new Set(FERN_INSTANCE_CONTROL_KEYS);
  const fernRows = new Map();
  const prefix = `scene-controls-${++instanceCount}`;
  const listeners = [];
  const rows = new Map();
  const tabs = new Map();
  const panels = new Map();
  const editableControls = [];

  const element = document.createElement('aside');
  element.className = 'scene-controls';
  element.setAttribute('aria-label', 'Керування сценою');
  element.dataset.sceneControls = '';

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'scene-controls__launcher';
  launcher.textContent = 'Ефекти';
  launcher.setAttribute('aria-expanded', String(open));
  launcher.setAttribute('aria-controls', `${prefix}-card`);

  const card = document.createElement('div');
  card.id = `${prefix}-card`;
  card.className = 'scene-controls__card';
  const header = document.createElement('div');
  header.className = 'scene-controls__header';
  const heading = document.createElement('h2');
  heading.className = 'scene-controls__heading';
  heading.textContent = 'Сцена';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'scene-controls__close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Закрити панель');
  header.append(heading, close);

  const sceneSelector = document.createElement('div');
  sceneSelector.className = 'scene-controls__scenes';
  sceneSelector.setAttribute('role', 'group');
  sceneSelector.setAttribute('aria-label', 'Екран сцени');
  for (const [scope, label] of [['hero', 'Перший екран'], ['garden', 'Другий екран']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scene-controls__scene';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(scope === activeScene));
    sceneButtons.set(scope, button);
    editableControls.push(button);
    listen(button, 'click', () => { if (!busy) selectScene(scope, true); });
    sceneSelector.append(button);
  }

  const tablist = document.createElement('div');
  tablist.className = 'scene-controls__tabs';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Ефекти сцени');

  const content = document.createElement('div');
  content.className = 'scene-controls__content';

  const footer = document.createElement('div');
  footer.className = 'scene-controls__footer';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'scene-controls__save';
  const status = document.createElement('p');
  status.className = 'scene-controls__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  footer.append(save, status);

  function refreshSaveState() {
    save.disabled = busy || !canSave || revisionConflict;
    save.textContent = busy ? 'Збереження…' : saved ? 'Збережено' : 'Зберегти налаштування';
    status.textContent = statusMessage;
    status.hidden = !statusMessage;
    card.setAttribute('aria-busy', String(busy));
    for (const control of editableControls) control.disabled = busy;
  }

  function notifyFernSelection() {
    onFernSelection(!disposed && visible && open && activeScene === 'hero' && activeGroup === 'ferns' && selectedFern !== 'all'
      ? selectedFern : null);
  }

  function controlValues(groupId, key) {
    if (groupId === 'ferns' && selectedFern !== 'all' && fernTransformKeys.has(key)) {
      return settings.ferns.instances[selectedFern];
    }
    return settings[groupId];
  }

  function refreshFernControls() {
    for (const [key, row] of fernRows) {
      row.hidden = selectedFern !== 'all' && !fernTransformKeys.has(key);
      rows.get(`ferns.${key}`)();
    }
    if (fernReset) {
      const instance = FERN_INSTANCES.find(fern => fern.id === selectedFern);
      fernReset.textContent = instance ? 'Скинути папороть' : 'Скинути';
      fernReset.setAttribute('aria-label', `Скинути: ${instance ? instance.label : 'папороті'}`);
    }
  }

  function selectGroup(id, focus = false) {
    const group = SCENE_CONTROL_GROUPS.find(item => item.id === id);
    if (!group || groupScope(group) !== activeScene) return;
    activeGroup = id;
    lastActiveGroup[activeScene] = id;
    for (const [key, tab] of tabs) {
      const inScene = groupScope(SCENE_CONTROL_GROUPS.find(item => item.id === key)) === activeScene;
      const selected = inScene && key === activeGroup;
      tab.hidden = !inScene;
      tab.inert = !inScene;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels.get(key).hidden = !selected;
      panels.get(key).inert = !selected;
    }
    content.scrollTop = 0;
    if (focus) tabs.get(id).focus();
    notifyFernSelection();
  }

  function selectScene(scope, userInitiated = false) {
    if ((scope !== 'hero' && scope !== 'garden') || activeScene === scope) return;
    activeScene = scope;
    for (const [key, button] of sceneButtons) button.setAttribute('aria-pressed', String(key === activeScene));
    const previousGroup = lastActiveGroup[scope];
    const nextGroup = SCENE_CONTROL_GROUPS.find(group => group.id === previousGroup && groupScope(group) === scope)
      || SCENE_CONTROL_GROUPS.find(group => groupScope(group) === scope);
    if (nextGroup) selectGroup(nextGroup.id);
    if (userInitiated) onSceneSelection(scope);
  }

  function commit() {
    settings = sanitizeSceneSettings(settings);
    editVersion++;
    saved = false;
    if (canSave && !revisionConflict) statusMessage = '';
    refreshSaveState();
    onChange(settings);
  }

  for (const group of SCENE_CONTROL_GROUPS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'scene-controls__tab';
    tab.id = `${prefix}-tab-${group.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `${prefix}-panel-${group.id}`);
    tab.textContent = group.label;
    tabs.set(group.id, tab);
    tablist.append(tab);
    listen(tab, 'click', () => selectGroup(group.id));
    listen(tab, 'keydown', event => {
      const keys = SCENE_CONTROL_GROUPS.filter(item => groupScope(item) === activeScene).map(item => item.id);
      let next;
      const index = keys.indexOf(group.id);
      if (event.key === 'ArrowRight') next = keys[(index + 1) % keys.length];
      if (event.key === 'ArrowLeft') next = keys[(index + keys.length - 1) % keys.length];
      if (event.key === 'Home') next = keys[0];
      if (event.key === 'End') next = keys.at(-1);
      if (next) { event.preventDefault(); selectGroup(next, true); }
    });

    const panel = document.createElement('section');
    panel.className = 'scene-controls__panel';
    panel.id = `${prefix}-panel-${group.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panels.set(group.id, panel);

    if (group.id === 'ferns') {
      const selection = document.createElement('div');
      selection.className = 'scene-controls__selection';
      const label = document.createElement('label');
      label.htmlFor = `${prefix}-fern-instance`;
      label.textContent = 'Папороть';
      const field = document.createElement('div');
      field.className = 'scene-controls__select-field';
      fernSelect = document.createElement('select');
      fernSelect.id = label.htmlFor;
      fernSelect.className = 'scene-controls__select';
      for (const option of [{ id: 'all', label: 'Усі папороті' }, ...FERN_INSTANCES]) {
        const item = document.createElement('option');
        item.value = option.id;
        item.textContent = option.label;
        fernSelect.append(item);
      }
      fernSelect.value = selectedFern;
      editableControls.push(fernSelect);
      listen(fernSelect, 'change', () => {
        if (busy) { fernSelect.value = selectedFern; return; }
        selectedFern = fernSelect.value;
        refreshFernControls();
        notifyFernSelection();
      });
      field.append(fernSelect);
      selection.append(label, field);
      panel.append(selection);
    }

    for (const control of group.controls) {
      const id = `${prefix}-${group.id}-${control.key}`;
      const color = control.type === 'color';
      const row = document.createElement('div');
      row.className = `scene-controls__row${color ? ' scene-controls__row--color' : ''}`;
      const caption = document.createElement('div');
      caption.className = 'scene-controls__caption';
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = control.label;
      const input = document.createElement('input');
      input.type = color ? 'color' : 'range';
      input.id = id;
      input.value = String(controlValues(group.id, control.key)[control.key]);
      editableControls.push(input);
      let output;
      if (!color) {
        input.min = String(control.min);
        input.max = String(control.max);
        input.step = String(control.step);
        output = document.createElement('output');
        output.setAttribute('for', id);
      }
      const refresh = () => {
        const value = controlValues(group.id, control.key)[control.key];
        input.value = String(value);
        if (color) return;
        output.value = formatValue(value, control);
        input.style.setProperty('--range-progress', `${(value - control.min) / (control.max - control.min) * 100}%`);
        input.setAttribute('aria-valuetext', formatValue(value, control));
      };
      rows.set(`${group.id}.${control.key}`, refresh);
      if (group.id === 'ferns') fernRows.set(control.key, row);
      refresh();
      listen(input, 'input', () => {
        if (busy) { refresh(); return; }
        controlValues(group.id, control.key)[control.key] = color ? input.value : input.valueAsNumber;
        commit();
        refresh();
      });
      caption.append(label);
      if (color) { caption.append(input); row.append(caption); }
      else { caption.append(output); row.append(caption, input); }
      panel.append(row);
    }

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'scene-controls__reset';
    reset.textContent = 'Скинути';
    reset.setAttribute('aria-label', `Скинути: ${group.label.toLowerCase()}`);
    if (group.id === 'ferns') fernReset = reset;
    editableControls.push(reset);
    listen(reset, 'click', () => {
      if (busy) return;
      if (group.id === 'ferns' && selectedFern !== 'all') {
        settings.ferns.instances[selectedFern] = createDefaultFernInstanceSettings();
      } else if (group.id === 'ferns') {
        settings.ferns = { ...createDefaultSceneSettings().ferns, instances: settings.ferns.instances };
      } else {
        settings[group.id] = createDefaultSceneSettings()[group.id];
      }
      commit();
      for (const control of group.controls) rows.get(`${group.id}.${control.key}`)();
    });
    panel.append(reset);
    content.append(panel);
  }

  listen(save, 'click', async () => {
    if (busy || !canSave || revisionConflict) return;
    const snapshot = sanitizeSceneSettings(settings);
    const saveVersion = editVersion;
    busy = true;
    saved = false;
    statusMessage = '';
    refreshSaveState();
    try {
      const published = await requestSettings({
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: snapshot, revision }),
      });
      if (disposed) return;
      if (!isRecord(published.settings)) throw new Error('Saved settings are missing');
      revision = published.revision;
      canSave = published.canSave;
      if (editVersion === saveVersion) {
        settings = sanitizeSceneSettings(published.settings);
        for (const refresh of rows.values()) refresh();
        onChange(settings);
        saved = true;
      }
      try { localStorage.removeItem(LEGACY_KEY); } catch { /* Shared save already succeeded. */ }
      if (!canSave) statusMessage = 'Лише для власника';
    } catch (error) {
      if (disposed) return;
      if (error.status === 409) {
        revisionConflict = true;
        statusMessage = 'Налаштування змінились. Оновіть сторінку.';
      } else {
        if (error.status === 401 || error.status === 403) canSave = false;
        statusMessage = 'Не вдалося зберегти';
      }
    } finally {
      busy = false;
      if (!disposed) refreshSaveState();
    }
  });

  function setOpen(value, restoreFocus = false) {
    open = value;
    card.hidden = !open;
    card.inert = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (restoreFocus) launcher.focus();
    notifyFernSelection();
  }

  listen(launcher, 'click', () => {
    setOpen(!open);
    if (open) tabs.get(activeGroup).focus();
  });
  listen(close, 'click', () => setOpen(false, true));
  listen(element, 'keydown', event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  listen(element, 'pointerdown', event => event.stopPropagation());
  listen(content, 'wheel', event => event.stopPropagation());
  card.append(header, sceneSelector, tablist, content, footer);
  element.append(card, launcher);
  document.body.append(element);
  selectGroup(activeGroup);
  setOpen(open);
  refreshSaveState();

  return {
    get settings() { return settings; },
    get scene() { return activeScene; },
    element,
    setScene(scope) { if (!disposed) selectScene(scope); },
    setVisible(value) {
      const nextVisible = Boolean(value);
      if (visible === nextVisible) return;
      visible = nextVisible;
      element.hidden = !visible;
      element.inert = !visible;
      notifyFernSelection();
    },
    dispose() {
      disposed = true;
      notifyFernSelection();
      for (const remove of listeners) remove();
      element.remove();
      rows.clear(); tabs.clear(); panels.clear(); fernRows.clear(); sceneButtons.clear();
    },
  };
}
