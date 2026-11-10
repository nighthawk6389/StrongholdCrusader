/** Structure (building) definitions and runtime records. Data-driven: tweak numbers here to balance. */

// ------------------------------------------------------------------ resources

export const Res = {
  Timber: 0,
  Concrete: 1,
  Produce: 2,
  Meat: 3,
} as const;
export type ResId = (typeof Res)[keyof typeof Res];
export const RES_COUNT = 4;

export interface ResInfo {
  id: ResId;
  key: string;
  name: string;
  food: boolean;
}

export const RES_INFO: ResInfo[] = [
  { id: Res.Timber, key: 'timber', name: 'Timber', food: false },
  { id: Res.Concrete, key: 'concrete', name: 'Concrete', food: false },
  { id: Res.Produce, key: 'produce', name: 'Produce', food: true },
  { id: Res.Meat, key: 'meat', name: 'Meat', food: true },
];

export const FOOD_RES: ResId[] = RES_INFO.filter((r) => r.food).map((r) => r.id);
export const MATERIAL_RES: ResId[] = RES_INFO.filter((r) => !r.food).map((r) => r.id);

// ------------------------------------------------------------------ structures

export type StructureKind =
  | 'hq'
  | 'hub'
  | 'house'
  | 'depot'
  | 'rations'
  | 'lumber'
  | 'quarry'
  | 'orchard'
  | 'ranch'
  | 'wall'
  | 'tower'
  | 'floodlight'
  | 'gate';

export interface Cost {
  funds?: number;
  timber?: number;
  concrete?: number;
}

/** Hard placement requirement. */
export type Requirement = 'none' | 'nearRock' | 'fertile';

export interface ProducerSpec {
  output: ResId;
  /** Seconds of work per cycle in daylight (night is slower). */
  work: number;
  /** Units carried to storage per trip. */
  batch: number;
  /** Lumber camps must first fetch a log from a tree. */
  gather?: 'tree';
}

export type BuildCategory = 'core' | 'industry' | 'food';

export interface StructureDef {
  kind: StructureKind;
  name: string;
  description: string;
  w: number;
  h: number;
  /** Whether the footprint blocks movement. */
  blocks: boolean;
  hp: number;
  /** Shown in the build menu (M1: economy only; defenses arrive in M2). */
  buildable: boolean;
  category?: BuildCategory;
  cost: Cost;
  housing?: number;
  storage?: { kind: 'materials' | 'food'; capacity: number };
  jobs?: number;
  producer?: ProducerSpec;
  requires?: Requirement;
}

export const STRUCTURE_DEFS: Record<StructureKind, StructureDef> = {
  hq: {
    kind: 'hq',
    name: 'Command HQ',
    description: 'Your command centre. Houses 8 and stores a few materials.',
    w: 4,
    h: 4,
    blocks: true,
    hp: 3000,
    buildable: false,
    cost: {},
    housing: 8,
    storage: { kind: 'materials', capacity: 60 },
  },
  hub: {
    kind: 'hub',
    name: 'Arrivals Hub',
    description: 'New civilians arrive here; idle civilians wait here for work.',
    w: 2,
    h: 2,
    blocks: true,
    hp: 500,
    buildable: false,
    cost: {},
  },
  house: {
    kind: 'house',
    name: 'Housing Block',
    description: 'Houses 8 civilians. More housing lets your population grow.',
    w: 2,
    h: 2,
    blocks: true,
    hp: 400,
    buildable: true,
    category: 'core',
    cost: { timber: 8 },
    housing: 8,
  },
  depot: {
    kind: 'depot',
    name: 'Supply Depot',
    description: 'Stores 300 materials. Build near producers to shorten hauling trips.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 600,
    buildable: true,
    category: 'core',
    cost: { timber: 10 },
    storage: { kind: 'materials', capacity: 300 },
  },
  rations: {
    kind: 'rations',
    name: 'Ration Store',
    description: 'Stores 200 food. Your people eat from here.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 600,
    buildable: true,
    category: 'food',
    cost: { timber: 12 },
    storage: { kind: 'food', capacity: 200 },
  },
  lumber: {
    kind: 'lumber',
    name: 'Lumber Camp',
    description: 'A worker fells nearby trees, saws the logs and hauls timber to a depot.',
    w: 2,
    h: 2,
    blocks: true,
    hp: 300,
    buildable: true,
    category: 'industry',
    cost: { timber: 4 },
    jobs: 1,
    producer: { output: Res.Timber, work: 3, batch: 5, gather: 'tree' },
  },
  quarry: {
    kind: 'quarry',
    name: 'Quarry & Batch Plant',
    description: 'Must touch a rock outcrop. Cuts stone and mixes concrete for walls and bunkers.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 500,
    buildable: true,
    category: 'industry',
    cost: { timber: 12, funds: 20 },
    jobs: 1,
    producer: { output: Res.Concrete, work: 9, batch: 5 },
    requires: 'nearRock',
  },
  orchard: {
    kind: 'orchard',
    name: 'Orchard',
    description: 'Must be built on fertile ground near water. Grows produce.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 250,
    buildable: true,
    category: 'food',
    cost: { timber: 6 },
    jobs: 1,
    producer: { output: Res.Produce, work: 20, batch: 5 },
    requires: 'fertile',
  },
  ranch: {
    kind: 'ranch',
    name: 'Goat Ranch',
    description: 'Raises goats for meat. Works on any open ground, but slower than an orchard.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 250,
    buildable: true,
    category: 'food',
    cost: { timber: 10, funds: 20 },
    jobs: 1,
    producer: { output: Res.Meat, work: 26, batch: 4 },
  },
  wall: { kind: 'wall', name: 'Concrete Wall', description: '', w: 1, h: 1, blocks: true, hp: 800, buildable: false, cost: {} },
  tower: { kind: 'tower', name: 'Watchtower', description: '', w: 2, h: 2, blocks: true, hp: 1000, buildable: false, cost: {} },
  floodlight: {
    kind: 'floodlight',
    name: 'Floodlight',
    description: '',
    w: 1,
    h: 1,
    blocks: true,
    hp: 150,
    buildable: false,
    cost: {},
  },
  gate: { kind: 'gate', name: 'Checkpoint Gate', description: '', w: 1, h: 1, blocks: false, hp: 1200, buildable: false, cost: {} },
};

export const BUILDABLE: StructureKind[] = (Object.keys(STRUCTURE_DEFS) as StructureKind[]).filter(
  (k) => STRUCTURE_DEFS[k].buildable,
);

/** Why a producer isn't producing (shown in the building panel). */
export type StructureStatus = 'ok' | 'noWorker' | 'noTrees' | 'storageFull' | 'paused';

export interface Structure {
  id: number;
  kind: StructureKind;
  owner: number;
  tx: number;
  tz: number;
  w: number;
  h: number;
  hp: number;
  /** Facing in radians (floodlight beam direction, gate orientation). */
  rot: number;
  /** Centre of the walkable tile workers use as the entrance. */
  doorX: number;
  doorZ: number;
  /** Unit ids of assigned workers. */
  workers: number[];
  /** Production toggle (paused buildings release their workers). */
  active: boolean;
  status: StructureStatus;
}

export function costText(c: Cost): string {
  const parts: string[] = [];
  if (c.timber) parts.push(`${c.timber} timber`);
  if (c.concrete) parts.push(`${c.concrete} concrete`);
  if (c.funds) parts.push(`$${c.funds}`);
  return parts.join(' · ') || 'free';
}
