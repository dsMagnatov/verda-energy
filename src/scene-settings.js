import { FERN_INSTANCES, FERN_INSTANCE_CONTROL_KEYS } from './fern-instances.js';

export const SCENE_CONTROL_GROUPS = [
  {
    id: 'rays', label: 'Промені',
    controls: [
      { key: 'intensity', label: 'Яскравість', default: 1, min: 0, max: 12, step: .01 },
      { key: 'width', label: 'Ширина', default: 1, min: .3, max: 10, step: .01 },
      { key: 'spread', label: 'Розсіювання', default: 1, min: .4, max: 8, step: .01 },
      { key: 'angle', label: 'Нахил', default: 0, min: -60, max: 240, step: 1, unit: '°' },
      { key: 'sourceX', label: 'Сонце по X', default: .82, min: 0, max: 4, step: .01 },
      { key: 'sourceY', label: 'Сонце по Y', default: 1.14, min: .8, max: 6.8, step: .01 },
      { key: 'softness', label: 'М’якість', default: 1, min: .3, max: 12, step: .01 },
      { key: 'warmth', label: 'Теплота', default: .58, min: 0, max: 4, step: .01 },
      { key: 'length', label: 'Довжина', default: 1, min: .3, max: 8, step: .01 },
    ],
  },
  {
    id: 'particles', label: 'Частинки',
    controls: [
      { key: 'count', label: 'Кількість', default: 480, min: 0, max: 4800, step: 10 },
      { key: 'size', label: 'Розмір', default: 1, min: .25, max: 16, step: .05 },
      { key: 'brightness', label: 'Яскравість', default: 1, min: 0, max: 12, step: .05 },
      { key: 'speed', label: 'Швидкість', default: 1, min: 0, max: 12, step: .05 },
      { key: 'drift', label: 'Коливання', default: 1, min: 0, max: 12, step: .05 },
      { key: 'softness', label: 'М’якість', default: 1, min: 0, max: 8, step: .05 },
      { key: 'depth', label: 'Глибина', default: 1, min: .3, max: 8, step: .05 },
      { key: 'foreground', label: 'Ближні частинки', default: 1, min: 0, max: 12, step: .05 },
    ],
  },
  {
    id: 'optics', label: 'Оптика',
    controls: [
      { key: 'amount', label: 'Викривлення', default: .55, min: 0, max: 6, step: .01 },
      { key: 'area', label: 'Зона ефекту', default: .65, min: .15, max: 3.6, step: .01 },
      { key: 'speed', label: 'Швидкість', default: .4, min: 0, max: 8, step: .05 },
      { key: 'blur', label: 'Розмиття', default: .45, min: 0, max: 4, step: .01 },
      { key: 'blurSize', label: 'Радіус розмиття', default: 6, min: 0, max: 96, step: 1, unit: ' px' },
      { key: 'chromatic', label: 'Червоний / синій', default: 10, min: 0, max: 128, step: 1, unit: ' px' },
      { key: 'stretch', label: 'Розтягування', default: .35, min: 0, max: 4, step: .01 },
      { key: 'topLeft', label: 'Верх ліворуч', default: 1, min: 0, max: 8, step: .05 },
      { key: 'topRight', label: 'Верх праворуч', default: 1, min: 0, max: 8, step: .05 },
      { key: 'bottomLeft', label: 'Низ ліворуч', default: 1, min: 0, max: 8, step: .05 },
      { key: 'bottomRight', label: 'Низ праворуч', default: 1, min: 0, max: 8, step: .05 },
    ],
  },
  {
    id: 'background', label: 'Фон',
    controls: [
      { key: 'bottomColor', label: 'Нижній колір', type: 'color', default: '#090b09' },
      { key: 'topColor', label: 'Верхній колір', type: 'color', default: '#665643' },
      { key: 'glowColor', label: 'Колір сяйва', type: 'color', default: '#b37d49' },
      { key: 'brightness', label: 'Яскравість', default: 1, min: 0, max: 8, step: .01 },
      { key: 'gradient', label: 'Градієнт', default: .72, min: 0, max: 4, step: .01 },
      { key: 'glowStrength', label: 'Сила сяйва', default: .53, min: 0, max: 6, step: .01 },
      { key: 'glowSize', label: 'Розмір сяйва', default: 1, min: .3, max: 12, step: .01 },
      { key: 'noise', label: 'Зернистість', default: .055, min: 0, max: .8, step: .005 },
      { key: 'vignette', label: 'Віньєтка', default: .13, min: 0, max: 2.4, step: .01 },
    ],
  },
  {
    id: 'stone', label: 'Камені',
    controls: [
      { key: 'tint', label: 'Відтінок', type: 'color', default: '#ffffff' },
      { key: 'scale', label: 'Масштаб текстури', default: .72, min: .2, max: 10, step: .01 },
      { key: 'normal', label: 'Рельєф', default: 1.08, min: 0, max: 12, step: .01 },
      { key: 'roughness', label: 'Шорсткість', default: .95, min: .3, max: 4, step: .01 },
      { key: 'brightness', label: 'Яскравість', default: 1, min: .2, max: 8, step: .01 },
      { key: 'contrast', label: 'Контраст', default: 1, min: .5, max: 8, step: .01 },
      { key: 'saturation', label: 'Насиченість', default: .45, min: 0, max: 4, step: .01 },
      { key: 'crackColor', label: 'Колір тріщин', type: 'color', default: '#8f8b80' },
      { key: 'crackStrength', label: 'Сила тріщин', default: 0, min: 0, max: 4, step: .01 },
      { key: 'crackWidth', label: 'Ширина тріщин', default: 1, min: .2, max: 4, step: .01 },
      { key: 'crackDepth', label: 'Глибина тріщин', default: 1, min: 0, max: 4, step: .01 },
      { key: 'crackGloss', label: 'Блиск тріщин', default: 0, min: 0, max: 4, step: .01 },
      { key: 'crackMetalness', label: 'Метал тріщин', default: 0, min: 0, max: 4, step: .01 },
      { key: 'crackGlow', label: 'Світіння тріщин', default: 0, min: 0, max: 8, step: .01 },
      { key: 'crackThreshold', label: 'Поріг тріщин', default: .32, min: .05, max: .8, step: .005 },
    ],
  },
  {
    id: 'solar', label: 'Сонячна панель',
    controls: [
      { key: 'scale', label: 'Розмір', default: 1, min: .2, max: 4, step: .01 },
      { key: 'positionX', label: 'Положення X', default: 0, min: -2, max: 2, step: .01 },
      { key: 'positionY', label: 'Положення Y', default: 0, min: -1, max: 2, step: .01 },
      { key: 'positionZ', label: 'Положення Z', default: 0, min: -2, max: 2, step: .01 },
      { key: 'tiltX', label: 'Нахил X', default: 0, min: -80, max: 80, step: 1, unit: '°' },
      { key: 'tiltZ', label: 'Нахил Z', default: 0, min: -80, max: 80, step: 1, unit: '°' },
      { key: 'rotation', label: 'Поворот', default: 0, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'width', label: 'Ширина', default: 1, min: .3, max: 3, step: .01 },
      { key: 'depth', label: 'Довжина', default: 1, min: .3, max: 3, step: .01 },
      { key: 'tint', label: 'Колір панелі', type: 'color', default: '#ffffff' },
      { key: 'brightness', label: 'Яскравість', default: 1, min: .2, max: 3, step: .01 },
      { key: 'roughness', label: 'Шорсткість', default: .30, min: .05, max: 1, step: .01 },
      { key: 'metalness', label: 'Металевість', default: .24, min: 0, max: 1, step: .01 },
      { key: 'glassOpacity', label: 'Непрозорість скла', default: .035, min: 0, max: .5, step: .005 },
      { key: 'gridStrength', label: 'Контраст комірок', default: 1, min: 0, max: 3, step: .01 },
      { key: 'frameColor', label: 'Колір рамки', type: 'color', default: '#8b999f' },
      { key: 'frameRoughness', label: 'Шорсткість рамки', default: .48, min: .05, max: 1, step: .01 },
    ],
  },
  {
    id: 'ferns', label: 'Папороті',
    controls: [
      { key: 'scale', label: 'Розмір', default: 1, min: .1, max: 4, step: .01 },
      { key: 'positionX', label: 'Положення X', default: 0, min: -1.5, max: 1.5, step: .01 },
      { key: 'positionY', label: 'Положення Y', default: 0, min: -.5, max: 1.5, step: .01 },
      { key: 'positionZ', label: 'Положення Z', default: 0, min: -1.5, max: 1.5, step: .01 },
      { key: 'tiltX', label: 'Нахил X', default: 0, min: -80, max: 80, step: 1, unit: '°' },
      { key: 'tiltZ', label: 'Нахил Z', default: 0, min: -80, max: 80, step: 1, unit: '°' },
      { key: 'rotation', label: 'Поворот', default: 0, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'width', label: 'Ширина', default: 1, min: .2, max: 3, step: .01 },
      { key: 'height', label: 'Висота', default: 1, min: .2, max: 3, step: .01 },
      { key: 'tint', label: 'Відтінок', type: 'color', default: '#ffffff' },
      { key: 'brightness', label: 'Яскравість', default: 1, min: .2, max: 3, step: .01 },
      { key: 'saturation', label: 'Насиченість', default: 1, min: 0, max: 3, step: .01 },
      { key: 'roughness', label: 'Шорсткість', default: .92, min: .1, max: 1, step: .01 },
      { key: 'breeze', label: 'Сила вітру', default: .25, min: 0, max: 2, step: .01 },
      { key: 'breezeSpeed', label: 'Швидкість вітру', default: 1, min: 0, max: 4, step: .01 },
      { key: 'spread', label: 'Розмах листя', default: 1, min: .1, max: 3, step: .01 },
    ],
  },
  {
    id: 'title', label: 'Заголовок',
    controls: [
      { key: 'blur', label: 'Сила розмиття', default: 1, min: 0, max: 1, step: .01 },
      { key: 'blurSize', label: 'Радіус розмиття', default: 16, min: 0, max: 64, step: .5, unit: ' px' },
      { key: 'radius', label: 'Зона ефекту', default: 320, min: 40, max: 960, step: 1, unit: ' px' },
      { key: 'response', label: 'Реакція курсору', default: 5, min: .25, max: 24, step: .05 },
      { key: 'glow', label: 'Світіння літер', default: .75, min: 0, max: 4, step: .01 },
      { key: 'glowSize', label: 'Розмір світіння', default: 22, min: 0, max: 96, step: 1, unit: ' px' },
      { key: 'distortion', label: 'Викривлення', default: .2, min: 0, max: 2, step: .01 },
      { key: 'softness', label: 'М’якість країв', default: .84, min: .1, max: 1, step: .01 },
      { key: 'glowColor', label: 'Колір світіння', type: 'color', default: '#fff1d4' },
    ],
  },
];

