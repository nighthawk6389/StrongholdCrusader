/** Data-driven unit definitions. Tweak numbers here to balance. */

import { Res, type ResId } from './structures';

export interface Artillery {
  /** Can't hit anything closer than this. */
  minRange: number;
  /** Shell speed (tiles/s along the ground). */
  shellSpeed: number;
  /** Miss distance at full range (tiles). */
  scatter: number;
  /** Seconds to set up after moving before it can fire. */
  deploySec: number;
  blast: { damage: number; radius: number; structDamage: number };
}

export interface UnitType {
  id: number;
  key: string;
  name: string;
  /** Tiles per second. */
  speed: number;
  hp: number;
  /** Collision radius in tiles. */
  radius: number;

  // --- Player-aimed fire (over-the-shoulder control)
  range: number;
  damage: number;
  /** Ticks between shots. */
  cooldown: number;

  // --- Automatic fire (AI / idle units)
  autoRange: number;
  autoDamage: number;
  /** Base ticks between shots, plus up to `autoJitter` random ticks. */
  autoCooldown: number;
  autoJitter: number;
  /** Aim error (radians) at long range when steady. */
  spread: number;
  /** Seconds of suppression applied to whoever this unit hits. */
  suppress: number;
  /** Damage per shot vs non-armoured buildings (walls, towers and gates are immune). */
  structDamage: number;
  /** Breach charges carried (engineers, SF operators). */
  charges: number;
  /** Seconds to plant a charge. */
  plantSec: number;

  // --- Vision & stealth (M4)
  /** Sight radius in full light (tiles). */
  sight: number;
  /** Fraction of sight kept in darkness (1 = night vision / thermal). */
  nightVision: number;
  /** Thermal camera: stealth doesn't hide anything from it. */
  thermal: boolean;
  /** Multiplier on enemies' detection range in darkness (1 = normal, lower = stealthier). */
  stealth: number;
  /** Silenced weapons don't give the shooter's position away. */
  silenced: boolean;
  /** Can scale walls with grapnels (no stairs needed). */
  climber: boolean;

  // --- Direct control (M5)
  /** Rounds per magazine when you fire it yourself (0 = no weapon). */
  mag: number;
  /** Seconds to reload a magazine. */
  reloadSec: number;
  /** Damage multiplier for a head hit under direct control. */
  headshot: number;
  /** Camera zoom while aiming (scopes zoom further). */
  zoom: number;

  // --- Drones (M5)
  /** Cruising height above the ground; 0 = a ground unit. Flyers ignore walls and terrain. */
  fly: number;
  /** Seconds of flight per charge. */
  battery: number;
  /** One-way strike drones: warhead that goes off on impact. */
  blast: { damage: number; radius: number; structDamage: number } | null;

  // --- Vehicles & heavy weapons (M6)
  /** Ground vehicle: built at the Motor Pool, never climbs or takes stairs, flattens wire. */
  vehicle: boolean;
  /** Share of small-arms damage that gets through (1 = soft target). AP weapons and explosives ignore it. */
  armor: number;
  /** Armor-piercing weapon (AT rockets, tank guns). */
  ap: boolean;
  /** Damage multiplier against anything that isn't a vehicle (shaped charges are poor anti-personnel). */
  infantryMul: number;
  /** Splash radius around each hit (tiles; 0 = none). */
  splash: number;
  /** Can damage walls, towers and gates by shooting at them. */
  siege: boolean;
  /** Indirect fire: lobs shells over walls after deploying. */
  artillery: Artillery | null;
  /** Hitbox for aimed fire as [radius, height] (null = a soldier's body and head). */
  hitbox: [number, number] | null;
  /** Extra materials to build one (vehicles). */
  steel: number;
  fuel: number;
  /** Dozer blade: plows mines aside, fills ditches fast, and pushes assault ramps (`charges`) against walls. */
  dozer: boolean;

