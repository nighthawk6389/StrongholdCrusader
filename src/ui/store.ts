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
  fuel: number;
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
  /** Shown instead of the armory count (vehicles). */
  note?: string;
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
  /** Drone Bay: what it can launch and how many drones are up. */
  drones: { options: DroneOption[]; count: number; cap: number } | null;
  /** Gun tower status. */
  turret: { crewed: boolean; ammo: number; mag: number } | null;
  /** You can take direct control of it (gun towers, searchlights). */
  controllable: boolean;
  /** Fuel trench: can be lit / is burning. */
  ignite: boolean;
  burning: boolean;
  /** Upgrade level and the next upgrade on offer (null when fully upgraded or not upgradeable). */
  level: number;
  upgrade: { name: string; description: string; cost: string; blocker: string | null } | null;
  /** Contracts Office: PMC teams for hire. */
  contracts: ContractOption[] | null;
}

export interface ContractOption {
  index: number;
  name: string;
  blurb: string;
  cost: string;
  /** Why it can't be signed right now (null = it can). */
  blocker: string | null;
}

export interface DroneOption {
  kind: number;
  name: string;
  blurb: string;
  cost: string;
  /** Why it can't launch right now (null = it can). */
  blocker: string | null;
}

/** What you're possessing: a soldier, a drone, a gun tower or a searchlight. */
export interface ControlInfo {
  kind: 'soldier' | 'drone' | 'turret' | 'light' | 'vehicle';
  /** Howitzer set-up progress 0..1 (null for anything else). */
  deploy: number | null;
  /** Howitzer (fires shells at the ground under the crosshair). */
  artillery: boolean;
  name: string;
  /** Health 0..1. */
  hp: number;
  /** Rounds in the magazine / belt and its size (mag 0 = no gun). */
  ammo: number;
  mag: number;
  /** Reload progress 0..1 while reloading, else null. */
  reload: number | null;
  /** Breach charges carried (assault ramps for a Breacher). */
  charges: number;
  /** Breacher: G pushes a ramp or fills a ditch. */
  dozer: boolean;
  /** Charge-plant (or ramp / ditch work) progress 0..1, else null. */
  plant: number | null;
  /** Drone battery 0..1 and seconds left (null for non-drones). */
  battery: number | null;
  batterySec: number;
  /** Strike drone: fire = dive. */
  strike: boolean;
  diving: boolean;
  /** Gun tower: a soldier is up top (it can fire). */
  crewed: boolean;
  nvgAvailable: boolean;
  nvgOn: boolean;
  /** Aiming through a real scope (big zoom). */
  scope: boolean;
  /** Soldiers following you. */
  squad: number;
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
  /** The selection broken down by unit type (for splitting it). */
  selectionGroups: { kind: number; name: string; count: number }[];
  canControl: boolean;
  /** Camera/control view. */
  view: 'rts' | 'control';
  gameMode: GameMode;
  wave: WaveInfo | null;
  result: { result: 'victory' | 'defeat'; reason: string } | null;
  /** Skirmish opponent (and the map you're on). */
  opponent: { name: string; difficulty: string; title: string; blurb: string; map: string } | null;
  /** Tutorial card: the current step (null outside the tutorial). */
  tutorial: { index: number; total: number; title: string; text: string; done: boolean; finished: boolean } | null;
  /** Commander's Trail stage being played; `next` is set after a win that unlocks another stage. */
  trail: { stage: number; title: string; next: { stage: number; title: string } | null } | null;
  /** Latest radio message from the opponent. */
  taunt: { name: string; text: string } | null;
  power: { supply: number; demand: number };
  nightShift: boolean;
  /** Looking through night-vision optics (green view). */
  nvg: boolean;
  targeting: 'flare' | null;
  /** Flares on hand. */
  flares: number;
  controlledHp: number;
  controlledName: string;
  control: ControlInfo | null;
  /** Latest hit you scored (for the crosshair hit marker); `t` keys the animation. */
  hitMarker: { kind: 'hit' | 'head' | 'kill'; t: number } | null;
  /** Direction you were last hit from, relative to where you're looking (radians, 0 = ahead). */
  damage: { angle: number; t: number } | null;
  /** Slow time to half speed while in direct control. */
  slowMo: boolean;
  aiming: boolean;
  pointerLocked: boolean;
  selectMode: boolean;
  isTouch: boolean;
  fps: number;
  simMs: number;
  playerUnits: number;
  enemyUnits: number;
  showHelp: boolean;
  showSettings: boolean;
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
  selectionGroups: [],
  canControl: false,
  view: 'rts',
  gameMode: 'sandbox',
  wave: null,
  result: null,
  opponent: null,
  trail: null,
  tutorial: null,
  taunt: null,
  power: { supply: 0, demand: 0 },
  nightShift: false,
  nvg: false,
  targeting: null,
  flares: 3,
  controlledHp: 1,
  controlledName: '',
  control: null,
  hitMarker: null,
  damage: null,
  slowMo: false,
  aiming: false,
  pointerLocked: false,
  selectMode: false,
  isTouch: false,
  fps: 0,
  simMs: 0,
  playerUnits: 0,
  enemyUnits: 0,
  showHelp: false,
  showSettings: false,
  debug: false,
  quality: 'high',
  toast: null,
  eco: {
    funds: 0,
    timber: 0,
    concrete: 0,
    steel: 0,
    fuel: 0,
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
