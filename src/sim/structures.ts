/** Structure (building) definitions and runtime records. Data-driven: tweak numbers here to balance. */

// ------------------------------------------------------------------ resources

export const Res = {
  Timber: 0,
  Concrete: 1,
  Produce: 2,
  Meat: 3,
  Steel: 4,
  Rifle: 5,
  MG: 6,
  Scoped: 7,
  Charges: 8,
} as const;
export type ResId = (typeof Res)[keyof typeof Res];
export const RES_COUNT = 9;

export type StoreKind = 'materials' | 'food' | 'gear';

export interface ResInfo {
  id: ResId;
  key: string;
  name: string;
  store: StoreKind;
  /** Kept for convenience: store === 'food'. */
  food: boolean;
}

const res = (id: ResId, key: string, name: string, store: StoreKind): ResInfo => ({
  id,
  key,
  name,
  store,
  food: store === 'food',
});

export const RES_INFO: ResInfo[] = [
  res(Res.Timber, 'timber', 'Timber', 'materials'),
  res(Res.Concrete, 'concrete', 'Concrete', 'materials'),
  res(Res.Produce, 'produce', 'Produce', 'food'),
  res(Res.Meat, 'meat', 'Meat', 'food'),
  res(Res.Steel, 'steel', 'Steel', 'materials'),
  res(Res.Rifle, 'rifle', 'Rifles', 'gear'),
  res(Res.MG, 'mg', 'Machine guns', 'gear'),
  res(Res.Scoped, 'scoped', 'Scoped rifles', 'gear'),
  res(Res.Charges, 'charges', 'Breach kits', 'gear'),
];

/** Trade Post buying price per unit (selling pays half). */
export const PRICES: Record<ResId, number> = {
  [Res.Timber]: 4,
  [Res.Concrete]: 6,
  [Res.Produce]: 4,
  [Res.Meat]: 5,
  [Res.Steel]: 10,
  [Res.Rifle]: 30,
  [Res.MG]: 60,
  [Res.Scoped]: 50,
  [Res.Charges]: 40,
};

export const FOOD_RES: ResId[] = RES_INFO.filter((r) => r.store === 'food').map((r) => r.id);
export const MATERIAL_RES: ResId[] = RES_INFO.filter((r) => r.store === 'materials').map((r) => r.id);
export const GEAR_RES: ResId[] = RES_INFO.filter((r) => r.store === 'gear').map((r) => r.id);

export function resIdsFor(kind: StoreKind): ResId[] {
  return kind === 'food' ? FOOD_RES : kind === 'gear' ? GEAR_RES : MATERIAL_RES;
}

// ------------------------------------------------------------------ structures

export type StructureKind =
  | 'hq'
  | 'hub'
  | 'market'
  | 'house'
  | 'depot'
  | 'rations'
  | 'lumber'
  | 'quarry'
  | 'orchard'
  | 'ranch'
  | 'scrapyard'
  | 'arms'
  | 'armory'
  | 'barracks'
  | 'wall'
  | 'tower'
  | 'gate'
  | 'stairs'
  | 'floodlight';

export interface Cost {
  funds?: number;
  timber?: number;
  concrete?: number;
  steel?: number;
}

/** Hard placement requirement. */
export type Requirement = 'none' | 'nearRock' | 'fertile' | 'besideWall';

export interface ProducerSpec {
  output: ResId;
  /** Seconds of work per cycle in daylight (night is slower). */
  work: number;
  /** Units carried to storage per trip. */
  batch: number;
  /** Lumber camps must first fetch a log from a tree. */
  gather?: 'tree';
}

export interface Recipe {
  output: ResId;
  /** Material fetched from a depot for each item. */
  input: ResId;
  inputAmount: number;
  /** Seconds of work per item in daylight. */
  work: number;
}