  armed: boolean;
  controllable: boolean;
  selectable: boolean;
  /** Gear consumed from the armory to recruit one (null = can't be recruited). */
  gear: ResId | null;
  /** Funds to recruit one. */
  funds: number;
  blurb: string;
}

const base = {
  radius: 0.28,
  suppress: 0,
  structDamage: 4,
  charges: 0,
  plantSec: 4,
  sight: 16,
  nightVision: 0.35,
  thermal: false,
  stealth: 1,
  silenced: false,
  climber: false,
  mag: 30,
  reloadSec: 2.2,
  headshot: 2,
  zoom: 1.6,
  fly: 0,
  battery: 0,
  blast: null,
  vehicle: false,
  armor: 1,
  ap: false,
  infantryMul: 1,
  splash: 0,
  siege: false,
  artillery: null as Artillery | null,
  hitbox: null as [number, number] | null,
  steel: 0,
  fuel: 0,
  dozer: false,
  armed: true,
  controllable: true,
  selectable: true,
};

export const UNIT_TYPES: UnitType[] = [
  {
    ...base,
    id: 0,
    key: 'rifleman',
    name: 'Rifleman',
    speed: 2.4,
    hp: 100,
    range: 24,
    damage: 34,
    cooldown: 4,
    autoRange: 14,
    autoDamage: 16,
    autoCooldown: 14,
    autoJitter: 6,
    spread: 0.07,
    gear: Res.Rifle,
    funds: 20,
    blurb: 'Reliable all-rounder.',
  },
  {
    ...base,
    id: 1,
    key: 'commander',
    name: 'Commander',
    speed: 2.6,
    hp: 400,
    radius: 0.3,
    range: 24,
    damage: 40,
    cooldown: 3,
    autoRange: 15,
    autoDamage: 20,
    autoCooldown: 12,
    autoJitter: 4,
    spread: 0.06,
    nightVision: 0.5,
    reloadSec: 2,
    gear: null,
    funds: 0,
    blurb: 'If the Commander dies, you lose.',
  },
  {
    ...base,
    id: 2,
    key: 'civilian',
    name: 'Civilian',
    speed: 2.5,
    hp: 40,
    radius: 0.24,
    range: 0,
    damage: 0,
    cooldown: 0,
    autoRange: 0,
    autoDamage: 0,
    autoCooldown: 0,
    autoJitter: 0,
    spread: 0,
    structDamage: 0,
    sight: 8,
    nightVision: 0.3,
    mag: 0,
    armed: false,
    controllable: false,
    selectable: false,
    gear: null,
    funds: 0,
    blurb: '',
  },
  {
    ...base,
    id: 3,
    key: 'gunner',
    name: 'Machine Gunner',
    speed: 2.0,
    hp: 110,
    radius: 0.3,
    range: 22,
    damage: 16,
    cooldown: 2,
    autoRange: 15,
    autoDamage: 7,
    autoCooldown: 3,
    autoJitter: 2,
    spread: 0.13,
    suppress: 1.6,
    structDamage: 3,
    mag: 100,
    reloadSec: 4.5,
    gear: Res.MG,
    funds: 35,
    blurb: 'Pins infantry down: suppressed troops move and shoot worse.',
  },
  {
    ...base,
    id: 4,
    key: 'marksman',
    name: 'Marksman',
    speed: 2.3,
    hp: 80,
    range: 34,
    damage: 75,
    cooldown: 16,
    autoRange: 22,
    autoDamage: 48,
    autoCooldown: 40,
    autoJitter: 10,
    spread: 0.015,
    suppress: 0.4,
    structDamage: 2,
    sight: 22,
    nightVision: 0.8,
    mag: 5,
    reloadSec: 2.8,
    headshot: 3,
    zoom: 4,
    gear: Res.Scoped,
    funds: 40,
    blurb: 'Long range, hits hard, fires slowly.',
  },
  {
    ...base,
    id: 5,
    key: 'engineer',
    name: 'Combat Engineer',
    speed: 2.4,
    hp: 90,
    range: 16,
    damage: 22,
    cooldown: 8,
    autoRange: 10,
    autoDamage: 9,
    autoCooldown: 18,
    autoJitter: 6,
    spread: 0.1,
    structDamage: 2,
    charges: 2,
    sight: 14,
    mag: 20,
    reloadSec: 2,
    gear: Res.Charges,
    funds: 30,
    blurb: 'Blows breaches in walls and gates (2 charges each).',
  },
  {
    ...base,
    id: 6,
    key: 'operator',
    name: 'SF Operator',
    speed: 2.8,
    hp: 110,
    range: 22,
    damage: 32,
    cooldown: 5,
    autoRange: 14,
    autoDamage: 20,
    autoCooldown: 10,
    autoJitter: 4,
    spread: 0.05,
    structDamage: 2,
    charges: 1,
    plantSec: 2.5,
    sight: 18,
    nightVision: 1,
    stealth: 0.45,
    silenced: true,
    climber: true,
    reloadSec: 1.8,
    zoom: 2.2,
    gear: Res.NVKit,
    funds: 60,
    blurb: 'Night vision, silenced, hard to spot in the dark. Climbs walls; one demolition charge.',
  },
  {
    ...base,
    id: 7,
    key: 'recon',
    name: 'Recon Drone',
    speed: 7,
    hp: 45,
    radius: 0.32,
    range: 0,
    damage: 0,
    cooldown: 0,
    autoRange: 0,
    autoDamage: 0,
    autoCooldown: 0,
    autoJitter: 0,
    spread: 0,
    structDamage: 0,
    sight: 24,
    nightVision: 1,
    thermal: true,
    stealth: 0.6,
    mag: 0,
    zoom: 2.5,
    fly: 7,
    battery: 210,
    armed: false,
    gear: null,
    funds: 0,
    blurb: 'Thermal camera in the sky: sees through stealth and darkness, flies over walls, spots for your troops. Unarmed.',
  },
  {
    ...base,
    id: 8,
    key: 'strike',
    name: 'Strike Drone',
    speed: 9,
    hp: 40,
    radius: 0.3,
    range: 0,
    damage: 0,
    cooldown: 0,
    autoRange: 0,
    autoDamage: 0,
    autoCooldown: 0,
    autoJitter: 0,
    spread: 0,
    structDamage: 0,
    sight: 12,
    nightVision: 1,
    stealth: 0.6,
    mag: 0,
    zoom: 1.6,
    fly: 6,
    battery: 150,
    blast: { damage: 150, radius: 3.0, structDamage: 480 },
    armed: false,
    gear: null,
    funds: 0,
    blurb: 'One-way attack drone: dives onto its target and explodes. Hurts walls and gates too.',
  },
  {
    ...base,
    id: 9,
    key: 'car',
    name: 'Armored Car',
    speed: 4.2,
    hp: 360,
    radius: 0.36,
    range: 22,
    damage: 14,
    cooldown: 2,
    autoRange: 17,
    autoDamage: 9,
    autoCooldown: 3,
    autoJitter: 2,
    spread: 0.1,
    suppress: 1.2,
    structDamage: 5,
    sight: 20,
    nightVision: 0.5,
    mag: 200,
    reloadSec: 5,
    vehicle: true,
    armor: 0.4,
    hitbox: [0.62, 1.1],
    gear: null,
    funds: 60,
    steel: 6,
    fuel: 4,
    blurb: 'Fast, armored scout with a machine gun. Rifles barely scratch it; mines and rockets do.',
  },
  {
    ...base,
    id: 10,
    key: 'tank',
    name: 'Battle Tank',
    speed: 2.1,
    hp: 1500,
    radius: 0.38,
    range: 30,
    damage: 170,
    cooldown: 60,
    autoRange: 20,
    autoDamage: 120,
    autoCooldown: 64,
    autoJitter: 8,
    spread: 0.025,
    suppress: 2,
    structDamage: 200,
    sight: 18,
    nightVision: 0.6,
    mag: 1,
    reloadSec: 3,
    zoom: 2.5,
    vehicle: true,
    armor: 0.12,
    ap: true,
    splash: 1.3,
    siege: true,
    hitbox: [0.85, 1.3],
    gear: null,
    funds: 160,
    steel: 20,
    fuel: 10,
    blurb: 'Heavy armor and a main gun that knocks down walls and gates. Only rockets, mines and charges hurt it.',
  },
  {
    ...base,
    id: 11,
    key: 'howitzer',
    name: 'Howitzer',
    speed: 1.5,
    hp: 320,
    radius: 0.36,
    range: 30,
    damage: 0,
    cooldown: 120,
    autoRange: 30,
    autoDamage: 0,
    autoCooldown: 130,
    autoJitter: 10,
    spread: 0,
    structDamage: 0,
    sight: 10,
    mag: 1,
    reloadSec: 6,
    vehicle: true,
    armor: 0.5,
    artillery: { minRange: 9, shellSpeed: 16, scatter: 2.2, deploySec: 3, blast: { damage: 80, radius: 2.4, structDamage: 260 } },
    hitbox: [0.7, 1.0],
    gear: null,
    funds: 130,
    steel: 16,
    fuel: 4,
    blurb: 'Deploys, then lobs shells over walls at anything your side can see, from a little beyond gun-tower range. Weak up close; mortar pits fire back.',
  },
  {
    ...base,
    id: 12,
    key: 'at',
    name: 'AT Specialist',
    speed: 2.3,
    hp: 100,
    range: 24,
    damage: 170,
    cooldown: 30,
    autoRange: 17,
    autoDamage: 140,
    autoCooldown: 56,
    autoJitter: 10,
    spread: 0.03,
    structDamage: 70,
    mag: 1,
    reloadSec: 2.6,
    zoom: 2,
    ap: true,
    infantryMul: 0.45,
    splash: 0.5,
    siege: true,
    gear: Res.Launcher,
    funds: 35,
    blurb: 'Anti-tank rockets: the answer to armor. Also dents walls and gates.',
  },
  {
    ...base,
    id: 13,
    key: 'breacher',
    name: 'Breacher',
    speed: 2.0,
    hp: 1200,
    radius: 0.38,
    range: 16,
    damage: 10,
    cooldown: 4,
    autoRange: 12,
    autoDamage: 6,
    autoCooldown: 5,
    autoJitter: 3,
    spread: 0.07,
    structDamage: 2,
    charges: 2,
    plantSec: 5,
    sight: 14,
    nightVision: 0.5,
    mag: 100,
    reloadSec: 4,
    vehicle: true,
    armor: 0.14,
    dozer: true,
    hitbox: [0.85, 1.2],
    gear: null,
    funds: 120,
    steel: 16,
    fuel: 6,
    blurb: 'Armored dozer: plows through minefields, fills ditches in seconds and pushes assault ramps against enemy walls (2 ramps) so infantry can climb over.',
  },
];

export const UnitKind = {
  Rifleman: 0,
  Commander: 1,
  Civilian: 2,
  Gunner: 3,
  Marksman: 4,
  Engineer: 5,
  Operator: 6,
  ReconDrone: 7,
  StrikeDrone: 8,
  ArmoredCar: 9,
  Tank: 10,
  Howitzer: 11,
  AT: 12,
  Breacher: 13,
} as const;

/** Vehicles the Motor Pool builds, in menu order. */
export const VEHICLES = [UnitKind.ArmoredCar, UnitKind.Tank, UnitKind.Howitzer, UnitKind.Breacher];

/** Drone kinds a Drone Bay can launch, in menu order. */
export const DRONE_KINDS = [UnitKind.ReconDrone, UnitKind.StrikeDrone];

/** Units the barracks can train, in menu order. */
export const RECRUITABLE = [UnitKind.Rifleman, UnitKind.Gunner, UnitKind.Marksman, UnitKind.Engineer, UnitKind.AT, UnitKind.Operator];
