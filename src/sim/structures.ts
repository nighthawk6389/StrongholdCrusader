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
  NVKit: 9,
  Fuel: 10,
  Launcher: 11,
} as const;
export type ResId = (typeof Res)[keyof typeof Res];
export const RES_COUNT = 12;

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
  res(Res.NVKit, 'nvkit', 'Night-ops kits', 'gear'),
  res(Res.Fuel, 'fuel', 'Fuel', 'materials'),
  res(Res.Launcher, 'launcher', 'AT launchers', 'gear'),
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
  [Res.NVKit]: 70,
  [Res.Fuel]: 8,
  [Res.Launcher]: 60,
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
  | 'floodlight'
  | 'searchlight'
  | 'sensor'
  | 'kennel'
  | 'generator'
  | 'guntower'
  | 'dronebay'
  | 'derrick'
  | 'motorpool'
  | 'mines'
  | 'ditch'
  | 'trench'
  | 'wire'
  | 'ramp'
  | 'contracts'
  | 'mortar';

export interface Cost {
  funds?: number;
  timber?: number;
  concrete?: number;
  steel?: number;
  fuel?: number;
}

/** Hard placement requirement. */
export type Requirement = 'none' | 'nearRock' | 'fertile' | 'besideWall' | 'onOil';

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

export type BuildCategory = 'core' | 'industry' | 'food' | 'defense' | 'military' | 'night';

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
  /** Power: positive = supply (generators need a worker), negative = demand. */
  power?: number;
  /** Acts as a lookout with this sight radius (tiles). */
  sight?: number;
  /** Light it casts at night when powered. */
  light?: { kind: 'flood' | 'search' | 'area'; range: number };
  /** Detects enemies within this radius in any light: 'motion' sees movers, 'dogs' sees everyone. */
  sensor?: { kind: 'motion' | 'dogs'; range: number };
  /** Mounted gun (gun towers): fires on its own while crewed; can be aimed by hand. */
  turret?: TurretSpec;
  /** Drone bay: how many drones it can keep in the air. */
  bay?: { capacity: number };
  /** Height a shot has to clear to pass over it (default: deck + parapet, else 2.2). */
  top?: number;
  /** Placed by dragging a line, one tile each (walls, minefields, ditches, trenches, wire). */
  line?: boolean;
  /** Ground trap or obstacle (see Traps). */
  trap?: 'mine' | 'ditch' | 'trench' | 'wire';
  /** Hidden from the enemy until spotted (minefields). */
  hidden?: boolean;
  /** Trains vehicles (crew from idle civilians). */
  vehicles?: boolean;
  /** Upgrades, in order: [level 2, level 3, ...]. */
  upgrades?: UpgradeSpec[];
  /** Mortar pit: lobs shells on its own (counter-battery first). */
  mortar?: MortarSpec;
}

export interface MortarSpec {
  range: number;
  minRange: number;
  /** Seconds between rounds. */
  cooldownSec: number;
  /** Shell speed (tiles/s along the ground) and miss distance at full range. */
  shellSpeed: number;
  scatter: number;
  blast: { damage: number; radius: number; structDamage: number };
  /** Enemy guns that fired within this many seconds are tracked by radar, seen or not. */
  trackSec: number;
}

/** One building upgrade (effects stack with earlier levels). */
export interface UpgradeSpec {
  name: string;
  description: string;
  cost: Cost;
  /** Multipliers. */
  hp?: number;
  storage?: number;
  /** Work time multiplier (below 1 = faster). */
  work?: number;
  light?: number;
  /** Rate of fire multiplier (mortar pits). */
  speed?: number;
  /** Additions. */
  housing?: number;
  power?: number;
  /** Becomes a different building (keeps its place and health share). */
  into?: StructureKind;
}

