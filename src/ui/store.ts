import { create } from 'zustand';
import type { PhaseName } from '../sim/clock';
import type { MoraleFactor } from '../sim/economy';
import type { StructureKind, StructureStatus } from '../sim/structures';

export interface EcoSnapshot {
  funds: number;
  timber: number;
  concrete: number;
  produce: number;
  meat: number;
  materialsCap: number;
  foodCap: number;
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
  mode: 'rts' | 'control';
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
  mode: 'rts',
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
    produce: 0,
    meat: 0,
    materialsCap: 0,
    foodCap: 0,
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