for (const group of SCENE_CONTROL_GROUPS) group.scope = 'hero';

/** Missing garden effect groups migrate from the owner's published hero look. */
export const GARDEN_EFFECT_SOURCES = {
  gardenRays: 'rays', gardenParticles: 'particles', gardenOptics: 'optics', gardenBackground: 'background',
};

SCENE_CONTROL_GROUPS.push(
  {
    id: 'gardenPanel', label: 'Панель', scope: 'garden',
    controls: [
      { key: 'scale', label: 'Розмір', default: 1, min: .1, max: 3, step: .01 },
      { key: 'width', label: 'Ширина', default: 1, min: .2, max: 2.5, step: .01 },
      { key: 'height', label: 'Висота', default: 1, min: .2, max: 2.5, step: .01 },
      { key: 'positionX', label: 'Положення X', default: 0, min: -8, max: 8, step: .01 },
      { key: 'positionY', label: 'Положення Y', default: 0, min: -4, max: 8, step: .01 },
      { key: 'positionZ', label: 'Положення Z', default: 0, min: -8, max: 8, step: .01 },
      { key: 'tiltX', label: 'Нахил X', default: 0, min: -80, max: 80, step: 1, unit: '°' },
      { key: 'tiltZ', label: 'Нахил Z', default: 0, min: -80, max: 80, step: 1, unit: '°' },
      { key: 'rotation', label: 'Поворот', default: 0, min: -180, max: 180, step: 1, unit: '°' },
      { key: 'descentStart', label: 'Початок опускання', default: 55, min: 46, max: 95, step: 1, unit: '%' },
      { key: 'descentEnd', label: 'Кінець опускання', default: 84, min: 50, max: 100, step: 1, unit: '%' },
      { key: 'startHeight', label: 'Початкова висота', default: 15, min: 7, max: 30, step: .1 },
    ],
  },
  {
    id: 'gardenCamera', label: 'Камера', scope: 'garden',
    controls: [
      { key: 'startHeight', label: 'Початкова висота', default: 1.55, min: .5, max: 6, step: .01 },
      { key: 'startDistance', label: 'Початкова відстань', default: 6.5, min: 3, max: 15, step: .01 },
      { key: 'endHeight', label: 'Кінцева висота', default: 2.8, min: 1, max: 15, step: .01 },
      { key: 'endDistance', label: 'Кінцева відстань', default: 18, min: 5, max: 30, step: .01 },
      { key: 'positionX', label: 'Положення X', default: 0, min: -8, max: 8, step: .01 },
      { key: 'targetHeight', label: 'Висота цілі', default: 3.4, min: 0, max: 8, step: .01 },
      { key: 'targetZ', label: 'Положення цілі Z', default: -3.5, min: -8, max: 0, step: .01 },
      { key: 'moveStart', label: 'Початок руху', default: 49, min: 46, max: 80, step: 1, unit: '%' },
      { key: 'moveEnd', label: 'Кінець руху', default: 88, min: 55, max: 100, step: 1, unit: '%' },
      { key: 'fov', label: 'Кут огляду', default: 35, min: 25, max: 70, step: 1, unit: '°' },
    ],
  },
  {
    id: 'gardenWater', label: 'Вода', scope: 'garden',
    controls: [
      { key: 'waveStrength', label: 'Сила хвиль', default: 1, min: 0, max: 5, step: .01 },
      { key: 'waveScale', label: 'Масштаб хвиль', default: 1, min: .1, max: 8, step: .01 },
      { key: 'waveSpeed', label: 'Швидкість хвиль', default: 1, min: 0, max: 5, step: .01 },
      { key: 'reflection', label: 'Відбиття', default: .75, min: 0, max: 1, step: .01 },
      { key: 'shine', label: 'Сила блиску', default: 1, min: 0, max: 4, step: .01 },
      { key: 'shineSize', label: 'Розмір відблиску', default: 1, min: .1, max: 4, step: .01 },
      { key: 'transparency', label: 'Прозорість', default: .25, min: 0, max: 1, step: .01 },
      { key: 'roughness', label: 'Шорсткість', default: .15, min: 0, max: 1, step: .01 },
      { key: 'brightness', label: 'Яскравість', default: 1, min: .1, max: 3, step: .01 },
      { key: 'depth', label: 'Глибина', default: 1, min: 0, max: 4, step: .01 },
      { key: 'color', label: 'Колір води', type: 'color', default: '#203b32' },
    ],
  },
  {
    id: 'gardenGround', label: 'Земля', scope: 'garden',
    controls: [
      { key: 'brightness', label: 'Яскравість', default: 1, min: .1, max: 3, step: .01 },
      { key: 'textureScale', label: 'Масштаб текстури', default: 1, min: .2, max: 8, step: .01 },
      { key: 'textureStrength', label: 'Сила текстури', default: 1, min: 0, max: 3, step: .01 },
      { key: 'relief', label: 'Рельєф', default: 1, min: 0, max: 4, step: .01 },
      { key: 'roughness', label: 'Шорсткість', default: .98, min: .1, max: 1, step: .01 },
      { key: 'saturation', label: 'Насиченість', default: 1, min: 0, max: 2, step: .01 },
      { key: 'contrast', label: 'Контраст', default: 1, min: .25, max: 3, step: .01 },
      { key: 'color', label: 'Колір землі', type: 'color', default: '#669149' },
    ],
  },
  {
    id: 'gardenGrass', label: 'Низька трава', scope: 'garden',
    controls: [
      { key: 'density', label: 'Густота', default: 1, min: 0, max: 1, step: .01 },
      { key: 'height', label: 'Висота', default: 1, min: .1, max: 3, step: .01 },
      { key: 'width', label: 'Ширина', default: 1, min: .2, max: 3, step: .01 },
      { key: 'brightness', label: 'Яскравість', default: 1, min: .1, max: 3, step: .01 },
      { key: 'saturation', label: 'Насиченість', default: 1, min: 0, max: 2, step: .01 },
      { key: 'roughness', label: 'Шорсткість', default: .92, min: .1, max: 1, step: .01 },
      { key: 'breeze', label: 'Сила вітру', default: 1, min: 0, max: 4, step: .01 },
      { key: 'speed', label: 'Швидкість вітру', default: 1, min: 0, max: 4, step: .01 },
      { key: 'color', label: 'Колір трави', type: 'color', default: '#ffffff' },
    ],
  },
  {
    id: 'gardenRoom', label: 'Приміщення', scope: 'garden',
    controls: [
      { key: 'wallHeight', label: 'Висота стін', default: 6.5, min: 4, max: 14, step: .1 },
      { key: 'radius', label: 'Радіус стін', default: 14, min: 10, max: 22, step: .1 },
      { key: 'openingWidth', label: 'Ширина отвору', default: 10.5, min: 4, max: 16, step: .1 },
      { key: 'openingDepth', label: 'Довжина отвору', default: 7.8, min: 3, max: 14, step: .1 },
      { key: 'roofThickness', label: 'Товщина стелі', default: .65, min: .1, max: 2, step: .01 },
      { key: 'roughness', label: 'Шорсткість', default: .8, min: .1, max: 1, step: .01 },
      { key: 'textureScale', label: 'Масштаб текстури', default: .25, min: .05, max: 2, step: .01 },
      { key: 'textureStrength', label: 'Сила текстури', default: .2, min: 0, max: 1, step: .01 },
      { key: 'color', label: 'Колір стін', type: 'color', default: '#bdb7a0' },
    ],
  },
  ...Object.entries(GARDEN_EFFECT_SOURCES).map(([id, sourceId]) => {
    const source = SCENE_CONTROL_GROUPS.find(group => group.id === sourceId);
    return { id, label: source.label, scope: 'garden', controls: source.controls.map(control => ({ ...control })) };
  }),
);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function getSceneControl(groupId, key) {
  return SCENE_CONTROL_GROUPS.find(group => group.id === groupId)?.controls.find(control => control.key === key);
}

