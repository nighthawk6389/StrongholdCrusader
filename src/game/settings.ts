/** Player settings, kept in localStorage. Everything has a sensible default and is clamped on load. */
export interface Settings {
  /** Volumes 0..1. */
  master: number;
  sfx: number;
  music: number;
  /** Graphics preset ('auto' picks by device). Applies on the next start. */
  quality: 'auto' | 'low' | 'high';
  /** Camera pan and rotate speed multipliers. */
  panSpeed: number;
  rotateSpeed: number;
  /** Desktop: scroll when the mouse touches a screen edge. */
  edgePan: boolean;
  /** Direct control: look sensitivity multiplier, and inverted vertical look. */
  lookSensitivity: number;
  invertLook: boolean;
  /** Short tips (help card on a new game, hints bar). */
  showHints: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  sfx: 0.9,
  music: 0.5,
  quality: 'auto',
  panSpeed: 1,
  rotateSpeed: 1,
  edgePan: true,
  lookSensitivity: 1,
  invertLook: false,
  showHints: true,
};

const KEY = 'siege-settings';
const clamp = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Merge stored (possibly old or damaged) values over the defaults. */
export function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const d = DEFAULT_SETTINGS;
  return {
    master: clamp(r.master, 0, 1, d.master),
    sfx: clamp(r.sfx, 0, 1, d.sfx),
    music: clamp(r.music, 0, 1, d.music),
    quality: r.quality === 'low' || r.quality === 'high' ? r.quality : 'auto',
    panSpeed: clamp(r.panSpeed, 0.4, 2.5, d.panSpeed),
    rotateSpeed: clamp(r.rotateSpeed, 0.4, 2.5, d.rotateSpeed),
    edgePan: typeof r.edgePan === 'boolean' ? r.edgePan : d.edgePan,
    lookSensitivity: clamp(r.lookSensitivity, 0.3, 3, d.lookSensitivity),
    invertLook: typeof r.invertLook === 'boolean' ? r.invertLook : d.invertLook,
    showHints: typeof r.showHints === 'boolean' ? r.showHints : d.showHints,
  };
}

let current: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  if (!current) {
    try {
      current = sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
    } catch {
      current = { ...DEFAULT_SETTINGS };
    }
  }
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = sanitize({ ...getSettings(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: settings last for this session */
  }
  for (const l of listeners) l(current);
  return current;
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