export interface TurretSpec {
  /** Base range in tiles (the tower's height adds to it). */
  range: number;
  /** Damage per round when you aim it yourself / when it fires on its own. */
  damage: number;
  autoDamage: number;
  /** Ticks between rounds (hand / auto). */
  cooldown: number;
  autoCooldown: number;
  /** Aim error (radians) when firing on its own. */
  spread: number;
  suppress: number;
  /** Belt size and seconds to swap belts (hand-aimed fire). */
  mag: number;
  reloadSec: number;
  /** Turn rate when tracking on its own (radians per second). */
  turn: number;
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
    power: 4,
    sight: 12,
    light: { kind: 'area', range: 5 },
    top: 3.4,
    upgrades: [
      {
        name: 'Fortified HQ',
        description: '50% tougher, stores 50% more, +4 power.',
        cost: { concrete: 30, steel: 10, funds: 100 },
        hp: 1.5,
        storage: 1.5,
        power: 4,
      },
    ],
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
    upgrades: [{ name: 'Apartment block', description: '+6 housing, sturdier.', cost: { timber: 10, concrete: 8 }, housing: 6, hp: 1.3 }],
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
    upgrades: [{ name: 'Warehouse', description: 'Stores 80% more.', cost: { timber: 12, concrete: 8 }, storage: 1.8 }],
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
    upgrades: [{ name: 'Cold store', description: 'Stores 80% more food.', cost: { timber: 10, concrete: 8, steel: 2 }, storage: 1.8 }],
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
    upgrades: [
      { name: 'Chainsaws', description: 'Cuts 30% faster.', cost: { steel: 3, funds: 20 }, work: 0.7 },
      { name: 'Log loader', description: 'Another 25% faster.', cost: { steel: 6, funds: 40 }, work: 0.75 },
    ],
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
    upgrades: [
      { name: 'Rock crusher', description: 'Mixes 30% faster.', cost: { steel: 4, funds: 25 }, work: 0.7 },
      { name: 'Batch mixer', description: 'Another 25% faster.', cost: { steel: 8, funds: 50 }, work: 0.75 },
    ],
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
    upgrades: [{ name: 'Irrigation', description: 'Grows 30% faster.', cost: { timber: 8, steel: 2 }, work: 0.7 }],
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
    upgrades: [{ name: 'Feed silo', description: 'Raises goats 30% faster.', cost: { timber: 10, steel: 2 }, work: 0.7 }],
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
    upgrades: [
      { name: 'Cutting torches', description: 'Salvages 30% faster.', cost: { concrete: 6, funds: 40 }, work: 0.7 },
      { name: 'Hydraulic press', description: 'Another 25% faster.', cost: { concrete: 10, steel: 6, funds: 60 }, work: 0.75 },
    ],
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
      { output: Res.NVKit, input: Res.Steel, inputAmount: 3, work: 15 },
      { output: Res.Launcher, input: Res.Steel, inputAmount: 4, work: 16 },
    ],
    upgrades: [{ name: 'Assembly line', description: 'Builds weapons 30% faster.', cost: { concrete: 10, steel: 8 }, work: 0.7 }],
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
    upgrades: [{ name: 'Secure armory', description: 'Holds 80% more, sturdier.', cost: { concrete: 10, steel: 4 }, storage: 1.8, hp: 1.4 }],
  },
  contracts: {
    kind: 'contracts',
    name: 'Contracts Office',
    description: 'Hire ready-made PMC teams for cash: they arrive at once and need no civilians or weapons. One contract a minute.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 700,
    buildable: true,
    category: 'military',
    cost: { timber: 20, concrete: 10, funds: 120 },
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
    line: true,
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
    sight: 18,
    upgrades: [
      {
        name: 'Mount a heavy machine gun',
        description: 'Turns it into a Gun Tower.',
        cost: { concrete: 2, steel: 10 },
        into: 'guntower',
      },
    ],
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
    sight: 12,
    upgrades: [{ name: 'Steel doors', description: '60% tougher.', cost: { concrete: 8, steel: 6 }, hp: 1.6 }],
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
    description: 'Lights a wide cone outward at night (2 power). Enemies in the light can be seen.',
    w: 1,
    h: 1,
    blocks: true,
    hp: 200,
    buildable: true,
    category: 'night',
    cost: { concrete: 2, steel: 2 },
    power: -2,
    light: { kind: 'flood', range: 11 },
    top: 0.5,
    upgrades: [{ name: 'High-power lamp', description: 'Lights 45% further.', cost: { steel: 2 }, light: 1.45 }],
  },
  searchlight: {
    kind: 'searchlight',
    name: 'Searchlight Tower',
    description: 'A long beam that sweeps the approach at night (3 power). Hard to sneak past, easy to spot.',
    w: 2,
    h: 2,
    blocks: true,
    hp: 450,
    buildable: true,
    category: 'night',
    cost: { concrete: 10, steel: 6 },
    power: -3,
    sight: 10,
    light: { kind: 'search', range: 24 },
    upgrades: [{ name: 'Xenon lamp', description: 'Beam reaches 35% further.', cost: { steel: 4 }, light: 1.35 }],
  },
  sensor: {
    kind: 'sensor',
    name: 'Motion Sensor',
    description: 'Detects anything moving within 11 tiles, light or not, stealthy or not (1 power).',
    w: 1,
    h: 1,
    blocks: true,
    hp: 120,
    buildable: true,
    category: 'night',
    cost: { steel: 4, concrete: 2 },
    power: -1,
    sensor: { kind: 'motion', range: 11 },
    top: 0.6,
  },
  kennel: {
    kind: 'kennel',
    name: 'K9 Kennel',
    description: 'Guard dogs sniff out anyone within 8 tiles, even operators lying still. No power needed.',
    w: 2,
    h: 2,
    blocks: true,
    hp: 300,
    buildable: true,
    category: 'night',
    cost: { timber: 10, funds: 30 },
    sensor: { kind: 'dogs', range: 8 },
    top: 1.2,
  },
  generator: {
    kind: 'generator',
    name: 'Generator',
    description: 'Supplies 12 power to your lights and sensors while a worker keeps it running.',
    w: 2,
    h: 2,
    blocks: true,
    hp: 450,
    buildable: true,
    category: 'night',
    cost: { timber: 12, concrete: 8, steel: 4 },
    jobs: 1,
    power: 12,
    top: 1.2,
    upgrades: [{ name: 'Turbine', description: '+8 power.', cost: { concrete: 6, steel: 8 }, power: 8 }],
  },
  guntower: {
    kind: 'guntower',
    name: 'Gun Tower',
    description:
      'A watchtower with a heavy machine gun. It fires on its own while one of your soldiers is up top, and you can take control to aim it yourself. Weak spots: snipe the crew, or hit it with rockets, tank shells, artillery or strike drones.',
    w: 2,
    h: 2,
    blocks: true,
    hp: 1500,
    buildable: true,
    category: 'defense',
    cost: { concrete: 16, timber: 4, steel: 10 },
    deckH: 2.75,
    armored: true,
    sight: 18,
    turret: {
      range: 20,
      damage: 22,
      autoDamage: 7,
      cooldown: 2,
      autoCooldown: 4,
      spread: 0.08,
      suppress: 2.2,
      mag: 120,
      reloadSec: 5,
      turn: 2.6,
    },
    upgrades: [{ name: 'Armor plating', description: '60% tougher.', cost: { concrete: 10, steel: 8 }, hp: 1.6 }],
  },
  dronebay: {
    kind: 'dronebay',
    name: 'Drone Bay',
    description: 'Launches recon and strike drones (up to 4 in the air) and recharges them. Needs 2 power.',
    w: 2,
    h: 2,
    blocks: true,
    hp: 450,
    buildable: true,
    category: 'military',
    cost: { timber: 8, concrete: 6, steel: 6 },
    power: -2,
    bay: { capacity: 4 },
    top: 1.3,
  },
  derrick: {
    kind: 'derrick',
    name: 'Oil Derrick',
    description: 'Pumps fuel for vehicles and fuel trenches. Must sit on an oil seep (the dark patches).',
    w: 2,
    h: 2,
    blocks: true,
    hp: 400,
    buildable: true,
    category: 'industry',
    cost: { timber: 10, steel: 4 },
    jobs: 1,
    producer: { output: Res.Fuel, work: 10, batch: 4 },
    requires: 'onOil',
    top: 2.6,
    upgrades: [{ name: 'Second pump', description: 'Pumps 35% faster.', cost: { steel: 8, funds: 40 }, work: 0.65 }],
  },
  motorpool: {
    kind: 'motorpool',
    name: 'Motor Pool',
    description: 'Builds armored cars, battle tanks and howitzers from steel, fuel and funds. An idle civilian crews each one.',
    w: 3,
    h: 3,
    blocks: true,
    hp: 900,
    buildable: true,
    category: 'military',
    cost: { timber: 16, concrete: 12, steel: 8 },
    vehicles: true,
  },
  mines: {
    kind: 'mines',
    name: 'Minefield',
    description: 'Drag to lay mines. Hidden from the enemy; goes off under the first enemy to step on it (tanks too). Engineers and dogs find them.',
    w: 1,
    h: 1,
    blocks: false,
    hp: 60,
    buildable: true,
    category: 'defense',
    cost: { steel: 2 },
    top: 0.05,
    line: true,
    trap: 'mine',
    hidden: true,
  },
  ditch: {
    kind: 'ditch',
    name: 'Anti-Tank Ditch',
    description: 'Drag to dig a ditch nobody can cross, tanks included. Bullets fly over it. Enemy engineers can fill it in.',
    w: 1,
    h: 1,
    blocks: true,
    hp: 500,
    buildable: true,
    category: 'defense',
    cost: { funds: 3 },
    armored: true,
    top: 0,
    line: true,
    trap: 'ditch',
  },
  trench: {
    kind: 'trench',
    name: 'Fuel Trench',
    description: 'Drag to pour a trench of fuel. Select it and Ignite (or hit it with a flare) to set it ablaze: it burns anyone standing in it.',
    w: 1,
    h: 1,
    blocks: false,
    hp: 100,
    buildable: true,
    category: 'defense',
    cost: { fuel: 2 },
    top: 0.05,
    line: true,
    trap: 'trench',
  },
  wire: {
    kind: 'wire',
    name: 'Razor Wire',
    description: 'Drag to string wire: enemy infantry crossing it slow to a crawl. Vehicles flatten it.',
    w: 1,
    h: 1,
    blocks: false,
    hp: 80,
    buildable: true,
    category: 'defense',
    cost: { steel: 1 },
    top: 0.4,
    line: true,
    trap: 'wire',
  },
  mortar: {
    kind: 'mortar',
    name: 'Mortar Pit',
    description:
      'Sandbagged mortar with a counter-battery radar. It fires on its own: first at any enemy gun that has shelled within reach (seen or not), then at enemies your side can see. Outranges howitzers a little.',
    w: 2,
    h: 2,
    blocks: true,
    hp: 900,
    buildable: true,
    category: 'defense',
    cost: { concrete: 12, timber: 4, steel: 8 },
    armored: true,
    sight: 10,
    top: 0.9,
    mortar: {
      range: 34,
      minRange: 6,
      cooldownSec: 5,
      shellSpeed: 14,
      scatter: 2.0,
      blast: { damage: 70, radius: 2.2, structDamage: 140 },
      trackSec: 20,
    },
    upgrades: [{ name: 'Second tube', description: 'Fires 40% faster.', cost: { concrete: 6, steel: 8 }, speed: 1.4 }],
  },
  ramp: {
    kind: 'ramp',
    name: 'Assault Ramp',
    description: 'Pushed against a wall by a Breacher: infantry can climb it onto the wall top. Destroy it to close the way.',
    w: 1,
    h: 1,
    blocks: false,
    hp: 450,
    buildable: false,
    category: 'defense',
    cost: {},
    deckH: 0.8,
  },
};

