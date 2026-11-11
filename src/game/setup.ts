import { isOpponentKey, type Difficulty, type OpponentKey } from '../sim/ai';
import { isMapKey, type MapKey } from '../sim/maps';
import type { GameMode } from '../sim/scenario';

/** Everything that picks a match: carried in the page URL so a reload (or a saved game) finds it again. */
export interface MatchSetup {
  mode: GameMode;
  difficulty: Difficulty;
  seed: number;
  opponent: OpponentKey;
  map: MapKey;
  /** Commander's Trail stage (0-based), or null outside the trail. */
  trail: number | null;
}

export const DEFAULT_SEED = 1337;

// ------------------------------------------------------------------ Commander's Trail

export interface TrailStage {
  title: string;
  brief: string;
  opponent: OpponentKey;
  map: MapKey;
  difficulty: Difficulty;
  seed: number;
}

/** An escalating ladder of AI challenges, each on its own ground. */
export const TRAIL: TrailStage[] = [
  {
    title: 'Boot Camp',
    brief: 'Old Sarge goes easy on you. Wall in, arm up, and take the HQ.',
    opponent: 'sarge',
    map: 'basin',
    difficulty: 'easy',
    seed: 1337,
  },
  {
    title: 'Open Sands',
    brief: 'Jackal raids early across open dunes. Guard your farms and hit back fast.',
    opponent: 'jackal',
    map: 'dunes',
    difficulty: 'normal',
    seed: 2024,
  },
  {
    title: 'Black Gold',
    brief: 'The Broker turns oil money into hired armies. End it before the payroll grows.',
    opponent: 'broker',
    map: 'oilfields',
    difficulty: 'normal',
    seed: 4242,
  },
  {
    title: 'The Pass',
    brief: 'The Engineer has mined and trenched the far side of the ridge. Bring engineers or a Breacher.',
    opponent: 'engineer',
    map: 'pass',
    difficulty: 'normal',
    seed: 3131,
  },
  {
    title: 'Lights Out',
    brief: 'Nightshade owns the dark. Guard your generators and light the walls: the attacks come at night.',
    opponent: 'nightshade',
    map: 'ruins',
    difficulty: 'normal',
    seed: 7171,
  },
  {
    title: 'Iron Duchess',
    brief: "Duchess Varga's tanks and Breachers come again and again. Mines, ditches and AT rockets.",
    opponent: 'varga',
    map: 'oilfields',
    difficulty: 'hard',
    seed: 8282,
  },
  {
    title: 'The Long Siege',
    brief: 'The Quartermaster hides the richest economy on the map behind two rings of walls. Hit early, or face the bill.',
    opponent: 'quartermaster',
    map: 'flats',
    difficulty: 'hard',
    seed: 9393,
  },
  {
    title: 'The Fortress',
    brief: "Warden's searchlit fortress, gun towers on every wall. Crack it.",
    opponent: 'warden',
    map: 'basin',
    difficulty: 'hard',
    seed: 6464,
  },
];

const TRAIL_KEY = 'siege-trail';

/** How many trail stages you've cleared (the next one is unlocked). */
export function trailCleared(): number {
  try {
    const n = Number(localStorage.getItem(TRAIL_KEY));
    return Number.isFinite(n) ? Math.max(0, Math.min(TRAIL.length, Math.floor(n))) : 0;
  } catch {
    return 0;
  }
}

/** Record a win on `stage`; unlocks the next one. */
export function clearTrailStage(stage: number): void {
  try {
    if (stage + 1 > trailCleared()) localStorage.setItem(TRAIL_KEY, String(stage + 1));
  } catch {
    /* storage unavailable: progress just isn't kept */
  }
}

export function trailSetup(stage: number): MatchSetup {
  const s = TRAIL[stage];
  return { mode: 'skirmish', difficulty: s.difficulty, seed: s.seed, opponent: s.opponent, map: s.map, trail: stage };
}

// ------------------------------------------------------------------ URL

const asDifficulty = (d: string | null): Difficulty => (d === 'easy' || d === 'hard' ? d : 'normal');

export function setupFromParams(params: URLSearchParams): MatchSetup | null {
  const mode = params.get('mode');
  if (mode !== 'hold' && mode !== 'sandbox' && mode !== 'skirmish' && mode !== 'tutorial') return null;
  const trail = Number(params.get('trail'));
  if (mode === 'skirmish' && params.has('trail') && Number.isInteger(trail) && TRAIL[trail]) return trailSetup(trail);
  const ai = params.get('ai');
  const map = params.get('map');
  return {
    mode,
    difficulty: asDifficulty(params.get('difficulty')),
    seed: Number(params.get('seed')) || DEFAULT_SEED,
    opponent: isOpponentKey(ai) ? ai : 'sarge',
    map: isMapKey(map) ? map : 'basin',
    trail: null,
  };
}

/** Query string for a match (only what differs from the defaults). */
export function setupQuery(s: MatchSetup): string {
  const p = new URLSearchParams();
  p.set('mode', s.mode);
  if (s.trail !== null) {
    p.set('trail', String(s.trail));
    return p.toString();
  }
  if (s.mode === 'skirmish') {
    p.set('difficulty', s.difficulty);
    if (s.opponent !== 'sarge') p.set('ai', s.opponent);
    if (s.map !== 'basin') p.set('map', s.map);
  }
  if (s.seed !== DEFAULT_SEED) p.set('seed', String(s.seed));
  return p.toString();
}

/** Same match? (Used to decide whether the autosave belongs to the game this link opens.) */
export function sameMatch(a: MatchSetup, b: MatchSetup): boolean {
  if (a.mode !== b.mode || a.seed !== b.seed) return false;
  if (a.mode !== 'skirmish') return true;
  return a.difficulty === b.difficulty && a.opponent === b.opponent && a.map === b.map && a.trail === b.trail;
}
