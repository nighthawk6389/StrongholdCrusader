import { create } from 'zustand';
import type { PhaseName } from '../sim/clock';
import type { MoraleFactor } from '../sim/economy';
import type { GameMode } from '../sim/scenario';
import type { StructureKind, StructureStatus } from '../sim/structures';

export interface EcoSnapshot {
  funds: number;
  timber: number;
  concrete: number;
  steel: number;
  produce: number;
  meat: number;
  /** Armory stock: rifles, machine guns, scoped rifles, breach kits. */
  gear: number[];
  materialsCap: number;
  foodCap: number;
  gearCap: number;
  population: number;
  idle: number;
  housing: number;
  morale: number;
  /** Morale change per second. */
  trend: number;
  factors: MoraleFactor[];
  rationLevel: number;
  taxLevel: number;
  /** Seconds of food at current rations (Infinity if none eaten). */
  foodSeconds: number;
  /** Funds per minute from taxes (negative when bribing). */
  taxPerMin: number;
}

export interface PlacingInfo {
  kind: StructureKind;
  name: string;
  cost: string;
  valid: boolean;
  reason: string | null;
  /** Touch: a position has been chosen and can be confirmed. */
  hasSpot: boolean;
  rotatable: boolean;
  /** Wall-line placement state (null for other buildings). */
  wall: { anchored: boolean; ended: boolean; tiles: number } | null;
}

export interface RecruitOption {
  kind: number;
  name: string;
  blurb: string;
  cost: string;
  /** Matching weapons in the armory. */
  stock: number;
  /** Why it can't be trained right now (null = it can). */
  blocker: string | null;
}

export interface BuildingInfo {
  id: number;
  kind: StructureKind;
  name: string;
  description: string;
  status: StructureStatus;
  workers: number;
  jobs: number;
  active: boolean;
  canDemolish: boolean;
  refund: string;
  storage: string | null;
  hp: number;
  maxHp: number;
  enemy: boolean;
  powered: boolean;
  recipes: { options: string[]; selected: number } | null;
  recruit: RecruitOption[] | null;
  /** Trade Post rows (null for other buildings). */
  trade: TradeRow[] | null;
}

export interface TradeRow {
  res: number;
  name: string;
  stock: number;
  buy: number;
  sell: number;
}

export interface WaveInfo {
  /** Waves launched so far. */
  index: number;
  total: number;
  /** Seconds until the next wave (null when all have launched). */
  nextIn: number | null;
  attackers: number;
}

export interface HudState {
  clock: string;
  phase: PhaseName;
  day: number;
  speed: number;
  paused: boolean;
  selectionCount: number;
  selectionLabel: string;
  canControl: boolean;
  /** Camera/control view. */
  view: 'rts' | 'control';
  gameMode: GameMode;
  wave: WaveInfo | null;
  result: { result: 'victory' | 'defeat'; reason: string } | null;
  /** Skirmish opponent. */
  opponent: { name: string; difficulty: string } | null;
  /** Latest radio message from the opponent. */
  taunt: { name: string; text: string } | null;
  power: { supply: number; demand: number };
  nightShift: boolean;
  /** Looking through night-vision optics (green view). */
  nvg: boolean;
  targeting: 'flare' | null;
  controlledHp: number;
  controlledName: string;
  aiming: boolean;
  pointerLocked: boolean;
  selectMode: boolean;
  isTouch: boolean;
  fps: number;
  simMs: number;
  playerUnits: number;
  enemyUnits: number;
  showHelp: boolean;
  debug: boolean;
  quality: string;
  toast: string | null;
  eco: EcoSnapshot;
  placing: PlacingInfo | null;
  building: BuildingInfo | null;
  buildOpen: boolean;
  moraleOpen: boolean;
}

export const useHud = create<HudState>(() => ({
  clock: '--:--',
  phase: 'day',
  day: 1,
  speed: 1,
  paused: false,
  selectionCount: 0,
  selectionLabel: '',
  canControl: false,
  view: 'rts',
  gameMode: 'sandbox',
  wave: null,
  result: null,
  opponent: null,
  taunt: null,
  power: { supply: 0, demand: 0 },
  nightShift: false,
  nvg: false,
  targeting: null,
  controlledHp: 1,
  controlledName: '',
  aiming: false,
  pointerLocked: false,
  selectMode: false,
  isTouch: false,
  fps: 0,
  simMs: 0,
  playerUnits: 0,
  enemyUnits: 0,
  showHelp: false,
  debug: false,
  quality: 'high',
  toast: null,
  eco: {
    funds: 0,
    timber: 0,
    concrete: 0,
    steel: 0,
    produce: 0,
    meat: 0,
    gear: [0, 0, 0, 0],
    materialsCap: 0,
    foodCap: 0,
    gearCap: 0,
    population: 0,
    idle: 0,
    housing: 0,
    morale: 50,
    trend: 0,
    factors: [],
    rationLevel: 2,
    taxLevel: 3,
    foodSeconds: Infinity,
    taxPerMin: 0,
  },
  placing: null,
  building: null,
  buildOpen: false,
  moraleOpen: false,
}));

export const setHud = (patch: Partial<HudState>): void => useHud.setState(patch);