/** Height a shot must clear to pass over a structure of this kind (above the ground it stands on). */
export function structureTop(kind: StructureKind): number {
  const d = STRUCTURE_DEFS[kind];
  if (d.top !== undefined) return d.top;
  if (d.deckH !== undefined) return d.deckH + 0.45;
  return 2.2;
}

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
  /** Lights and sensors: currently receiving power. */
  powered: boolean;
  /** Gun towers / searchlights: current aim (radians). */
  aim: number;
  /** Gun towers: ticks until the next round. */
  cooldown: number;
  /** Gun towers: rounds left in the belt and seconds left swapping it. */
  ammo: number;
  reload: number;
  /** Gun towers: unit it's tracking (-1 = none). */
  target: number;
  /** Aimed by the player until this tick (gun towers, searchlights). */
  manualUntil: number;
  /** Fuel trenches: seconds left burning (0 = not lit). */
  burn: number;
  /** Minefields: bitmask of sides that have spotted it (1 << owner). */
  seenBy: number;
  /** Minefields: seconds of defusing by enemy engineers so far. */
  defuse: number;
  /** Upgrade level (1 = as built). */
  level: number;
}

/** Product of a multiplier over the upgrades a structure has. */
export function upgradeMul(s: Structure, key: 'hp' | 'storage' | 'work' | 'light' | 'speed'): number {
  const ups = STRUCTURE_DEFS[s.kind].upgrades;
  let m = 1;
  for (let k = 0; ups && k < (s.level ?? 1) - 1 && k < ups.length; k++) m *= ups[k][key] ?? 1;
  return m;
}

/** Sum of an addition over the upgrades a structure has. */
export function upgradeAdd(s: Structure, key: 'housing' | 'power'): number {
  const ups = STRUCTURE_DEFS[s.kind].upgrades;
  let a = 0;
  for (let k = 0; ups && k < (s.level ?? 1) - 1 && k < ups.length; k++) a += ups[k][key] ?? 0;
  return a;
}

export function maxHp(s: Structure): number {
  return STRUCTURE_DEFS[s.kind].hp * upgradeMul(s, 'hp');
}

/** The next upgrade available, or null. */
export function nextUpgrade(s: Structure): UpgradeSpec | null {
  return STRUCTURE_DEFS[s.kind].upgrades?.[(s.level ?? 1) - 1] ?? null;
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
  if (c.fuel) parts.push(`${c.fuel} fuel`);
  if (c.funds) parts.push(`$${c.funds}`);
  return parts.join(' · ') || 'free';
}