export type BuildCategory = 'core' | 'industry' | 'food' | 'defense' | 'military';

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
  storage?: { kind: StoreKind; capacity: number };
  jobs?: number;
  producer?: ProducerSpec;
  /** Selectable production (arms factory). */
  recipes?: Recipe[];
  requires?: Requirement;
  /** Height of the walkable top (walls, towers, gatehouses, stairs). */
  deckH?: number;
  /** Immune to small-arms fire (needs breach charges or heavy weapons). */
  armored?: boolean;
  /** Footprint swaps w/h when rotated a quarter turn (gatehouses). */
  rotatable?: boolean;
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
  market: {
    kind: 'market',
    name: 'Trade Post',
    description: 'Buy what you lack and sell your surplus. Selling pays half the buying price.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 600,
    buildable: true,
    category: 'core',
    cost: { timber: 20 },
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
  scrapyard: {
    kind: 'scrapyard',
    name: 'Scrap Yard',
    description: 'Salvages wrecks in the desert for steel. Works anywhere.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 400,
    buildable: true,
    category: 'industry',
    cost: { timber: 10, funds: 30 },
    jobs: 1,
    producer: { output: Res.Steel, work: 12, batch: 3 },
  },
  arms: {
    kind: 'arms',
    name: 'Arms Factory',
    description: 'Turns steel from your depots into weapons for the armory. Pick what it makes.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 500,
    buildable: true,
    category: 'military',
    cost: { timber: 14, concrete: 6 },
    jobs: 1,
    recipes: [
      { output: Res.Rifle, input: Res.Steel, inputAmount: 2, work: 9 },
      { output: Res.MG, input: Res.Steel, inputAmount: 4, work: 15 },
      { output: Res.Scoped, input: Res.Steel, inputAmount: 3, work: 13 },
      { output: Res.Charges, input: Res.Steel, inputAmount: 2, work: 11 },
    ],
  },
  armory: {
    kind: 'armory',
    name: 'Armory',
    description: 'Stores 60 weapons. Recruits are equipped from here.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 700,
    buildable: true,
    category: 'military',
    cost: { timber: 12, concrete: 4 },
    storage: { kind: 'gear', capacity: 60 },
  },
  barracks: {
    kind: 'barracks',
    name: 'Barracks',
    description: 'Trains idle civilians into soldiers using armory weapons and funds.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 900,
    buildable: true,
    category: 'military',
    cost: { timber: 15, concrete: 10 },
  },
  wall: {
    kind: 'wall',
    name: 'Concrete Wall',
    description: 'Drag to build a line. Troops on top get range and cover. Only breach charges hurt it.',
    w: 1,
    h: 1,
    blocks: true,
    hp: 900,
    buildable: true,
    category: 'defense',
    cost: { concrete: 1 },
    deckH: 1.55,
    armored: true,
  },
  tower: {
    kind: 'tower',
    name: 'Watchtower',
    description: 'Tall firing platform: the best range and cover. Reach it from walls or stairs.',
    w: 2,
    h: 2,
    blocks: true,
    hp: 1400,
    buildable: true,
    category: 'defense',
    cost: { concrete: 14, timber: 4 },
    deckH: 2.75,
    armored: true,
  },
  gate: {
    kind: 'gate',
    name: 'Gatehouse',
    description: 'Opens for your troops, stays shut to the enemy. Walkable on top. R rotates.',
    w: 3,
    h: 1,
    blocks: true,
    hp: 1600,
    buildable: true,
    category: 'defense',
    cost: { concrete: 12, timber: 6 },
    deckH: 2.05,
    armored: true,
    rotatable: true,
  },
  stairs: {
    kind: 'stairs',
    name: 'Stairs',
    description: 'Lets troops climb onto an adjacent wall, tower or gatehouse.',
    w: 1,
    h: 1,
    blocks: false,
    hp: 300,
    buildable: true,
    category: 'defense',
    cost: { concrete: 1 },
    deckH: 0.8,
    requires: 'besideWall',
  },
  floodlight: {
    kind: 'floodlight',
    name: 'Floodlight',
    description: 'Lights the ground at night.',
    w: 1,
    h: 1,
    blocks: true,
    hp: 150,
    buildable: false,
    cost: {},
  },
};

export const BUILDABLE: StructureKind[] = (Object.keys(STRUCTURE_DEFS) as StructureKind[]).filter(
  (k) => STRUCTURE_DEFS[k].buildable,
);

/** Why a producer isn't producing (shown in the building panel). */
export type StructureStatus = 'ok' | 'noWorker' | 'noTrees' | 'storageFull' | 'paused' | 'noInput';

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
  /** Selected recipe index (arms factory). */
  recipe: number;
}

/** Footprint size for a kind at a rotation (gatehouses swap w/h at a quarter turn). */
export function footprint(kind: StructureKind, rot: number): { w: number; h: number } {
  const d = STRUCTURE_DEFS[kind];
  const quarter = Math.abs(Math.round(rot / (Math.PI / 2))) % 2 === 1;
  return d.rotatable && quarter ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
}

export function costText(c: Cost): string {
  const parts: string[] = [];
  if (c.timber) parts.push(`${c.timber} timber`);
  if (c.concrete) parts.push(`${c.concrete} concrete`);
  if (c.steel) parts.push(`${c.steel} steel`);
  if (c.funds) parts.push(`$${c.funds}`);
  return parts.join(' · ') || 'free';
}