export function getSceneControlLimits(groupId) {
  const group = SCENE_CONTROL_GROUPS.find(item => item.id === groupId);
  return Object.fromEntries((group?.controls || [])
    .filter(control => control.type !== 'color')
    .map(control => [control.key, [control.min, control.max]]));
}

export function createDefaultSceneSettings() {
  const settings = Object.fromEntries(SCENE_CONTROL_GROUPS.map(group => [
    group.id,
    Object.fromEntries(group.controls.map(control => [control.key, control.default])),
  ]));
  settings.ferns.instances = Object.fromEntries(FERN_INSTANCES.map(({ id }) => [id, createDefaultFernInstanceSettings()]));
  return settings;
}

export function createDefaultFernInstanceSettings() {
  return Object.fromEntries(FERN_INSTANCE_CONTROL_KEYS.map(key => [key, getSceneControl('ferns', key).default]));
}

function sanitizeControl(control, candidate) {
  if (control.type === 'color') {
    return typeof candidate === 'string' && /^#[\da-f]{6}$/i.test(candidate) ? candidate.toLowerCase() : control.default;
  }
  const finite = typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : control.default;
  const clamped = Math.max(control.min, Math.min(control.max, finite));
  const precision = String(control.step).split('.')[1]?.length || 0;
  const stepped = control.min + Math.round((clamped - control.min) / control.step) * control.step;
  return Number(Math.max(control.min, Math.min(control.max, stepped)).toFixed(precision));
}

/** One plant's offsets relative to its authored placement and global controls. */
export function sanitizeFernInstanceSettings(value) {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(FERN_INSTANCE_CONTROL_KEYS.map(key => [
    key, sanitizeControl(getSceneControl('ferns', key), source[key]),
  ]));
}

export function sanitizeSceneSettings(value) {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(SCENE_CONTROL_GROUPS.map(group => {
    const fallbackId = GARDEN_EFFECT_SOURCES[group.id];
    const values = isRecord(source[group.id]) ? source[group.id]
      : fallbackId && isRecord(source[fallbackId]) ? source[fallbackId] : {};
    const controls = group.controls.map(control => [control.key, sanitizeControl(control, values[control.key])]);
    if (group.id === 'ferns') {
      const instances = isRecord(values.instances) ? values.instances : {};
      controls.push(['instances', Object.fromEntries(FERN_INSTANCES.map(({ id }) => [
        id, sanitizeFernInstanceSettings(Object.hasOwn(instances, id) ? instances[id] : undefined),
      ]))]);
    }
    return [group.id, Object.fromEntries(controls)];
  }));
}
