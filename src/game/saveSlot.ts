import type { Difficulty, OpponentKey } from '../sim/ai';
import type { MapKey } from '../sim/maps';
import type { GameMode } from '../sim/scenario';
import type { SimSave } from '../sim/save';
import type { MatchSetup } from './setup';

/** One autosave slot in localStorage: the game itself plus a small summary for the main menu. */
const DATA_KEY = 'siege-save';
const META_KEY = 'siege-save-meta';
/** Which running copy of the game (tab, window, page kept in the back/forward cache) the slot belongs to. */
const OWNER_KEY = 'siege-save-owner';

export interface SaveMeta {
  mode: GameMode;
  difficulty: Difficulty;
  seed: number;
  /** Skirmish opponent, map and trail stage (absent in older saves). */
  opponent?: OpponentKey;
  map?: MapKey;
  trail?: number | null;
  /** In-game time when saved, e.g. "Day 2 · 21:40". */
  label: string;
  /** Wall-clock time of the save (ms since epoch). */
  savedAt: number;
}

export interface StoredGame {
  meta: SaveMeta;
  save: SimSave;
  view: { x: number; z: number; yaw: number; dist: number; speed: number };
}

/** The match a saved game belongs to. */
export function metaSetup(m: SaveMeta): MatchSetup {
  return {
    mode: m.mode,
    difficulty: m.difficulty,
    seed: m.seed,
    opponent: m.opponent ?? 'sarge',
    map: m.map ?? 'basin',
    trail: m.trail ?? null,
  };
}

export function readMeta(): SaveMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as SaveMeta) : null;
  } catch {
    return null;
  }
}

export function readGame(): StoredGame | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    const meta = readMeta();
    if (!raw || !meta) return null;
    const data = JSON.parse(raw) as Omit<StoredGame, 'meta'>;
    return { ...data, meta };
  } catch {
    return null;
  }
}

/** Returns false if the browser refused (private mode, storage full). */
export function writeGame(g: StoredGame): boolean {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify({ save: g.save, view: g.view }));
    localStorage.setItem(META_KEY, JSON.stringify(g.meta));
    return true;
  } catch {
    clearGame();
    return false;
  }
}

/** A random id for one running copy of the game. */
export function newInstanceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The slot belongs to the copy of the game that was played last. A game claims it when it starts on an
 * empty slot, when it resumes the saved game, and whenever you touch it. A copy left open in another tab,
 * in the background, or in the browser's back/forward cache then can't overwrite a newer game.
 */
export function claimSlot(id: string): void {
  try {
    if (localStorage.getItem(OWNER_KEY) !== id) localStorage.setItem(OWNER_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

/** May this copy of the game write (or clear) the slot? Yes if it claimed it last, or nobody has. */
export function ownsSlot(id: string): boolean {
  try {
    const owner = localStorage.getItem(OWNER_KEY);
    return owner === null || owner === id;
  } catch {
    return true; // let the write itself fail and say so
  }
}

export function clearGame(): void {
  try {
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(META_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function agoText(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
