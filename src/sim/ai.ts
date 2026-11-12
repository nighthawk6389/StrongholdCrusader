import { ringBlueprint, ringReserve, type Piece, type Side } from './blueprint';
import { Tile } from './map';
import type { Controller, Sim, SimEvent } from './sim';
import { GEAR_RES, Res, STRUCTURE_DEFS, footprint, type ResId, type Structure, type StructureKind } from './structures';
import { RATION_LEVELS, TAX_LEVELS } from './economy';
import { CONTRACTS } from './contracts';
import { RECRUITABLE, UNIT_TYPES, UnitKind } from './unitTypes';
import { RETURN_AT } from './drones';
import { CYCLE_SEC } from './clock';
import { Order, Task } from './units';

// ------------------------------------------------------------------ tuning

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AiTuning {
  /** Ticks between decisions. */
  thinkTicks: number;
  /** Earliest first assault (seconds). */
  firstAttack: number;
  attackSize: number;
  attackGrowth: number;
  /** Minimum gap between assaults (seconds). */
  attackGap: number;
  /** Soldiers kept on the walls. */
  garrison: number;
  /** Extra starting resources. */
  bonus: { timber: number; concrete: number; funds: number };
}

export const DIFFICULTY: Record<Difficulty, AiTuning> = {
  easy: {
    thinkTicks: 40,
    firstAttack: 560,
    attackSize: 6,
    attackGrowth: 3,
    attackGap: 210,
    garrison: 3,
    bonus: { timber: 0, concrete: 0, funds: 0 },
  },
  normal: {
    thinkTicks: 12,
    firstAttack: 330,
    attackSize: 10,
    attackGrowth: 5,
    attackGap: 125,
    garrison: 6,
    bonus: { timber: 60, concrete: 40, funds: 180 },
  },
  hard: {
    thinkTicks: 6,
    firstAttack: 250,
    attackSize: 11,
    attackGrowth: 5,
    attackGap: 90,
    garrison: 7,
    bonus: { timber: 140, concrete: 100, funds: 450 },
  },
};

// ------------------------------------------------------------------ personality

type Near = 'trees' | 'fertile' | 'rock' | 'oil' | 'home' | 'producers';

interface BuildStep {
  kind: StructureKind | 'fortFront' | 'fortRing' | 'fortOuter' | 'nightKit' | 'gunTowers' | 'traps' | 'searchlights';
  /** Target number of this kind (cumulative), so destroyed buildings get rebuilt. */
  count?: number;
  near?: Near;
  /** Steel-hungry extras normally wait for spare steel; eager ones don't. */
  eager?: boolean;
}

/** Multipliers on the difficulty's attack timing and size. */
interface Tempo {
  firstAttack?: number;
  attackSize?: number;
  attackGap?: number;
  attackGrowth?: number;
  garrison?: number;
}

type LineKey = 'start' | 'attack' | 'lostBuilding' | 'hqHit' | 'attackFailed' | 'win' | 'lose';

export type OpponentKey = 'sarge' | 'jackal' | 'engineer' | 'warden' | 'broker' | 'nightshade' | 'quartermaster' | 'varga';

export interface Personality {
  key: OpponentKey;
  name: string;
  /** One-line style, for menus. */
  title: string;
  blurb: string;
  /** Relative weights of the army mix. */
  mix: Partial<Record<number, number>>;
  build: BuildStep[];
  /** Vehicles wanted from the motor pool (Normal and up), in priority order: [kind, on Normal, on Hard]. */
  armor: [number, number, number][];
  tempo?: Tempo;
  /** Small, fast raids on farms and work sites outside the enemy's walls. */
  raids?: { size: number; every: number; from: number };
  /** Gun towers on every side, not just by the front gate. */
  extraGunTowers?: boolean;
  /** Hires PMC teams with spare cash. */
  contracts?: boolean;
  /** Runs high taxes and sells surplus hard. */
  trader?: boolean;
  /** Main attacks wait for darkness (unless overwhelming); special forces raid twice a night, four at a time. */
  nightOps?: boolean;
  /** A second, outer ring of walls (build step 'fortOuter'). */
  outerRing?: boolean;
  /** Lights the fuel trenches when the enemy walks into them. */
  ignites?: boolean;
  /** Upgrade priorities (default: producers and housing). */
  upgrades?: StructureKind[];
  lines: Record<LineKey, string[]> & {
    raid?: string[];
    hire?: string[];
    /** Signature lines: once early on, then now and again in place of an attack line. */
    catchphrase?: string[];
    /** Named lead tank (see `namedTank`): first deployed, leading an attack, destroyed, replaced ({n} = "Second"…). */
    tankNew?: string[];
    tankAttack?: string[];
    tankLost?: string[];
    tankBack?: string[];
  };
  /** The commander names her first tank and keeps a replacement going (Duchess Varga's Rosie). */
  namedTank?: string;
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
/** "Second", "Third", … "Tenth", then "11th", "12th"… */
export function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

function withTempo(t: AiTuning, m: Tempo = {}): AiTuning {
  return {
    ...t,
    firstAttack: Math.round(t.firstAttack * (m.firstAttack ?? 1)),
    attackSize: Math.max(4, Math.round(t.attackSize * (m.attackSize ?? 1))),
    attackGap: Math.round(t.attackGap * (m.attackGap ?? 1)),
    attackGrowth: Math.max(1, Math.round(t.attackGrowth * (m.attackGrowth ?? 1))),
    garrison: Math.max(2, Math.round(t.garrison * (m.garrison ?? 1))),
  };
}

/** Old Sarge: balanced, methodical, walls up early, steady infantry pushes. */
export const OLD_SARGE: Personality = {
  key: 'sarge',
  name: 'Old Sarge',
  title: 'Balanced veteran',
  blurb: 'Walls up early, then steady infantry pushes with a tank or two. A fair first opponent.',
  mix: { [UnitKind.Rifleman]: 5, [UnitKind.Gunner]: 2, [UnitKind.Marksman]: 1, [UnitKind.Engineer]: 2, [UnitKind.AT]: 1, [UnitKind.Operator]: 1 },
  build: [
    { kind: 'lumber', count: 1, near: 'trees' },
    { kind: 'orchard', count: 1, near: 'fertile' },
    { kind: 'quarry', count: 1, near: 'rock' },
    { kind: 'lumber', count: 2, near: 'trees' },
    { kind: 'house', count: 3, near: 'home' },
    { kind: 'scrapyard', count: 1, near: 'home' },
    { kind: 'market', count: 1, near: 'home' },
    { kind: 'quarry', count: 2, near: 'rock' },
    { kind: 'ranch', count: 1, near: 'home' },
    { kind: 'arms', count: 1, near: 'home' },
    { kind: 'fortFront' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'nightKit' },
    { kind: 'depot', count: 2, near: 'producers' },
    { kind: 'house', count: 4, near: 'home' },
    { kind: 'orchard', count: 2, near: 'fertile' },
    { kind: 'gunTowers' },
    { kind: 'generator', count: 2, near: 'home' },
    { kind: 'dronebay', count: 1, near: 'home' },
    { kind: 'derrick', count: 1, near: 'oil' },
    { kind: 'motorpool', count: 1, near: 'home' },
    { kind: 'mortar', count: 1, near: 'home' },
    { kind: 'fortRing' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'house', count: 5, near: 'home' },
    { kind: 'arms', count: 2, near: 'home' },
    { kind: 'lumber', count: 3, near: 'trees' },
  ],
  armor: [
    [UnitKind.Tank, 1, 2],
    [UnitKind.ArmoredCar, 1, 1],
    [UnitKind.Howitzer, 0, 1],
  ],
  lines: {
    start: ["Old Sarge here. Dig in, kid. The desert doesn't forgive sloppy walls."],
    attack: ['Alright, step off. Mind the wire.', "Here we come. Hope you've been eating your rations.", 'Move out! Eyes on that gate.'],
    lostBuilding: ['That was a perfectly good building.', "You'll pay for that one, kid.", 'Noted. And remembered.'],
    hqHit: ["Hey! That's my office!", 'Somebody plug that hole!'],
    attackFailed: ['Hm. Regroup and try the other flank.', "Not bad. Won't happen twice."],
    win: ['Good effort. Same time tomorrow?'],
    lose: ['Well... you earned it. Carry on.'],
    catchphrase: ['Mind the wire, kid. Every time. Mind the wire.', 'Walls first. Coffee second.', 'Back in my day we dug these by hand.'],
  },
};

/** Jackal: light walls, fast cars, raids on your farms from the first minutes, early and frequent attacks. */
export const JACKAL: Personality = {
  key: 'jackal',
  name: 'Jackal',
  title: 'Raider',
  blurb: 'Hits early and often. Armored cars and small raiding parties go after your farms and work camps.',
  mix: { [UnitKind.Rifleman]: 6, [UnitKind.Gunner]: 1, [UnitKind.Engineer]: 2, [UnitKind.AT]: 1, [UnitKind.Operator]: 2 },
  build: [
    { kind: 'lumber', count: 1, near: 'trees' },
    { kind: 'orchard', count: 1, near: 'fertile' },
    { kind: 'quarry', count: 1, near: 'rock' },
    { kind: 'house', count: 3, near: 'home' },
    { kind: 'scrapyard', count: 1, near: 'home' },
    { kind: 'arms', count: 1, near: 'home' },
    { kind: 'market', count: 1, near: 'home' },
    { kind: 'lumber', count: 2, near: 'trees' },
    { kind: 'ranch', count: 1, near: 'home' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'derrick', count: 1, near: 'oil', eager: true },
    { kind: 'motorpool', count: 1, near: 'home', eager: true },
    { kind: 'fortFront' },
    { kind: 'house', count: 4, near: 'home' },
    { kind: 'arms', count: 2, near: 'home' },
    { kind: 'nightKit' },
    { kind: 'orchard', count: 2, near: 'fertile' },
    { kind: 'quarry', count: 2, near: 'rock' },
    { kind: 'depot', count: 2, near: 'producers' },
    { kind: 'house', count: 5, near: 'home' },
    { kind: 'generator', count: 2, near: 'home' },
    { kind: 'dronebay', count: 1, near: 'home' },
    { kind: 'scrapyard', count: 3, near: 'home' },
  ],
  armor: [
    [UnitKind.ArmoredCar, 2, 3],
    [UnitKind.Tank, 0, 1],
  ],
  tempo: { firstAttack: 0.75, attackSize: 0.9, attackGap: 0.8, attackGrowth: 0.8, garrison: 0.5 },
  raids: { size: 4, every: 75, from: 150 },
  lines: {
    start: ["Jackal. Nice farms you've got there. Be a shame if something happened to them."],
    attack: ['Go go go! Hit them before they wake up!', 'Fast and loud, boys!', "Here's your wake-up call."],
    raid: ['Smells like breakfast. Go get it.', "Torch the fields, we're not staying.", 'Quick snack run. Back before dark.'],
    lostBuilding: ['Pfft. I never liked that one.', "Cute. My turn next."],
    hqHit: ['Hey, hey, the paint!', 'Okay, that one I felt.'],
    attackFailed: ['Eh. Plenty more where they came from.', 'Hit and run. Mostly run.'],
    win: ['Too slow! Better luck next time.'],
    lose: ["Fine, fine. You're quicker than you look."],
    catchphrase: ["Knock knock. It's breakfast.", 'Fast in, faster out.', 'Never stay for the second course.'],
  },
};

/** The Engineer: minefields, wire, ditches and fuel trenches outside the walls; howitzers and breachers. */
export const THE_ENGINEER: Personality = {
  key: 'engineer',
  name: 'The Engineer',
  title: 'Sapper',
  blurb: 'Turns the ground outside the walls into a death trap: wire, mines, ditches and fuel trenches that go up in flames under you. Shells you from afar.',
  mix: { [UnitKind.Rifleman]: 4, [UnitKind.Gunner]: 1, [UnitKind.Marksman]: 1, [UnitKind.Engineer]: 4, [UnitKind.AT]: 1, [UnitKind.Operator]: 1 },
  build: [
    { kind: 'lumber', count: 1, near: 'trees' },
    { kind: 'orchard', count: 1, near: 'fertile' },
    { kind: 'quarry', count: 1, near: 'rock' },
    { kind: 'lumber', count: 2, near: 'trees' },
    { kind: 'house', count: 3, near: 'home' },
    { kind: 'scrapyard', count: 1, near: 'home' },
    { kind: 'market', count: 1, near: 'home' },
    { kind: 'quarry', count: 2, near: 'rock' },
    { kind: 'ranch', count: 1, near: 'home' },
    { kind: 'arms', count: 1, near: 'home' },
    { kind: 'fortFront' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'derrick', count: 1, near: 'oil', eager: true },
    { kind: 'motorpool', count: 1, near: 'home', eager: true },
    { kind: 'traps' },
    { kind: 'nightKit' },
    { kind: 'depot', count: 2, near: 'producers' },
    { kind: 'house', count: 4, near: 'home' },
    { kind: 'orchard', count: 2, near: 'fertile' },
    { kind: 'generator', count: 2, near: 'home' },
    { kind: 'gunTowers' },
    { kind: 'mortar', count: 1, near: 'home' },
    { kind: 'fortRing' },
    { kind: 'scrapyard', count: 3, near: 'home' },
    { kind: 'house', count: 5, near: 'home' },
    { kind: 'arms', count: 2, near: 'home' },
    { kind: 'dronebay', count: 1, near: 'home' },
  ],
  armor: [
    [UnitKind.Howitzer, 1, 2],
    [UnitKind.Breacher, 1, 1],
    [UnitKind.Tank, 0, 1],
  ],
  tempo: { firstAttack: 1.1, attackGap: 1.05 },
  ignites: true,
  upgrades: ['scrapyard', 'derrick', 'quarry', 'lumber', 'arms', 'orchard', 'house', 'generator'],
  lines: {
    start: ['The Engineer. Please mind the gap. Specifically, the one full of fuel.'],
    attack: ['Commencing demolition.', 'Load-bearing walls detected. Not for long.', 'Survey team, advance.'],
    lostBuilding: ['That was within tolerances. Barely.', 'I will be filing a complaint.'],
    hqHit: ['Structural damage to the main office. Unacceptable.', 'Stop that. I just had it plastered.'],
    attackFailed: ['Recalculating.', 'A setback. I have more blueprints.'],
    win: ['Your defenses failed inspection.'],
    lose: ['Hm. I underestimated your load capacity.'],
    catchphrase: ['Measure twice. Blow it up once.', 'Every structure has a weak point. I brought a list.', 'Mind the gap.'],
  },
};

/** Warden: a searchlit fortress bristling with gun towers; a big garrison; slow, heavy, armored assaults. */
export const WARDEN: Personality = {
  key: 'warden',
  name: 'Warden',
  title: 'Fortress',
  blurb: 'Gun towers on every wall, searchlights sweeping the dark, a big garrison. Comes for you late, with tanks.',
  mix: { [UnitKind.Rifleman]: 4, [UnitKind.Gunner]: 2, [UnitKind.Marksman]: 2, [UnitKind.Engineer]: 1, [UnitKind.AT]: 1 },
  build: [
    { kind: 'lumber', count: 1, near: 'trees' },
    { kind: 'orchard', count: 1, near: 'fertile' },
    { kind: 'quarry', count: 1, near: 'rock' },
    { kind: 'quarry', count: 2, near: 'rock' },
    { kind: 'house', count: 3, near: 'home' },
    { kind: 'scrapyard', count: 1, near: 'home' },
    { kind: 'market', count: 1, near: 'home' },
    { kind: 'lumber', count: 2, near: 'trees' },
    { kind: 'ranch', count: 1, near: 'home' },
    { kind: 'arms', count: 1, near: 'home' },
    { kind: 'fortFront' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'gunTowers' },
    { kind: 'mortar', count: 1, near: 'home' },
    { kind: 'scrapyard', count: 3, near: 'home' },
    { kind: 'fortRing' },
    { kind: 'mortar', count: 2, near: 'home' },
    { kind: 'generator', count: 2, near: 'home' },
    { kind: 'nightKit' },
    { kind: 'searchlights' },
    { kind: 'kennel', count: 1, near: 'home' },
    { kind: 'depot', count: 2, near: 'producers' },
    { kind: 'house', count: 4, near: 'home' },
    { kind: 'orchard', count: 2, near: 'fertile' },
    { kind: 'derrick', count: 1, near: 'oil' },
    { kind: 'motorpool', count: 1, near: 'home' },
    { kind: 'generator', count: 3, near: 'home' },
    { kind: 'scrapyard', count: 3, near: 'home' },
    { kind: 'house', count: 5, near: 'home' },
    { kind: 'arms', count: 2, near: 'home' },
    { kind: 'dronebay', count: 1, near: 'home' },
  ],
  armor: [
    [UnitKind.Tank, 1, 2],
    [UnitKind.Howitzer, 1, 1],
  ],
  tempo: { firstAttack: 1.4, attackSize: 1.5, attackGap: 1.15, attackGrowth: 1.2, garrison: 1.6 },
  extraGunTowers: true,
  upgrades: ['guntower', 'tower', 'gate', 'searchlight', 'scrapyard', 'quarry', 'lumber', 'arms', 'house', 'generator', 'floodlight'],
  lines: {
    start: ['Warden speaking. Lights on. Nobody gets in. Nobody gets out.'],
    attack: ['Inmates, fall in. We have a transfer to make.', 'Lockdown is over. For you.', 'Release the column.'],
    lostBuilding: ['A breach in the perimeter. Noted.', 'Someone will answer for that.'],
    hqHit: ['You are trespassing on state property.', 'Return fire. All towers.'],
    attackFailed: ['Back to the cells. We wait.', 'Patience. The walls will hold.'],
    win: ['Your sentence begins now.'],
    lose: ['The perimeter... has fallen.'],
    catchphrase: ['Lights on. Nobody gets in.', 'Every wall is a promise. I keep mine.', 'Count is clear. Count is always clear.'],
  },
};

/** The Broker: markets and taxes pay for PMC teams; infantry-heavy, with a car or two. */
export const THE_BROKER: Personality = {
  key: 'broker',
  name: 'The Broker',
  title: 'Trader',
  blurb: 'Taxes hard, trades everything, and buys ready-made PMC teams when the cash piles up. Armies appear fast.',
  mix: { [UnitKind.Rifleman]: 5, [UnitKind.Gunner]: 2, [UnitKind.Marksman]: 1, [UnitKind.Engineer]: 2, [UnitKind.AT]: 1, [UnitKind.Operator]: 1 },
  build: [
    { kind: 'lumber', count: 1, near: 'trees' },
    { kind: 'orchard', count: 1, near: 'fertile' },
    { kind: 'quarry', count: 1, near: 'rock' },
    { kind: 'lumber', count: 2, near: 'trees' },
    { kind: 'house', count: 3, near: 'home' },
    { kind: 'scrapyard', count: 1, near: 'home' },
    { kind: 'market', count: 1, near: 'home' },
    { kind: 'quarry', count: 2, near: 'rock' },
    { kind: 'ranch', count: 1, near: 'home' },
    { kind: 'arms', count: 1, near: 'home' },
    { kind: 'fortFront' },
    { kind: 'contracts', count: 1, near: 'home' },
    { kind: 'house', count: 4, near: 'home' },
    { kind: 'nightKit' },
    { kind: 'depot', count: 2, near: 'producers' },
    { kind: 'orchard', count: 2, near: 'fertile' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'house', count: 5, near: 'home' },
    { kind: 'gunTowers' },
    { kind: 'generator', count: 2, near: 'home' },
    { kind: 'derrick', count: 1, near: 'oil' },
    { kind: 'motorpool', count: 1, near: 'home' },
    { kind: 'fortRing' },
    { kind: 'house', count: 6, near: 'home' },
    { kind: 'lumber', count: 3, near: 'trees' },
  ],
  armor: [
    [UnitKind.ArmoredCar, 1, 1],
    [UnitKind.Tank, 0, 1],
  ],
  tempo: { attackSize: 1.0, attackGap: 0.85 },
  contracts: true,
  trader: true,
  upgrades: ['house', 'scrapyard', 'quarry', 'lumber', 'orchard', 'ranch', 'depot', 'arms', 'generator'],
  lines: {
    start: ['The Broker. Everything has a price. Yours is very reasonable.'],
    attack: ['My associates will see you now.', "Consider this a hostile takeover.", 'Invoice delivered.'],
    hire: ['Fresh contractors on the payroll.', 'Money talks. Today it shouts.'],
    lostBuilding: ['That will come out of your account.', 'Insured. Mostly.'],
    hqHit: ['Careful! The ledgers are in there!', 'You break it, you buy it.'],
    attackFailed: ['A write-off. There are always more contracts.', 'Poor returns on that one.'],
    win: ['Pleasure doing business.'],
    lose: ['Fine. Name your price.'],
    catchphrase: ['Everything has a price.', "It's not personal. It's billable.", 'Read the fine print. Oh, wait. There is none.'],
  },
};

/** Nightshade: special forces and the dark. Cuts your power, then comes over the walls at night. */
export const NIGHTSHADE: Personality = {
  key: 'nightshade',
  name: 'Nightshade',
  title: 'Night raider',
  blurb: 'Special forces who own the dark: they black out your power and lights, then attack at night. Daytime is quiet. Too quiet.',
  mix: {
    [UnitKind.Rifleman]: 3,
    [UnitKind.Gunner]: 1,
    [UnitKind.Marksman]: 2,
    [UnitKind.Engineer]: 1,
    [UnitKind.AT]: 1,
    [UnitKind.Operator]: 4,
  },
  build: [
    { kind: 'lumber', count: 1, near: 'trees' },
    { kind: 'orchard', count: 1, near: 'fertile' },
    { kind: 'quarry', count: 1, near: 'rock' },
    { kind: 'house', count: 3, near: 'home' },
    { kind: 'scrapyard', count: 1, near: 'home' },
    { kind: 'arms', count: 1, near: 'home' },
    { kind: 'market', count: 1, near: 'home' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'lumber', count: 2, near: 'trees' },
    { kind: 'ranch', count: 1, near: 'home' },
    { kind: 'fortFront' },
    { kind: 'arms', count: 2, near: 'home' },
    { kind: 'generator', count: 2, near: 'home' },
    { kind: 'dronebay', count: 1, near: 'home', eager: true },
    { kind: 'nightKit' },
    { kind: 'quarry', count: 2, near: 'rock' },
    { kind: 'house', count: 4, near: 'home' },
    { kind: 'orchard', count: 2, near: 'fertile' },
    { kind: 'scrapyard', count: 3, near: 'home' },
    { kind: 'depot', count: 2, near: 'producers' },
    { kind: 'gunTowers' },
    { kind: 'mortar', count: 1, near: 'home' },
    { kind: 'fortRing' },
    { kind: 'house', count: 5, near: 'home' },
    { kind: 'derrick', count: 1, near: 'oil' },
    { kind: 'motorpool', count: 1, near: 'home' },
  ],
  armor: [
    [UnitKind.ArmoredCar, 1, 2],
    [UnitKind.Tank, 0, 1],
  ],
  tempo: { attackSize: 0.9, attackGap: 0.9 },
  nightOps: true,
  upgrades: ['scrapyard', 'arms', 'quarry', 'lumber', 'orchard', 'house', 'generator'],
  lines: {
    start: ['Nightshade. You will not see us. You will only notice what is missing.'],
    attack: ['Lights out.', 'Move quiet. Strike once.', 'They sleep. We work.'],
    lostBuilding: ['Acceptable.', 'Noted. Retaliation scheduled.'],
    hqHit: ['Daylight makes you brave.', 'Enjoy the sun while it lasts.'],
    attackFailed: ['Withdraw. The night is long.', 'Fade back. Next time, darker.'],
    win: ['Goodnight.'],
    lose: ['...the dawn came early.'],
    catchphrase: ['Lights out.', "You won't hear the door.", 'We were never here.'],
  },
};

/** Duchess Varga: armor first, armor always. Tanks and Breachers roll at your walls again and again. */
export const DUCHESS_VARGA: Personality = {
  key: 'varga',
  name: 'Duchess Varga',
  title: 'Iron fist',
  blurb: 'Armor-heavy and relentless: tanks, armored cars and Breachers come at your walls again and again. Bring AT rockets and mines.',
  mix: { [UnitKind.Rifleman]: 4, [UnitKind.Gunner]: 1, [UnitKind.Engineer]: 2, [UnitKind.AT]: 2, [UnitKind.Operator]: 1 },
  build: [
    { kind: 'lumber', count: 1, near: 'trees' },
    { kind: 'orchard', count: 1, near: 'fertile' },
    { kind: 'quarry', count: 1, near: 'rock' },
    { kind: 'house', count: 3, near: 'home' },
    { kind: 'scrapyard', count: 1, near: 'home' },
    { kind: 'market', count: 1, near: 'home' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'derrick', count: 1, near: 'oil', eager: true },
    { kind: 'motorpool', count: 1, near: 'home', eager: true },
    { kind: 'arms', count: 1, near: 'home' },
    { kind: 'lumber', count: 2, near: 'trees' },
    { kind: 'ranch', count: 1, near: 'home' },
    { kind: 'scrapyard', count: 3, near: 'home' },
    { kind: 'fortFront' },
    { kind: 'derrick', count: 2, near: 'oil', eager: true },
    { kind: 'quarry', count: 2, near: 'rock' },
    { kind: 'house', count: 4, near: 'home' },
    { kind: 'scrapyard', count: 4, near: 'home' },
    { kind: 'nightKit' },
    { kind: 'orchard', count: 2, near: 'fertile' },
    { kind: 'depot', count: 2, near: 'producers' },
    { kind: 'gunTowers' },
    { kind: 'generator', count: 2, near: 'home' },
    { kind: 'dronebay', count: 1, near: 'home' },
    { kind: 'fortRing' },
    { kind: 'house', count: 5, near: 'home' },
  ],
  armor: [
    [UnitKind.Tank, 1, 3],
    [UnitKind.Breacher, 1, 2],
    [UnitKind.ArmoredCar, 1, 2],
    [UnitKind.Tank, 2, 3],
    [UnitKind.Howitzer, 0, 1],
  ],
  tempo: { attackSize: 1.15, attackGap: 0.85, attackGrowth: 1.1 },
  upgrades: ['scrapyard', 'derrick', 'quarry', 'lumber', 'arms', 'house', 'orchard', 'generator'],
  lines: {
    start: ['Duchess Varga. I collect castles. Yours will do nicely.'],
    attack: ['Engines on. Crush it.', 'Treads forward. Do not stop for anything.', 'Again. And again. Until it breaks.'],
    lostBuilding: ['How tiresome.', 'I have more steel than you have patience.'],
    hqHit: ['You dare scratch my paint?', 'Insolent.'],
    attackFailed: ['Repair the tanks. We go again.', 'A setback. Steel is patient.'],
    win: ['Another castle for the collection.'],
    lose: ['Hm. You may keep this one.'],
    catchphrase: ['Steel is patient, darling.', 'Rosie sends her regards.', 'I do so love the sound of treads in the morning.'],
    tankNew: ['Warm up the engine. Rosie wants to say hello.', 'Rosie is out of the garage. Do be nice to her.'],
    tankAttack: ['Here comes Rosie, darling. Do try to look surprised.', 'Rosie, dear, lead the way.', 'Make way for Rosie.'],
    tankLost: ['You killed Rosie. You. Killed. Rosie.', 'Rosie! ...You will pay for every rivet.'],
    tankBack: ['Rosie the {n}. Same temper, thicker armour.', 'Meet Rosie the {n}. She has heard all about you.', 'Rosie the {n} is ready. She holds grudges.'],
  },
  namedTank: 'Rosie',
};

/** The Quartermaster: the biggest economy on the map behind two rings of walls, then a late, crushing push. */
export const THE_QUARTERMASTER: Personality = {
  key: 'quartermaster',
  name: 'The Quartermaster',
  title: 'Economic turtle',
  blurb: 'Builds the biggest economy on the map behind two rings of walls, upgrades everything, and holds back. Then comes a late push with tanks and guns. Hit early, or face the bill.',
  mix: { [UnitKind.Rifleman]: 4, [UnitKind.Gunner]: 2, [UnitKind.Marksman]: 2, [UnitKind.Engineer]: 2, [UnitKind.AT]: 1 },
  build: [
    { kind: 'lumber', count: 1, near: 'trees' },
    { kind: 'orchard', count: 1, near: 'fertile' },
    { kind: 'quarry', count: 1, near: 'rock' },
    { kind: 'lumber', count: 2, near: 'trees' },
    { kind: 'quarry', count: 2, near: 'rock' },
    { kind: 'house', count: 3, near: 'home' },
    { kind: 'scrapyard', count: 1, near: 'home' },
    { kind: 'market', count: 1, near: 'home' },
    { kind: 'orchard', count: 2, near: 'fertile' },
    { kind: 'ranch', count: 1, near: 'home' },
    { kind: 'scrapyard', count: 2, near: 'home' },
    { kind: 'arms', count: 1, near: 'home' },
    { kind: 'fortFront' },
    { kind: 'house', count: 4, near: 'home' },
    { kind: 'depot', count: 2, near: 'producers' },
    { kind: 'quarry', count: 3, near: 'rock' },
    { kind: 'lumber', count: 3, near: 'trees' },
    { kind: 'fortRing' },
    { kind: 'scrapyard', count: 3, near: 'home' },
    { kind: 'gunTowers' },
    { kind: 'nightKit' },
    { kind: 'house', count: 5, near: 'home' },
    { kind: 'arms', count: 2, near: 'home' },
    { kind: 'generator', count: 2, near: 'home' },
    { kind: 'fortOuter' },
    { kind: 'mortar', count: 1, near: 'home' },
    { kind: 'derrick', count: 1, near: 'oil' },
    { kind: 'motorpool', count: 1, near: 'home' },
    { kind: 'ranch', count: 2, near: 'home' },
    { kind: 'house', count: 6, near: 'home' },
    { kind: 'scrapyard', count: 4, near: 'home' },
    { kind: 'dronebay', count: 1, near: 'home' },
  ],
  armor: [
    [UnitKind.Tank, 2, 3],
    [UnitKind.Howitzer, 1, 2],
    [UnitKind.ArmoredCar, 1, 1],
  ],
  tempo: { firstAttack: 1.5, attackSize: 1.35, attackGap: 1.0, attackGrowth: 1.2, garrison: 1.3 },
  outerRing: true,
  upgrades: ['scrapyard', 'quarry', 'lumber', 'orchard', 'ranch', 'arms', 'house', 'depot', 'generator', 'guntower', 'gate'],
  lines: {
    start: ['The Quartermaster. Everything in order, everything in triplicate.'],
    attack: ['Requisition approved. Proceed.', 'The bill has come due.', 'Deliver the shipment. All of it.'],
    lostBuilding: ['That will need a form.', 'Replacement scheduled.'],
    hqHit: ['Mind the inventory!', 'Unauthorized access to headquarters.'],
    attackFailed: ['Write it off. Order more.', 'Stocks remain adequate.'],
    win: ['Account closed.'],
    lose: ['Audit complete. I appear to be insolvent.'],
    catchphrase: ['In triplicate, please.', 'Everything counted. Everything accounted for.', 'Supply wins wars. Sign here.'],
  },
};

export const PERSONALITIES: Record<OpponentKey, Personality> = {
  sarge: OLD_SARGE,
  jackal: JACKAL,
  engineer: THE_ENGINEER,
  broker: THE_BROKER,
  warden: WARDEN,
  nightshade: NIGHTSHADE,
  varga: DUCHESS_VARGA,
  quartermaster: THE_QUARTERMASTER,
};

/** Opponents in menu order (roughly easiest first). */
export const OPPONENTS: OpponentKey[] = ['sarge', 'jackal', 'engineer', 'broker', 'nightshade', 'varga', 'quartermaster', 'warden'];

export function isOpponentKey(k: string | null | undefined): k is OpponentKey {
  return !!k && k in PERSONALITIES;
}

/** Build steps that only go ahead with steel to spare. */
const EXTRAS: StructureKind[] = ['generator', 'dronebay', 'derrick', 'motorpool'];
const SPARE_STEEL = 18;

const RECIPE_FOR: Partial<Record<number, number>> = {
  [UnitKind.Rifleman]: 0,
  [UnitKind.Gunner]: 1,
  [UnitKind.Marksman]: 2,
  [UnitKind.Engineer]: 3,
  [UnitKind.Operator]: 4,
  [UnitKind.AT]: 5,
};

/** Rough fighting value of a unit, for sizing up armies. */
function worth(k: number): number {
  return k === UnitKind.Tank ? 4 : k === UnitKind.Howitzer ? 3 : k === UnitKind.ArmoredCar || k === UnitKind.Breacher ? 2 : 1;
}

/** Defensive weight of a structure on the side of a base an attack would come from. */
const DEFENSE_WEIGHT: Partial<Record<StructureKind, number>> = { wall: 1, gate: 2, tower: 3, guntower: 8, mortar: 5, ditch: 1, mines: 1, wire: 0.5 };

// ------------------------------------------------------------------ controller

/**
 * A computer commander. Runs inside the deterministic sim step and acts only through Commands,
 * so it plays by exactly the same rules (and sees the same map) as the player.
 */
export class AiCommander implements Controller {
  private tick = 0;
  private readonly tuning: AiTuning;
  private readonly front: Side;
  private readonly pieces: Piece[];
  /** Second ring (The Quartermaster). */
  private readonly outer: Piece[];
  private readonly reserved: (tx: number, tz: number) => boolean;
  private readonly impossible = new Set<string>();
  private readonly garrison = new Set<number>();
  private nextAttackAt: number;
  private attackSize: number;
  private attackGroup: number[] = [];
  private lastTaxChange = -1e9;
  private lastLostLine = -1e9;
  private lastHqLine = -1e9;
  private said = new Set<string>();
  /** Named lead tank (unit id, -1 = none) and how many there have been. */
  namedTankId = -1;
  namedTankGen = 0;
  /** Attacks launched (picks when a catchphrase replaces the attack line). */
  private attackLines = 0;
  /** Picks which line to say (separate from the sim's random numbers). */
  private lineSeed = 0x5eed;
  private lastBuildAt = -1e9;

  private raidGroup: number[] = [];
  private raidTried = new Set<number>();
  private lastRaidAt = -1e9;
  private lastHireAt = -1e9;
  private lastIgniteAt = -1e9;
  /** Counters for inspection and tests. */
  raidsLaunched = 0;
  hires = 0;
  /** The Engineer's field works outside the front wall, in building order. */
  private readonly fieldworks: { kind: StructureKind; tiles: number[] }[];

  constructor(
    readonly owner: number,
    readonly enemy: number,
    private home: { x: number; z: number },
    readonly personality: Personality,
    readonly difficulty: Difficulty,
    private ring = 11,
    front: Side = 'west',
  ) {
    this.tuning = withTempo(DIFFICULTY[difficulty], personality.tempo);
    this.nextAttackAt = this.tuning.firstAttack;
    this.attackSize = this.tuning.attackSize;
    this.front = front;
    this.pieces = ringBlueprint(home.x, home.z, ring, ['east', 'west', 'north', 'south']);
    this.outer = personality.outerRing ? ringBlueprint(home.x, home.z, ring + 4, ['east', 'west', 'north', 'south']) : [];
    const inner = ringReserve(home.x, home.z, ring);
    const outer = ringReserve(home.x, home.z, ring + 4);
    this.reserved = personality.outerRing ? (x, z) => inner(x, z) || outer(x, z) : inner;
    this.fieldworks = personality.build.some((b) => b.kind === 'traps') ? this.layoutFieldworks() : [];
  }

  /**
   * Lines in front of the front wall: wire close in, a row of mines across the approach, ditches
   * on the flanks (the gate lane stays open for the AI's own army), and a fuel trench furthest out.
   */
  private layoutFieldworks(): { kind: StructureKind; tiles: number[] }[] {
    const f = this.front === 'west' ? -1 : 1;
    const wall = this.home.x + f * this.ring;
    const hz = this.home.z;
    const line = (dx: number, z0: number, z1: number): number[] => {
      const out: number[] = [];
      for (let z = z0; z <= z1; z++) out.push(wall + f * dx, z);
      return out;
    };
    return [
      { kind: 'ditch', tiles: [...line(6, hz - 11, hz - 4), ...line(6, hz + 4, hz + 11)] },
      { kind: 'wire', tiles: line(2, hz - 9, hz + 9) },
      { kind: 'mines', tiles: line(4, hz - 6, hz + 6) },
      { kind: 'trench', tiles: line(8, hz - 8, hz + 8) },
    ];
  }

  /** Called with the step's events before they're drained (see Sim.step). */
  observe(sim: Sim, events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'structureDestroyed' && e.owner === this.owner && sim.elapsed - this.lastLostLine > 60) {
        this.lastLostLine = sim.elapsed;
        this.say(sim, 'lostBuilding');
      }
      if (e.type === 'structureDamaged' && sim.elapsed - this.lastHqLine > 90) {
        const hq = sim.economy.hqOf(this.owner);
        if (hq && e.id === hq.id) {
          this.lastHqLine = sim.elapsed;
          this.say(sim, 'hqHit');
        }
      }
      if (e.type === 'result') this.say(sim, e.result === 'victory' ? 'lose' : 'win');
      if (e.type === 'death' && e.unit === this.namedTankId && e.owner === this.owner) {
        this.namedTankId = -1;
        if (!sim.result) this.say(sim, 'tankLost');
      }
      // Enemy artillery landing near home: time for a mortar pit of our own.
      if (e.type === 'shell' && e.owner === this.enemy && Math.hypot(e.toX - this.home.x, e.toZ - this.home.z) < this.ring + 12) this.shelled = true;
    }
  }

  update(sim: Sim): void {
    if (sim.result) return;
    if (++this.tick % this.tuning.thinkTicks !== 0) return;
    if (!sim.economy.hqOf(this.owner)) return;
    if (!this.said.has('start') && sim.elapsed > 4) {
      this.said.add('start');
      this.say(sim, 'start');
    } else if (!this.said.has('catchphrase') && sim.elapsed > 100) {
      this.said.add('catchphrase');
      this.say(sim, 'catchphrase');
    }
    this.nameTank(sim);
    this.manageMorale(sim);
    this.build(sim);
    this.military(sim);
    this.flares(sim);
    this.drones(sim);
    this.upgrades(sim);
    this.hireContracts(sim);
    this.igniteTrenches(sim);
  }

  /** The Broker: when cash piles up, buy the PMC team the army mix is missing. */
  private hireContracts(sim: Sim): void {
    if (!this.personality.contracts || sim.elapsed - this.lastHireAt < 5) return;
    const office = sim.structures.find((s) => s.owner === this.owner && s.kind === 'contracts');
    if (!office) return;
    const p = sim.economy.player(this.owner);
    const need = this.neededKind(sim);
    let idx = CONTRACTS.findIndex((c) => c.units[0][0] === need);
    // No cars of our own yet and the motor pool isn't up: hire one.
    const cars = sim.units.kind.some((k, i) => sim.units.alive[i] && sim.units.owner[i] === this.owner && k === UnitKind.ArmoredCar);
    if (!cars && this.difficulty !== 'easy' && sim.elapsed > 400) idx = CONTRACTS.findIndex((c) => c.key === 'car');
    if (idx < 0) idx = 0;
    const reserve = this.difficulty === 'easy' ? 250 : 40;
    if (p.funds < CONTRACTS[idx].funds + reserve) return;
    if (sim.economy.hireBlocker(this.owner, office.id, idx)) return;
    this.lastHireAt = sim.elapsed;
    this.hires++;
    sim.enqueue({ type: 'hire', owner: this.owner, office: office.id, contract: idx });
    if (this.hires % 3 === 1) this.say(sim, 'hire');
  }

  /** The Engineer: set a fuel trench alight under the enemy (never under the AI's own people). */
  private igniteTrenches(sim: Sim): void {
    if (!this.personality.ignites || sim.elapsed - this.lastIgniteAt < 4) return;
    const u = sim.units;
    const trenches = sim.structures.filter((s) => s.owner === this.owner && s.kind === 'trench' && s.burn === 0);
    if (trenches.length === 0) return;
    let hit: Structure | null = null;
    for (const s of trenches) {
      for (let i = 0; i < u.count && !hit; i++) {
        if (!u.alive[i] || u.owner[i] !== this.enemy || u.layer[i] !== 0 || !UNIT_TYPES[u.kind[i]].armed || UNIT_TYPES[u.kind[i]].fly) continue;
        if (Math.abs(u.x[i] - (s.tx + 0.5)) < 1.6 && Math.abs(u.z[i] - (s.tz + 0.5)) < 1.6) hit = s;
      }
      if (hit) break;
    }
    if (!hit) return;
    // Fire runs the length of the trench: hold off while any of ours are near it.
    for (const s of trenches) {
      for (let i = 0; i < u.count; i++) {
        if (u.alive[i] && u.owner[i] === this.owner && u.layer[i] === 0 && Math.hypot(u.x[i] - (s.tx + 0.5), u.z[i] - (s.tz + 0.5)) < 2.5) return;
      }
    }
    this.lastIgniteAt = sim.elapsed;
    sim.enqueue({ type: 'ignite', owner: this.owner, id: hit.id });
  }

  private lastUpgradeAt = -1e9;

  /** With money to spare, upgrade producers and housing (and on Hard, turn watchtowers into gun towers). */
  private upgrades(sim: Sim): void {
    if (sim.elapsed - this.lastUpgradeAt < 25) return;
    const p = sim.economy.player(this.owner);
    if (p.funds < 160) return;
    const order: StructureKind[] = [
      ...(this.personality.upgrades ?? ['scrapyard', 'quarry', 'lumber', 'arms', 'orchard', 'ranch', 'house', 'depot', 'generator']),
    ];
    if (this.difficulty === 'hard' && !order.includes('tower')) order.push('tower');
    for (const kind of order) {
      for (const s of sim.structures) {
        if (s.owner !== this.owner || s.kind !== kind) continue;
        if (sim.economy.upgradeBlocker(this.owner, s.id)) continue;
        // Weapons first: don't spend steel the arms factory needs.
        const up = STRUCTURE_DEFS[s.kind].upgrades?.[(s.level ?? 1) - 1];
        if ((up?.cost.steel ?? 0) > 0 && p.stock[Res.Steel] < 20 + (up?.cost.steel ?? 0)) continue;
        this.lastUpgradeAt = sim.elapsed;
        sim.enqueue({ type: 'upgrade', owner: this.owner, id: s.id });
        return;
      }
    }
  }

  private say(sim: Sim, kind: keyof Personality['lines']): void {
    const lines = this.personality.lines[kind];
    if (!lines?.length) return;
    // Its own little generator: what a commander says must never change how the match plays out.
    this.lineSeed = (Math.imul(this.lineSeed ^ (this.lineSeed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    const text = lines[this.lineSeed % lines.length].replace('{n}', ordinal(this.namedTankGen));
    sim.emit({ type: 'taunt', owner: this.owner, name: this.personality.name, text });
  }

  /** The first tank off the line gets a name; when it's destroyed, the next one inherits it. */
  private nameTank(sim: Sim): void {
    if (!this.personality.namedTank) return;
    const u = sim.units;
    const id = this.namedTankId;
    if (id >= 0 && (!u.alive[id] || u.owner[id] !== this.owner || u.kind[id] !== UnitKind.Tank)) {
      // Gone without a death event reaching us (removed outside a step): mourn her now, name the next one later.
      this.namedTankId = -1;
      this.say(sim, 'tankLost');
      return;
    }
    if (this.namedTankId >= 0) return;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.owner || u.kind[i] !== UnitKind.Tank) continue;
      this.namedTankId = i;
      this.namedTankGen++;
      this.say(sim, this.namedTankGen === 1 ? 'tankNew' : 'tankBack');
      return;
    }
  }

  /** The attack line: the named tank announces itself when it leads, and every third attack gets a catchphrase. */
  private sayAttack(sim: Sim, ids: readonly number[]): void {
    const n = this.attackLines++;
    if (this.namedTankId >= 0 && ids.includes(this.namedTankId)) this.say(sim, 'tankAttack');
    else if (n % 3 === 2 && this.personality.lines.catchphrase?.length) this.say(sim, 'catchphrase');
    else this.say(sim, 'attack');
  }

  // ---------------------------------------------------------------- economy

  private shelled = false;

  /**
   * Normal and up: pick rations and taxes together for the most income that still moves morale where
   * it needs to be. While there's room to grow, keep morale high so people keep arriving; once housing
   * is full, cash in on high morale down to a safe floor; below the floor, buy it back.
   */
  private planEconomy(sim: Sim): void {
    const p = sim.economy.player(this.owner);
    if (sim.elapsed - this.lastTaxChange < 12) return;
    const pop = Math.max(1, p.population);
    const others = p.factors.filter((f) => f.key !== 'rations' && f.key !== 'taxes').reduce((a, f) => a + f.value, 0);
    const food = p.stored('food');
    const rate = this.foodRate(sim);
    const m = p.morale;
    const floor = this.personality.trader ? 52 : 55;
    const room = p.population < p.housing - 1;
    const need = room ? (m < 72 ? 3 : 0) : m > 78 ? -5 : m > 64 ? -2 : m > floor ? 0 : 3;
    let best: [number, number] | null = null;
    let bestValue = -Infinity;
    for (let r = 1; r < RATION_LEVELS.length; r++) {
      const eat = pop * RATION_LEVELS[r].perMin;
      // Only rations we can keep up: farms cover it, or the stores cover four minutes of the shortfall.
      if (eat > rate && food < (eat - rate) * 4 + pop) continue;
      for (let t = 0; t < TAX_LEVELS.length; t++) {
        const drift = others + RATION_LEVELS[r].morale + TAX_LEVELS[t].morale;
        if (drift < need) continue;
        const value = pop * TAX_LEVELS[t].perMin - eat * 2;
        if (value > bestValue) {
          bestValue = value;
          best = [r, t];
        }
      }
    }
    if (!best) best = [food > pop * 2 ? 3 : 1, 1];
    if (best[0] !== p.rationLevel) sim.enqueue({ type: 'setRations', owner: this.owner, level: best[0] });
    if (best[1] !== p.taxLevel) {
      this.lastTaxChange = sim.elapsed;
      sim.enqueue({ type: 'setTax', owner: this.owner, level: best[1] });
    }
  }

  private manageMorale(sim: Sim): void {
    if (this.difficulty !== 'easy') {
      this.planEconomy(sim);
      this.trade(sim);
      return;
    }
    const p = sim.economy.player(this.owner);
    const food = p.stored('food');
    const ration = food < p.population * 1.5 ? 1 : food > p.population * 8 ? 3 : 2;
    if (ration !== p.rationLevel) sim.enqueue({ type: 'setRations', owner: this.owner, level: ration });
    if (sim.elapsed - this.lastTaxChange >= 15) {
      // Moderate taxes: enough income to recruit without bleeding people.
      let tax = p.morale < 45 ? 1 : p.morale < 56 ? 2 : p.morale < 80 ? 3 : 4;
      // The Broker squeezes harder while people are happy enough to take it.
      if (this.personality.trader && p.morale > 62) tax = Math.min(TAX_LEVELS.length - 1, tax + 1);
      if (tax !== p.taxLevel) {
        this.lastTaxChange = sim.elapsed;
        sim.enqueue({ type: 'setTax', owner: this.owner, level: tax });
      }
    }
    this.trade(sim);
  }

  /** Sell surplus for funds; buy food in an emergency. */
  private trade(sim: Sim): void {
    if (!sim.economy.hasMarket(this.owner)) return;
    const p = sim.economy.player(this.owner);
    const walling = this.pieces.some((pc) => !sim.structureAt(pc.tx, pc.tz)) || this.outer.some((pc) => !sim.structureAt(pc.tx, pc.tz));
    // The Broker sells hard once he's set up (not while he still needs the timber).
    const trader = !!this.personality.trader && sim.elapsed > 360;
    const keep: [ResId, number][] = [
      [Res.Timber, trader ? 60 : 90],
      [Res.Concrete, walling ? 400 : trader ? 35 : 50],
      [Res.Steel, trader ? 24 : 30],
      [Res.Fuel, 30],
    ];
    for (const g of GEAR_RES) keep.push([g, 6]);
    for (const [res, k] of keep) {
      const surplus = Math.floor(p.stock[res] - k);
      if (surplus >= 5) {
        sim.enqueue({ type: 'trade', owner: this.owner, res, amount: -Math.min(surplus, 20) });
        return;
      }
    }
    if (p.foodSeconds < 60 && p.funds > 150) {
      sim.enqueue({ type: 'trade', owner: this.owner, res: Res.Produce, amount: 10 });
      return;
    }
    // Tanks need fuel: buy it if there's no derrick keeping up.
    const pool = sim.structures.some((s) => s.owner === this.owner && s.kind === 'motorpool');
    const trenchFuel = this.fieldworks.length > 0 && sim.elapsed > 240;
    if ((pool || trenchFuel) && this.difficulty !== 'easy' && p.stock[Res.Fuel] < 12 && p.funds > 100) {
      sim.enqueue({ type: 'trade', owner: this.owner, res: Res.Fuel, amount: 5 });
      return;
    }
    // Rich but short of weapons: buy the one the army mix needs most (the Broker saves for contracts).
    if (p.funds > 190 && !this.personality.contracts && p.stored('gear') < p.gearCap - 2) {
      const gear = UNIT_TYPES[this.neededKind(sim)].gear;
      if (gear !== null && p.stock[gear] < 4) sim.enqueue({ type: 'trade', owner: this.owner, res: gear, amount: 2 });
    }
  }

  /** Army-mix weight for a unit type. AT teams only join once the enemy fields armor. */
  private weight(sim: Sim, k: number): number {
    const w = this.personality.mix[k] ?? 0;
    if (k === UnitKind.Operator) return this.difficulty === 'easy' ? 0 : w;
    if (k !== UnitKind.AT) return w;
    const u = sim.units;
    for (let i = 0; i < u.count; i++) if (u.alive[i] && u.owner[i] === this.enemy && UNIT_TYPES[u.kind[i]].vehicle) return w * 2;
    return 0;
  }

  /** The unit type furthest below the personality's army mix (counting weapons in stock). */
  private neededKind(sim: Sim): number {
    const u = sim.units;
    const p = sim.economy.player(this.owner);
    const have = new Map<number, number>();
    for (let i = 0; i < u.count; i++) {
      if (u.alive[i] && u.owner[i] === this.owner) have.set(u.kind[i], (have.get(u.kind[i]) ?? 0) + 1);
    }
    let best: number = UnitKind.Rifleman;
    let bestScore = Infinity;
    for (const k of RECRUITABLE) {
      const weight = this.weight(sim, k);
      if (!weight) continue;
      const score = ((have.get(k) ?? 0) + p.stock[UNIT_TYPES[k].gear!]) / weight;
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return best;
  }

  /** Rough food output per minute (orchards/ranches, averaged over day and night). */
  private foodRate(sim: Sim): number {
    let rate = 0;
    for (const s of sim.structures) {
      if (s.owner !== this.owner) continue;
      if (s.kind === 'orchard') rate += 6.5 * 0.75;
      if (s.kind === 'ranch') rate += 4 * 0.75;
    }
    return rate;
  }

  private count(sim: Sim, kind: StructureKind): number {
    let n = 0;
    for (const s of sim.structures) if (s.owner === this.owner && s.kind === kind) n++;
    return n;
  }

  private build(sim: Sim): void {
    if (sim.elapsed - this.lastBuildAt < 2) return;
    const p = sim.economy.player(this.owner);

    // Urgent needs first: food, housing and storage.
    const need = p.population * RATION_LEVELS[2].perMin;
    const foodBuildings = this.count(sim, 'orchard') + this.count(sim, 'ranch');
    if (this.foodRate(sim) < need * 1.1 && foodBuildings < 7 && sim.elapsed > 20) {
      if (!this.impossible.has('orchard:food') && p.canAfford(STRUCTURE_DEFS.orchard.cost)) {
        if (this.tryBuild(sim, 'orchard', 'fertile')) return;
        this.impossible.add('orchard:food');
      }
      if (p.canAfford(STRUCTURE_DEFS.ranch.cost) && this.tryBuild(sim, 'ranch', 'home')) return;
    }
    // More housing only when short of hands (idle civilians are the recruiting pool).
    if (p.population >= p.housing - 1 && p.idle < 4 && this.count(sim, 'house') < 10 && p.morale > 55) {
      if (p.canAfford(STRUCTURE_DEFS.house.cost) && this.tryBuild(sim, 'house', 'home')) return;
    }
    if (p.stored('materials') > p.materialsCap - 15 && this.tryBuild(sim, 'depot', 'producers')) return;
    if (p.stored('food') > p.foodCap - 15 && this.tryBuild(sim, 'rations', 'home')) return;
    // Being shelled: answer it with a mortar pit (counter-battery) as soon as we can.
    if (this.shelled && this.difficulty !== 'easy' && this.count(sim, 'mortar') < 2 && !this.impossible.has('mortar:react')) {
      if (p.canAfford(STRUCTURE_DEFS.mortar.cost)) {
        if (this.tryBuild(sim, 'mortar', 'home')) return;
        this.impossible.add('mortar:react');
      }
    }
    // Hands sitting idle: put them to work (steel first: it's what weapons and armor are made of).
    if (this.difficulty !== 'easy' && p.idle >= 8 && sim.elapsed > 150 && this.expand(sim)) return;

    for (const step of this.personality.build) {
      if (step.kind === 'fortFront' || step.kind === 'fortRing' || step.kind === 'fortOuter') {
        const done = this.fortify(sim, step.kind === 'fortFront', step.kind === 'fortOuter' ? this.outer : this.pieces);
        if (!done) return; // keep pouring concrete into the walls before moving on
        continue;
      }
      if (step.kind === 'nightKit') {
        if (!this.nightKit(sim)) return;
        continue;
      }
      if (step.kind === 'gunTowers') {
        if (!this.gunTowers(sim)) return;
        continue;
      }
      if (step.kind === 'traps') {
        if (!this.layTraps(sim)) return;
        continue;
      }
      if (step.kind === 'searchlights') {
        if (!this.searchlights(sim)) return;
        continue;
      }
      if (this.impossible.has(`${step.kind}:${step.count}`)) continue;
      if (this.count(sim, step.kind) >= (step.count ?? 1)) continue;
      const def = STRUCTURE_DEFS[step.kind];
      // Extras that eat steel wait for a surplus instead of holding up the build (weapons come first).
      if (EXTRAS.includes(step.kind) && !step.eager && (!p.canAfford(def.cost) || p.stock[Res.Steel] < SPARE_STEEL + (def.cost.steel ?? 0))) continue;
      if (!p.canAfford(def.cost)) return; // save up for the next step
      if (!this.tryBuild(sim, step.kind, step.near ?? 'home')) {
        // Fall back to a ranch when there's no fertile ground in reach.
        if (step.kind === 'orchard' && this.tryBuild(sim, 'ranch', 'home')) return;
        this.impossible.add(`${step.kind}:${step.count}`);
      }
      return;
    }
  }

  /** Build another producer for whatever is short. Returns true if something was ordered. */
  private expand(sim: Sim): boolean {
    const p = sim.economy.player(this.owner);
    const options: [StructureKind, Near, number][] = [];
    if (p.stock[Res.Steel] < 20) options.push(['scrapyard', 'home', 5]);
    if (p.stored('gear') < 4) options.push(['arms', 'home', 3]);
    if (p.stock[Res.Concrete] < 30) options.push(['quarry', 'rock', 4]);
    if (p.stock[Res.Timber] < 30) options.push(['lumber', 'trees', 4]);
    if (p.foodSeconds < 240) options.push(['orchard', 'fertile', 6], ['ranch', 'home', 4]);
    options.push(['scrapyard', 'home', 5], ['arms', 'home', 3]);
    for (const [kind, near, cap] of options) {
      const key = `${kind}:expand`;
      if (this.impossible.has(key) || this.count(sim, kind) >= cap) continue;
      if (!p.canAfford(STRUCTURE_DEFS[kind].cost)) continue;
      if (this.tryBuild(sim, kind, near)) return true;
      this.impossible.add(key);
    }
    return false;
  }

  /** Build the next pieces of the fortress. Returns true when that phase is complete. */
  private fortify(sim: Sim, frontOnly: boolean, pieces: Piece[] = this.pieces): boolean {
    const p = sim.economy.player(this.owner);
    const todo = pieces.filter((pc) => {
      if (frontOnly && pc.side !== this.front && !(pc.kind === 'tower' && this.isFrontCorner(pc))) return false;
      const key = `${pc.kind}@${pc.tx},${pc.tz}`;
      if (this.impossible.has(key)) return false;
      const s = sim.structureAt(pc.tx, pc.tz);
      return !(s && s.kind === pc.kind && s.owner === this.owner);
    });
    if (todo.length === 0) return true;

    // Walls go up as one line command; towers/gates/stairs one at a time (they need walls for stairs).
    const walls = todo.filter((pc) => pc.kind === 'wall');
    const others = todo.filter((pc) => pc.kind !== 'wall' && pc.kind !== 'stairs');
    const stairs = todo.filter((pc) => pc.kind === 'stairs');
    for (const pc of [...others, ...stairs]) {
      const def = STRUCTURE_DEFS[pc.kind];
      if (!p.canAfford(def.cost)) break;
      const check = sim.economy.canPlace(this.owner, pc.kind, pc.tx, pc.tz, pc.rot);
      if (check.ok) {
        sim.enqueue({ type: 'build', owner: this.owner, kind: pc.kind, tx: pc.tx, tz: pc.tz, rot: pc.rot });
        this.lastBuildAt = sim.elapsed;
        return false;
      }
      // Stairs wait for their wall; enemies move; money comes in. Anything else won't fix itself.
      const retry = check.reason === 'Enemies in the way' || check.reason?.startsWith('Not enough') || check.reason?.startsWith('Must be right next');
      if (!retry) this.impossible.add(`${pc.kind}@${pc.tx},${pc.tz}`);
    }
    const per = STRUCTURE_DEFS.wall.cost.concrete ?? 1;
    const budget = Math.floor(p.stock[Res.Concrete] / per);
    if (walls.length && budget > 0) {
      const tiles: number[] = [];
      for (const w of walls) {
        if (tiles.length / 2 >= budget) break;
        const check = sim.economy.canPlaceWallTile(this.owner, w.tx, w.tz);
        if (check.ok) tiles.push(w.tx, w.tz);
        else if (check.reason !== 'Enemies in the way') this.impossible.add(`wall@${w.tx},${w.tz}`);
      }
      if (tiles.length) {
        sim.enqueue({ type: 'buildWall', owner: this.owner, tiles });
        this.lastBuildAt = sim.elapsed;
      }
    }
    return false;
  }

  /**
   * Where gun towers go: two just inside the front wall, touching it, either side of the gate (Normal
   * and up). Warden adds one inside each of the other walls (and keeps the front pair on Easy).
   */
  private gunTowerSpots(): { tx: number; tz: number }[] {
    const extra = !!this.personality.extraGunTowers;
    if (this.difficulty === 'easy' && !extra) return [];
    const { x: hx, z: hz } = this.home;
    const r = this.ring;
    const tx = this.front === 'west' ? hx - r + 1 : hx + r - 2;
    const spots = [
      { tx, tz: hz - 4 },
      { tx, tz: hz + 3 },
    ];
    if (extra && this.difficulty !== 'easy') {
      spots.push(
        { tx: hx + 2, tz: hz - r + 1 },
        { tx: hx + 2, tz: hz + r - 2 },
        { tx: this.front === 'west' ? hx + r - 2 : hx - r + 1, tz: hz + 2 },
      );
    }
    return spots;
  }

  /** The Engineer's field works, one line at a time. Returns true when done (or waiting on steel/fuel). */
  private layTraps(sim: Sim): boolean {
    const p = sim.economy.player(this.owner);
    for (const fw of this.fieldworks) {
      const todo: number[] = [];
      for (let k = 0; k + 1 < fw.tiles.length; k += 2) {
        const x = fw.tiles[k];
        const z = fw.tiles[k + 1];
        const key = `${fw.kind}@${x},${z}`;
        if (this.impossible.has(key)) continue;
        const s = sim.structureAt(x, z);
        if (s && s.owner === this.owner && s.kind === fw.kind) continue;
        const check = sim.economy.canPlaceWallTile(this.owner, x, z);
        if (!check.ok) {
          if (check.reason !== 'Enemies in the way') this.impossible.add(key);
          continue;
        }
        todo.push(x, z);
      }
      if (todo.length === 0) continue;
      const cost = STRUCTURE_DEFS[fw.kind].cost;
      // Steel and fuel go to weapons and vehicles first: lay these when there's some to spare.
      if ((cost.steel ?? 0) > 0 && p.stock[Res.Steel] < SPARE_STEEL) continue;
      if ((cost.fuel ?? 0) > 0 && p.stock[Res.Fuel] < 6) continue;
      if (!p.canAfford(cost)) return false;
      sim.enqueue({ type: 'buildWall', owner: this.owner, kind: fw.kind, tiles: todo });
      this.lastBuildAt = sim.elapsed;
      return false;
    }
    return true;
  }

  /** Warden: more searchlights, sweeping the sides and the rear. Returns true when all are up. */
  private searchlights(sim: Sim): boolean {
    const p = sim.economy.player(this.owner);
    const { x: hx, z: hz } = this.home;
    const r = this.ring - 3;
    const f = this.front === 'west' ? -1 : 1;
    const kit: { tx: number; tz: number; rot: number }[] = [
      { tx: hx + f * r, tz: hz - 6, rot: (f * Math.PI) / 2 },
      { tx: hx - 4, tz: hz - r, rot: Math.PI },
      { tx: hx - 4, tz: hz + r, rot: 0 },
      { tx: hx - f * r, tz: hz + 4, rot: (-f * Math.PI) / 2 },
    ];
    for (const k of kit) {
      const key = `searchlight@${k.tx},${k.tz}`;
      if (this.impossible.has(key)) continue;
      const s = sim.structureAt(k.tx, k.tz);
      if (s && s.kind === 'searchlight' && s.owner === this.owner) continue;
      if (!p.canAfford(STRUCTURE_DEFS.searchlight.cost) || p.stock[Res.Steel] < 14) return true; // later
      if (sim.economy.canPlace(this.owner, 'searchlight', k.tx, k.tz).ok) {
        sim.enqueue({ type: 'build', owner: this.owner, kind: 'searchlight', tx: k.tx, tz: k.tz, rot: k.rot });
        this.lastBuildAt = sim.elapsed;
        return false;
      }
      this.impossible.add(key);
    }
    return true;
  }

  /** Normal and up: two gun towers by the front gate. Returns true when done (or impossible). */
  private gunTowers(sim: Sim): boolean {
    const p = sim.economy.player(this.owner);
    for (const g of this.gunTowerSpots()) {
      const key = `guntower@${g.tx},${g.tz}`;
      if (this.impossible.has(key)) continue;
      const s = sim.structureAt(g.tx, g.tz);
      if (s && s.kind === 'guntower' && s.owner === this.owner) continue;
      const cost = STRUCTURE_DEFS.guntower.cost;
      if (!p.canAfford(cost) || p.stock[Res.Steel] < SPARE_STEEL + (cost.steel ?? 0)) return true; // later
      const check = sim.economy.canPlace(this.owner, 'guntower', g.tx, g.tz);
      if (check.ok) {
        sim.enqueue({ type: 'build', owner: this.owner, kind: 'guntower', tx: g.tx, tz: g.tz });
        this.lastBuildAt = sim.elapsed;
        return false;
      }
      if (check.reason !== 'Enemies in the way') this.impossible.add(key);
    }
    return true;
  }

  /** Lights and a sensor around the walls (front first). Returns true when all are up. */
  private nightKit(sim: Sim): boolean {
    const p = sim.economy.player(this.owner);
    const { x: hx, z: hz } = this.home;
    const r = this.ring - 3;
    const f = this.front === 'west' ? -1 : 1;
    const q = Math.PI / 2;
    const kit: { kind: StructureKind; tx: number; tz: number; rot: number }[] = [
      { kind: 'floodlight', tx: hx + f * r, tz: hz - 5, rot: f * q },
      { kind: 'floodlight', tx: hx + f * r, tz: hz + 5, rot: f * q },
      { kind: 'searchlight', tx: hx + f * r - (f < 0 ? 0 : 1), tz: hz + 2, rot: f * q },
      { kind: 'sensor', tx: hx + f * (r + 1), tz: hz - 2, rot: 0 },
      { kind: 'floodlight', tx: hx - f * r, tz: hz, rot: -f * q },
      { kind: 'floodlight', tx: hx, tz: hz - r, rot: Math.PI },
      { kind: 'floodlight', tx: hx, tz: hz + r, rot: 0 },
    ];
    for (const k of kit) {
      const key = `${k.kind}@${k.tx},${k.tz}`;
      if (this.impossible.has(key)) continue;
      const s = sim.structureAt(k.tx, k.tz);
      if (s && s.kind === k.kind && s.owner === this.owner) continue;
      // Weapons come first: only spend steel on lights when there's plenty to spare.
      if (!p.canAfford(STRUCTURE_DEFS[k.kind].cost) || p.stock[Res.Steel] < 14) return false;
      if (sim.economy.canPlace(this.owner, k.kind, k.tx, k.tz).ok) {
        sim.enqueue({ type: 'build', owner: this.owner, kind: k.kind, tx: k.tx, tz: k.tz, rot: k.rot });
        this.lastBuildAt = sim.elapsed;
        return false;
      }
      this.impossible.add(key);
    }
    return true;
  }

  private lastFlareAt = -1e9;

  /** At night, light up intruders near the base with a flare. */
  private flares(sim: Sim): void {
    if (sim.cycle.daylight > 0.3 || sim.elapsed - this.lastFlareAt < 25) return;
    const p = sim.economy.player(this.owner);
    if (p.funds < 80) return;
    const u = sim.units;
    let n = 0;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.enemy || !UNIT_TYPES[u.kind[i]].armed) continue;
      if (!sim.vision.isSeen(this.owner, i)) continue;
      if (Math.hypot(u.x[i] - this.home.x, u.z[i] - this.home.z) > this.ring + 12) continue;
      n++;
      sx += u.x[i];
      sz += u.z[i];
    }
    if (n === 0) return;
    this.lastFlareAt = sim.elapsed;
    sim.enqueue({ type: 'flare', owner: this.owner, x: sx / n, z: sz / n });
  }

  private isFrontCorner(pc: Piece): boolean {
    return this.front === 'west' ? pc.tx < this.home.x : pc.tx > this.home.x;
  }

  private tryBuild(sim: Sim, kind: StructureKind, near: Near): boolean {
    const anchor = this.anchorFor(sim, near);
    if (!anchor) return false;
    const spot = this.findSpot(sim, kind, anchor.x, anchor.z, kind === 'house' || kind === 'arms' ? 10 : 14);
    if (!spot) return false;
    sim.enqueue({ type: 'build', owner: this.owner, kind, tx: spot.tx, tz: spot.tz });
    this.lastBuildAt = sim.elapsed;
    return true;
  }

  /** Where to look for a building site. */
  private anchorFor(sim: Sim, near: Near): { x: number; z: number } | null {
    const map = sim.map;
    const { x: hx, z: hz } = this.home;
    const limit = 56;
    if (near === 'home') return { x: hx, z: hz };
    if (near === 'trees') {
      // The densest grove within reach: count living trees around each candidate.
      let best: { x: number; z: number } | null = null;
      let bestScore = -1;
      for (const t of map.trees) {
        if (t.wood <= 0 || Math.hypot(t.x - hx, t.z - hz) > limit) continue;
        let n = 0;
        for (const o of map.trees) if (o.wood > 0 && Math.abs(o.x - t.x) < 5 && Math.abs(o.z - t.z) < 5) n++;
        const score = n - Math.hypot(t.x - hx, t.z - hz) * 0.15;
        if (score > bestScore) {
          bestScore = score;
          best = { x: t.x, z: t.z };
        }
      }
      return best;
    }
    if (near === 'fertile' || near === 'rock' || near === 'oil') {
      const want = near === 'fertile' ? Tile.Fertile : near === 'oil' ? Tile.Oil : Tile.Rock;
      let best: { x: number; z: number } | null = null;
      let bestD = limit;
      for (let tz = Math.max(0, hz - limit); tz < Math.min(map.height, hz + limit); tz++) {
        for (let tx = Math.max(0, hx - limit); tx < Math.min(map.width, hx + limit); tx++) {
          const tile = map.tileAt(tx, tz);
          if (tile !== want && !(want === Tile.Rock && tile === Tile.Ruin)) continue;
          const d = Math.hypot(tx + 0.5 - hx, tz + 0.5 - hz);
          if (d < bestD && d > this.ring + 2) {
            bestD = d;
            best = { x: tx + 0.5, z: tz + 0.5 };
          }
        }
      }
      return best;
    }
    // 'producers': next to the producer farthest from any store.
    let best: { x: number; z: number } | null = null;
    let bestD = 8;
    for (const s of sim.structures) {
      if (s.owner !== this.owner || !STRUCTURE_DEFS[s.kind].producer) continue;
      let nearest = Infinity;
      for (const st of sim.structures) {
        if (st.owner === this.owner && STRUCTURE_DEFS[st.kind].storage?.kind === 'materials') {
          nearest = Math.min(nearest, Math.hypot(st.tx - s.tx, st.tz - s.tz));
        }
      }
      if (nearest > bestD) {
        bestD = nearest;
        best = { x: s.tx + s.w / 2, z: s.tz + s.h / 2 };
      }
    }
    return best ?? { x: hx, z: hz };
  }

  /** First valid site spiralling out from an anchor, keeping clear of the planned ring. */
  private findSpot(sim: Sim, kind: StructureKind, ax: number, az: number, maxR: number): { tx: number; tz: number } | null {
    const { w, h } = footprint(kind, 0);
    // Never build up against a doorway: boxed-in doors strand workers and soldiers.
    const doors = new Set<number>();
    for (const s of sim.structures) if (s.owner === this.owner) doors.add(Math.floor(s.doorZ) * sim.map.width + Math.floor(s.doorX));
    const nearDoor = (tx: number, tz: number): boolean => {
      for (let z = tz - 1; z <= tz + h; z++) for (let x = tx - 1; x <= tx + w; x++) if (doors.has(z * sim.map.width + x)) return true;
      return false;
    };
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const tx = Math.round(ax - w / 2) + dx;
          const tz = Math.round(az - h / 2) + dz;
          if (this.touchesReserve(tx, tz, w, h) || nearDoor(tx, tz)) continue;
          if (sim.economy.canPlace(this.owner, kind, tx, tz).ok) return { tx, tz };
        }
      }
    }
    return null;
  }

  private touchesReserve(tx: number, tz: number, w: number, h: number): boolean {
    for (let z = tz; z < tz + h; z++) for (let x = tx; x < tx + w; x++) if (this.reserved(x, z)) return true;
    return false;
  }

  // ---------------------------------------------------------------- military

  private military(sim: Sim): void {
    const u = sim.units;
    const p = sim.economy.player(this.owner);
    const army: number[] = [];
    const byKind = new Map<number, number>();
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.owner) continue;
      const t = UNIT_TYPES[u.kind[i]];
      if (!t.armed || u.kind[i] === UnitKind.Commander) continue;
      army.push(i);
      byKind.set(u.kind[i], (byKind.get(u.kind[i]) ?? 0) + 1);
    }
    for (const g of this.garrison) if (!u.isAlive(g)) this.garrison.delete(g);
    this.attackGroup = this.attackGroup.filter((id) => u.isAlive(id) && sim.combat.assault[id]);
    // Stragglers who never got out of the base (boxed in, lost the path) don't hold up the next attack.
    if (this.attackGroup.length && sim.elapsed - this.attackLaunchedAt > 120) {
      const stuck = this.attackGroup.filter((id) => Math.hypot(u.x[id] - this.home.x, u.z[id] - this.home.z) < this.ring + 8);
      if (stuck.length) {
        sim.enqueue({ type: 'stop', owner: this.owner, ids: stuck });
        this.attackGroup = this.attackGroup.filter((id) => !stuck.includes(id));
      }
    }
    // A spent assault (a few survivors still fighting on) doesn't hold up the next one either.
    if (this.attackGroup.length && sim.elapsed - this.attackLaunchedAt > 180 && this.attackGroup.length <= Math.max(2, this.launched.length * 0.25)) {
      this.attackGroup = [];
    }
    this.raidGroup = this.raidGroup.filter((id) => u.isAlive(id) && u.owner[id] === this.owner);

    // What should the arms factories make? Whatever is furthest below the desired mix.
    const mix: Partial<Record<number, number>> = {};
    for (const k of RECRUITABLE) mix[k] = this.weight(sim, k);
    let needKind: number = UnitKind.Rifleman;
    let needScore = Infinity;
    for (const k of RECRUITABLE) {
      const weight = mix[k] ?? 0;
      if (!weight) continue;
      const gear = UNIT_TYPES[k].gear!;
      const score = ((byKind.get(k) ?? 0) + p.stock[gear]) / weight;
      if (score < needScore) {
        needScore = score;
        needKind = k;
      }
    }
    const recipe = RECIPE_FOR[needKind] ?? 0;
    for (const s of sim.structures) {
      if (s.owner === this.owner && s.kind === 'arms' && s.recipe !== recipe) {
        sim.enqueue({ type: 'setRecipe', owner: this.owner, id: s.id, recipe });
      }
    }

    // Armor (Normal and up): tanks, a scout car, and on Hard a howitzer. With a decent infantry
    // force already, he saves up for the next tank instead of recruiting more riflemen.
    const pool = sim.structures.find((s) => s.owner === this.owner && s.kind === 'motorpool');
    let saving = false;
    if (pool && this.difficulty !== 'easy') {
      const n = (k: number): number => byKind.get(k) ?? 0;
      const hard = this.difficulty === 'hard';
      const want = this.personality.armor.find(([k, normal, onHard]) => n(k) < (hard ? onHard : normal))?.[0] ?? -1;
      if (want >= 0) {
        const t = UNIT_TYPES[want];
        // Only hold back infantry when the tank is nearly paid for (materials in hand, half the cash).
        saving = army.length >= 10 && p.stock[Res.Fuel] >= t.fuel && p.stock[Res.Steel] >= t.steel && p.funds >= t.funds * 0.5;
        if (p.idle >= 1 && !sim.economy.recruitBlocker(this.owner, want) && p.funds >= t.funds + 10) {
          sim.enqueue({ type: 'recruit', owner: this.owner, barracks: pool.id, kind: want, count: 1 });
          saving = false;
        }
      }
    }

    // Recruit one soldier per decision while weapons, funds and idle hands allow.
    const barracks = sim.structures.find((s) => s.owner === this.owner && s.kind === 'barracks');
    if (barracks && p.idle >= 2 && !saving) {
      let best = -1;
      let bestScore = Infinity;
      for (const k of RECRUITABLE) {
        const weight = mix[k] ?? 0;
        if (!weight || sim.economy.recruitBlocker(this.owner, k)) continue;
        if (p.funds < UNIT_TYPES[k].funds + 30) continue;
        const score = (byKind.get(k) ?? 0) / weight;
        if (score < bestScore) {
          bestScore = score;
          best = k;
        }
      }
      // Night raiders keep a special-forces team on hand before anything else.
      const ops = byKind.get(UnitKind.Operator) ?? 0;
      if (
        this.personality.nightOps &&
        this.difficulty !== 'easy' &&
        ops < (this.difficulty === 'hard' ? 6 : 4) &&
        !sim.economy.recruitBlocker(this.owner, UnitKind.Operator) &&
        p.funds >= UNIT_TYPES[UnitKind.Operator].funds + 5
      ) {
        best = UnitKind.Operator;
      }
      if (best >= 0) sim.enqueue({ type: 'recruit', owner: this.owner, barracks: barracks.id, kind: best, count: 1 });
    }

    const mine = (id: number): boolean => u.isAlive(id) && u.owner[id] === this.owner;
    this.saboteurs = this.saboteurs.filter(mine);
    if (this.stage) this.stage.ids = this.stage.ids.filter(mine);
    if (this.scout >= 0 && !mine(this.scout)) this.scout = -1;
    const busy = new Set([...this.raidGroup, ...this.saboteurs, ...(this.stage?.ids ?? []), this.scout]);
    const free = army.filter(
      (i) => !this.garrison.has(i) && !busy.has(i) && !sim.combat.assault[i] && u.order[i] !== Order.Control && u.task[i] !== Task.Recruit,
    );
    this.manageRaids(sim, free);
    this.updateIntel(sim);
    this.manageScout(sim, free);

    // Man the front wall (prefer marksmen and machine gunners up there).
    const deck = this.frontDeckTiles(sim);
    // Defenders stuck on the ground (e.g. assigned before stairs existed) try again.
    let k = 0;
    for (const g of this.garrison) {
      if (deck.length && u.layer[g] === 0 && u.order[g] === Order.Idle) {
        const t = deck[k % deck.length];
        sim.enqueue({ type: 'move', owner: this.owner, ids: [g], x: t.x, z: t.z, layer: 1 });
      }
      k++;
    }
    if (deck.length && this.garrison.size < this.tuning.garrison) {
      const pick = [...free]
        .filter((i) => !UNIT_TYPES[u.kind[i]].vehicle)
        .sort((a, b) => this.garrisonRank(u.kind[a]) - this.garrisonRank(u.kind[b]) || a - b)[0];
      if (pick !== undefined) {
        const t = deck[this.garrison.size % deck.length];
        this.garrison.add(pick);
        sim.enqueue({ type: 'move', owner: this.owner, ids: [pick], x: t.x, z: t.z, layer: 1 });
        free.splice(free.indexOf(pick), 1);
      }
    }

    // Defend: hit intruders near the base with whoever is free.
    const intruder = this.nearestIntruder(sim, 26);
    if (intruder >= 0) {
      const idle = free.filter((i) => u.order[i] === Order.Idle || u.order[i] === Order.Move);
      if (idle.length) sim.enqueue({ type: 'attack', owner: this.owner, ids: idle, target: intruder });
      return;
    }
    this.huntCommander(sim, free);
    this.nightSabotage(sim, free);

    // Attack when the field army is big enough (and has engineers if the enemy has walls).
    if (this.attackGroup.length === 0 && this.lastAttackLaunched && !this.reportedFailure) {
      // Only grumble if the assault was mostly wiped out (not when it simply won).
      this.reportedFailure = true;
      const survivors = this.launched.filter((id) => u.isAlive(id) && u.owner[id] === this.owner).length;
      if (survivors < this.launched.length * 0.3 && !sim.result) this.say(sim, 'attackFailed');
    }
    if (this.attackGroup.length > 0) {
      this.manageAssault(sim, free);
      return;
    }
    if (this.stage) {
      this.manageStage(sim);
      return;
    }
    const enemyWalls = sim.structures.some((s) => s.owner === this.enemy && STRUCTURE_DEFS[s.kind].armored);
    const engineers = free.filter((i) => u.kind[i] === UnitKind.Engineer || u.kind[i] === UnitKind.Operator).length;
    // Armor counts for more than one rifleman, and tanks/howitzers/breachers deal with walls themselves.
    const strength = free.reduce((a, i) => a + worth(u.kind[i]), 0);
    const breachers = engineers + free.filter((i) => UNIT_TYPES[u.kind[i]].siege || UNIT_TYPES[u.kind[i]].artillery || UNIT_TYPES[u.kind[i]].dozer).length;
    const canBreach = !enemyWalls || breachers > 0 || strength >= this.attackSize * 1.5;
    const scheduled = sim.elapsed >= this.nextAttackAt && strength >= this.attackSize;
    // Bold: with fresh intel showing we clearly outnumber them, go now rather than wait for the clock.
    const opportunity =
      this.difficulty !== 'easy' &&
      sim.elapsed >= this.tuning.firstAttack * 0.75 &&
      sim.elapsed - this.attackLaunchedAt > this.tuning.attackGap * 0.6 &&
      sim.elapsed - this.lastIntelAt < 90 &&
      strength >= Math.max(this.attackSize * 0.8, this.knownEnemy * 2.2 + 3);
    if (!canBreach || !(scheduled || opportunity)) return;
    // Nightshade waits for darkness unless the odds are overwhelming.
    if (this.personality.nightOps && sim.cycle.daylight > 0.35 && strength < this.attackSize * 1.6) return;
    this.launchAttack(sim, free, strength);
  }

  // ---------------------------------------------------------------- strategy

  private knownEnemy = 0;
  private lastIntelAt = -1e9;
  private scout = -1;
  private scoutTarget = { x: 0, z: 0 };
  private lastScoutAt = -1e9;
  private stage: { ids: number[]; x: number; z: number; since: number; size: number } | null = null;
  private saboteurs: number[] = [];
  private sabotageNight = -1;
  private sabotageCount = 0;
  private lastReinforceAt = -1e9;
  private launchedStrength = 0;
  private lastHuntAt = -1e9;

  /** What we've seen of the enemy's army lately (decays when nobody's looking). No vision cheats. */
  private updateIntel(sim: Sim): void {
    const u = sim.units;
    let seen = 0;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.enemy || !UNIT_TYPES[u.kind[i]].armed) continue;
      if (sim.vision.isSeen(this.owner, i)) seen += worth(u.kind[i]);
    }
    for (const s of sim.structures) if (s.owner === this.enemy && s.kind === 'guntower' && sim.combat.crewed(s)) seen += 3;
    if (seen >= this.knownEnemy * 0.8 && seen > 0) this.lastIntelAt = sim.elapsed;
    this.knownEnemy = Math.max(seen, this.knownEnemy * 0.995);
  }

  /** Normal and up: send a fast soldier to have a look at the enemy base every couple of minutes. */
  private manageScout(sim: Sim, free: number[]): void {
    if (this.difficulty === 'easy') return;
    const u = sim.units;
    if (this.scout >= 0) {
      const i = this.scout;
      if (u.order[i] === Order.Idle) {
        if (Math.hypot(u.x[i] - this.scoutTarget.x, u.z[i] - this.scoutTarget.z) < 6) {
          sim.enqueue({ type: 'move', owner: this.owner, ids: [i], x: this.home.x, z: this.home.z + 2 });
          this.scout = -1; // on the way home: back to the army
        } else {
          sim.enqueue({ type: 'move', owner: this.owner, ids: [i], x: this.scoutTarget.x, z: this.scoutTarget.z });
        }
      }
      return;
    }
    if (sim.elapsed < 100 || sim.elapsed - this.lastScoutAt < 140 || this.attackGroup.length) return;
    const hq = sim.economy.hqOf(this.enemy);
    if (!hq) return;
    const pick = free
      .filter((i) => u.order[i] === Order.Idle && (u.kind[i] === UnitKind.ArmoredCar || u.kind[i] === UnitKind.Rifleman))
      .sort((a, b) => (u.kind[a] === UnitKind.ArmoredCar ? 0 : 1) - (u.kind[b] === UnitKind.ArmoredCar ? 0 : 1) || a - b)[0];
    if (pick === undefined) return;
    const ex = hq.tx + hq.w / 2;
    const ez = hq.tz + hq.h / 2;
    const d = Math.hypot(this.home.x - ex, this.home.z - ez) || 1;
    // A point outside their walls, a little off the straight line, with a view of the base.
    const side = sim.rng.next() < 0.5 ? -1 : 1;
    this.scoutTarget = {
      x: ex + ((this.home.x - ex) / d) * 18 + ((-(this.home.z - ez) / d) * 8 * side),
      z: ez + ((this.home.z - ez) / d) * 18 + (((this.home.x - ex) / d) * 8 * side),
    };
    this.scout = pick;
    this.lastScoutAt = sim.elapsed;
    free.splice(free.indexOf(pick), 1);
    sim.enqueue({ type: 'move', owner: this.owner, ids: [pick], x: this.scoutTarget.x, z: this.scoutTarget.z });
  }

  /**
   * Pick the approach: the side of the enemy base with the least in the way (walls, towers, gun towers,
   * mortars, traps). Returns a staging point out on that side, or null to go straight in.
   */
  private attackSide(sim: Sim, ex: number, ez: number): { x: number; z: number } | null {
    const dirs: [number, number][] = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    const toUs = { x: this.home.x - ex, z: this.home.z - ez };
    let direct = 0;
    let best = -1;
    let bestScore = Infinity;
    const scores = dirs.map(([dx, dz]) => {
      let score = 0;
      for (const s of sim.structures) {
        if (s.owner !== this.enemy) continue;
        const w = DEFENSE_WEIGHT[s.kind];
        if (!w) continue;
        const rx = s.tx + s.w / 2 - ex;
        const rz = s.tz + s.h / 2 - ez;
        const along = rx * dx + rz * dz;
        const across = Math.abs(rx * dz - rz * dx);
        if (along > 3 && along < 24 && across < along + 3) score += w;
      }
      return score;
    });
    dirs.forEach(([dx, dz], k) => {
      if (dx * toUs.x + dz * toUs.z > dirs[direct][0] * toUs.x + dirs[direct][1] * toUs.z) direct = k;
    });
    const at = (k: number): { x: number; z: number } => ({
      x: Math.min(Math.max(ex + dirs[k][0] * 22, 6), sim.map.width - 7),
      z: Math.min(Math.max(ez + dirs[k][1] * 22, 6), sim.map.height - 7),
    });
    dirs.forEach(([dx, dz], k) => {
      // Only the two flanks: going round the back means marching past every gun they have.
      if (k !== direct && dx * dirs[direct][0] + dz * dirs[direct][1] !== 0) return;
      const p = at(k);
      // A longer walk round costs a little.
      const score = scores[k] + Math.hypot(p.x - this.home.x, p.z - this.home.z) / 12;
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    });
    if (best < 0 || best === direct || scores[direct] - scores[best] < 6) return null;
    return at(best);
  }

  /** Go: straight in, or (Normal and up) feint at the front while the main body swings round to a weak side. */
  private launchAttack(sim: Sim, free: number[], strength: number): void {
    const u = sim.units;
    const hq = sim.economy.hqOf(this.enemy);
    if (!hq) return;
    let ids = [...free];
    // All in: far stronger than anything we've seen of them, and late enough to finish it.
    if (this.difficulty !== 'easy' && sim.elapsed > 600 && strength >= this.knownEnemy * 2 + 6 && this.garrison.size > 2) {
      const pulled = [...this.garrison].slice(2);
      for (const g of pulled) this.garrison.delete(g);
      ids = ids.concat(pulled);
    }
    this.nextAttackAt = sim.elapsed + this.tuning.attackGap;
    this.attackSize += this.tuning.attackGrowth;
    this.reportedFailure = false;
    this.sayAttack(sim, ids);
    const side = this.difficulty === 'easy' ? null : this.attackSide(sim, hq.tx + hq.w / 2, hq.tz + hq.h / 2);
    if (side) {
      const feint = ids.length >= 9 ? ids.filter((i) => u.kind[i] === UnitKind.Rifleman).slice(0, 3) : [];
      if (feint.length) sim.enqueue({ type: 'assault', owner: this.owner, ids: feint, target: this.enemy });
      const main = ids.filter((i) => !feint.includes(i));
      this.stage = { ids: main, x: side.x, z: side.z, since: sim.elapsed, size: main.length };
      sim.enqueue({ type: 'move', owner: this.owner, ids: main, x: side.x, z: side.z });
      return;
    }
    this.assaultNow(sim, ids);
  }

  private assaultNow(sim: Sim, ids: number[]): void {
    const u = sim.units;
    sim.enqueue({ type: 'assault', owner: this.owner, ids, target: this.enemy });
    this.attackGroup = [...ids];
    this.launched = [...ids];
    this.launchedStrength = ids.reduce((a, i) => a + worth(u.kind[i]), 0);
    this.lastAttackLaunched = true;
    this.attackLaunchedAt = sim.elapsed;
  }

  /** The flanking body goes in once most of it has reached the staging point (or it's taking too long). */
  private manageStage(sim: Sim): void {
    const st = this.stage!;
    const u = sim.units;
    if (st.ids.length === 0) {
      this.stage = null;
      return;
    }
    const there = st.ids.filter((i) => Math.hypot(u.x[i] - st.x, u.z[i] - st.z) < 7).length;
    // Caught on the way round (someone's hurt or down): fight from where we are.
    const engaged = st.ids.length < st.size || st.ids.some((i) => u.hp[i] < UNIT_TYPES[u.kind[i]].hp);
    if (there >= st.ids.length * 0.7 || engaged || sim.elapsed - st.since > 50) {
      this.stage = null;
      this.assaultNow(sim, st.ids);
    }
  }

  /** An attack under way: feed it while it's winning; pull the survivors out when it's broken. */
  private manageAssault(sim: Sim, free: number[]): void {
    const u = sim.units;
    const now = this.attackGroup.reduce((a, i) => a + worth(u.kind[i]), 0);
    if (sim.elapsed - this.attackLaunchedAt > 45 && now < this.launchedStrength * 0.3) {
      let cx = 0;
      let cz = 0;
      for (const i of this.attackGroup) {
        cx += u.x[i];
        cz += u.z[i];
      }
      cx /= this.attackGroup.length;
      cz /= this.attackGroup.length;
      let near = 0;
      for (let j = 0; j < u.count; j++) {
        if (!u.alive[j] || u.owner[j] !== this.enemy || !UNIT_TYPES[u.kind[j]].armed || !sim.vision.isSeen(this.owner, j)) continue;
        if (Math.hypot(u.x[j] - cx, u.z[j] - cz) < 16) near += worth(u.kind[j]);
      }
      if (near > now * 1.5 && this.difficulty !== 'easy') {
        // Broken and outgunned: live to fight again.
        const back = [...this.attackGroup];
        sim.enqueue({ type: 'stop', owner: this.owner, ids: back });
        sim.enqueue({ type: 'move', owner: this.owner, ids: back, x: this.home.x, z: this.home.z + 2 });
        this.attackGroup = [];
        this.nextAttackAt = Math.min(this.nextAttackAt, sim.elapsed + this.tuning.attackGap * 0.6);
        this.reportedFailure = true;
        this.say(sim, 'attackFailed');
      }
      return;
    }
    // Going well: keep the pressure on with whoever is ready at home (keeping a couple back).
    if (this.difficulty === 'easy' || sim.elapsed - this.lastReinforceAt < 25 || now < this.launchedStrength * 0.4) return;
    const send = free.filter((i) => u.order[i] === Order.Idle).slice(2);
    if (send.reduce((a, i) => a + worth(u.kind[i]), 0) < 3) return;
    this.lastReinforceAt = sim.elapsed;
    sim.enqueue({ type: 'assault', owner: this.owner, ids: send, target: this.enemy });
    this.attackGroup.push(...send);
    this.launched.push(...send);
    this.launchedStrength += send.reduce((a, i) => a + worth(u.kind[i]), 0);
  }

  /** Bold: an enemy Commander caught out in the open gets hunted down (that wins the game). */
  private huntCommander(sim: Sim, free: number[]): void {
    if (this.difficulty === 'easy' || sim.elapsed - this.lastHuntAt < 20) return;
    const u = sim.units;
    const c = sim.commanderOf(this.enemy);
    if (c < 0 || !u.isAlive(c) || !sim.vision.isSeen(this.owner, c)) return;
    const hq = sim.economy.hqOf(this.enemy);
    if (hq && Math.hypot(u.x[c] - (hq.tx + hq.w / 2), u.z[c] - (hq.tz + hq.h / 2)) < 12) return; // safe at home
    const hunters = free
      .filter((i) => (u.order[i] === Order.Idle || u.order[i] === Order.Move) && Math.hypot(u.x[i] - u.x[c], u.z[i] - u.z[c]) < 45)
      .sort((a, b) => Math.hypot(u.x[a] - u.x[c], u.z[a] - u.z[c]) - Math.hypot(u.x[b] - u.x[c], u.z[b] - u.z[c]) || a - b)
      .slice(0, 6);
    if (hunters.length < 2) return;
    this.lastHuntAt = sim.elapsed;
    sim.enqueue({ type: 'attack', owner: this.owner, ids: hunters, target: c });
    for (const h of hunters) free.splice(free.indexOf(h), 1);
  }

  /**
   * Sneaky: once a night (Normal and up), special forces slip over the walls to blow up the enemy's
   * generators (lights out), then gun towers, then the HQ. They come home at dawn.
   */
  private nightSabotage(sim: Sim, free: number[]): void {
    if (this.difficulty === 'easy') return;
    const u = sim.units;
    const night = sim.cycle.daylight < 0.3;
    if (!night) {
      if (this.saboteurs.length) {
        sim.enqueue({ type: 'move', owner: this.owner, ids: this.saboteurs, x: this.home.x, z: this.home.z + 2 });
        this.saboteurs = [];
      }
      return;
    }
    if (this.saboteurs.length) {
      const idle = this.saboteurs.filter((i) => u.order[i] === Order.Idle);
      const target = idle.length ? this.sabotageTarget(sim) : null;
      if (target) sim.enqueue({ type: 'attackStructure', owner: this.owner, ids: idle, structure: target.id });
      return;
    }
    const nightNo = Math.floor(sim.timeSec / CYCLE_SEC);
    const raidsPerNight = this.personality.nightOps ? 2 : 1;
    if (this.sabotageNight === nightNo && this.sabotageCount >= raidsPerNight) return;
    if (this.sabotageNight !== nightNo) this.sabotageCount = 0;
    const ops = free
      .filter((i) => u.kind[i] === UnitKind.Operator && u.charges[i] > 0 && u.order[i] === Order.Idle)
      .slice(0, this.personality.nightOps ? 4 : 3);
    if (ops.length < 2) return;
    const target = this.sabotageTarget(sim);
    if (!target) return;
    this.sabotageNight = nightNo;
    this.sabotageCount++;
    this.saboteurs = ops;
    for (const o of ops) free.splice(free.indexOf(o), 1);
    sim.enqueue({ type: 'attackStructure', owner: this.owner, ids: ops, structure: target.id });
  }

  private sabotageTarget(sim: Sim): Structure | null {
    for (const kind of ['generator', 'guntower', 'mortar', 'hq'] as StructureKind[]) {
      let best: Structure | null = null;
      let bestD = Infinity;
      for (const s of sim.structures) {
        if (s.owner !== this.enemy || s.kind !== kind) continue;
        const d = Math.hypot(s.tx - this.home.x, s.tz - this.home.z);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best) return best;
    }
    return null;
  }

  private lastAttackLaunched = false;
  private attackLaunchedAt = -1e9;
  private reportedFailure = false;
  private launched: number[] = [];

  /**
   * Jackal's raids: a few fast soldiers (cars first) go after the enemy's work sites, move on to the
   * next one nearby, and come home when there's nothing soft left in reach. `free` loses the raiders.
   */
  private manageRaids(sim: Sim, free: number[]): void {
    const r = this.personality.raids;
    if (!r) return;
    const u = sim.units;
    const { x: hx, z: hz } = this.home;
    if (this.raidGroup.length) {
      const idle = this.raidGroup.filter((id) => u.order[id] === Order.Idle);
      if (idle.length === 0) return;
      let cx = 0;
      let cz = 0;
      for (const id of this.raidGroup) {
        cx += u.x[id];
        cz += u.z[id];
      }
      cx /= this.raidGroup.length;
      cz /= this.raidGroup.length;
      const homeD = Math.hypot(cx - hx, cz - hz);
      if (homeD < this.ring + 4) {
        this.raidGroup = []; // home again: back into the army
        return;
      }
      const next = homeD > this.ring + 12 ? this.raidPick(sim, cx, cz, 22) : null;
      if (next) {
        this.raidTried.add(next.id);
        sim.enqueue({ type: 'attackStructure', owner: this.owner, ids: idle, structure: next.id });
      } else {
        sim.enqueue({ type: 'move', owner: this.owner, ids: idle, x: hx, z: hz + 2 });
      }
      return;
    }
    if (sim.elapsed < r.from || sim.elapsed - this.lastRaidAt < r.every || this.attackGroup.length > 0) return;
    const target = this.raidPick(sim, hx, hz, 200);
    if (!target) return;
    const tx = target.tx + target.w / 2;
    const tz = target.tz + target.h / 2;
    const fast = (k: number): number => (k === UnitKind.ArmoredCar ? 0 : k === UnitKind.Rifleman ? 1 : k === UnitKind.Gunner ? 2 : 9);
    const pool = free
      .filter((i) => u.order[i] === Order.Idle && fast(u.kind[i]) < 9)
      .sort((a, b) => fast(u.kind[a]) - fast(u.kind[b]) || Math.hypot(u.x[a] - tx, u.z[a] - tz) - Math.hypot(u.x[b] - tx, u.z[b] - tz) || a - b);
    if (pool.length < Math.min(3, r.size)) return;
    const group = pool.slice(0, r.size);
    this.raidTried.add(target.id);
    sim.enqueue({ type: 'attackStructure', owner: this.owner, ids: group, structure: target.id });
    this.raidGroup = group;
    this.lastRaidAt = sim.elapsed;
    this.raidsLaunched++;
    for (const id of group) free.splice(free.indexOf(id), 1);
    if (this.raidsLaunched % 2 === 1) this.say(sim, 'raid');
  }

  /** Enemy work sites (farms, camps, derricks) first, then any soft building; nearest to (x, z). */
  private raidPick(sim: Sim, x: number, z: number, maxD: number): Structure | null {
    let best: Structure | null = null;
    let bestScore = Infinity;
    for (const s of sim.structures) {
      if (s.owner !== this.enemy || this.raidTried.has(s.id)) continue;
      const def = STRUCTURE_DEFS[s.kind];
      if (def.armored || def.trap || s.kind === 'ramp' || s.kind === 'floodlight' || s.kind === 'stairs') continue;
      const d = Math.hypot(s.tx + s.w / 2 - x, s.tz + s.h / 2 - z);
      if (d > maxD) continue;
      const score = d + (def.producer ? 0 : 25);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  private garrisonRank(kind: number): number {
    return kind === UnitKind.Marksman ? 0 : kind === UnitKind.Gunner ? 1 : kind === UnitKind.Rifleman ? 2 : 3;
  }

  /** Built wall-top tiles on the side facing the enemy (gun towers first: they need a crew to fire). */
  private frontDeckTiles(sim: Sim): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const guns: { x: number; z: number }[] = [];
    const map = sim.map;
    for (const g of this.gunTowerSpots()) {
      const s = sim.structureAt(g.tx, g.tz);
      if (s && s.kind === 'guntower' && s.owner === this.owner) guns.push({ x: s.tx + 1, z: s.tz + 1 });
    }
    for (const pc of this.pieces) {
      if (pc.kind !== 'wall' || pc.side !== this.front) continue;
      const i = map.idx(pc.tx, pc.tz);
      if (map.deck[i] && map.structOwner[i] === this.owner) out.push({ x: pc.tx + 0.5, z: pc.tz + 0.5 });
    }
    // Spread defenders out from the gate.
    return [...guns, ...out.sort((a, b) => Math.abs(a.z - this.home.z) - Math.abs(b.z - this.home.z)).filter((_, k) => k % 2 === 0)];
  }

  private lastDroneAt = -1e9;
  private reconNight = -1;

  /**
   * Drones: a recon drone watches the front approach at night; during an assault (Normal and up) a
   * strike drone goes after a gun tower or a defender on the walls.
   */
  private drones(sim: Sim): void {
    const u = sim.units;
    const bay = sim.structures.find((s) => s.owner === this.owner && s.kind === 'dronebay');
    const night = sim.cycle.daylight < 0.35;
    const f = this.front === 'west' ? -1 : 1;
    const watch = { x: this.home.x + f * (this.ring + 12), z: this.home.z };
    let recon = 0;
    let strike = 0;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.owner) continue;
      const k = u.kind[i];
      if (k !== UnitKind.ReconDrone && k !== UnitKind.StrikeDrone) continue;
      const busy = u.order[i] !== Order.Idle || u.battery[i] < RETURN_AT + 20;
      if (k === UnitKind.ReconDrone) {
        recon++;
        if (busy) continue;
        if (night) sim.enqueue({ type: 'move', owner: this.owner, ids: [i], x: watch.x, z: watch.z });
      } else {
        strike++;
        if (busy) continue;
        const tgt = this.strikeTarget(sim);
        if (tgt.structure >= 0) sim.enqueue({ type: 'attackStructure', owner: this.owner, ids: [i], structure: tgt.structure });
        else if (tgt.unit >= 0) sim.enqueue({ type: 'attack', owner: this.owner, ids: [i], target: tgt.unit });
      }
    }
    if (!bay || !bay.powered || sim.elapsed - this.lastDroneAt < 40) return;
    const p = sim.economy.player(this.owner);
    if (p.funds < 150) return;
    let kind = -1;
    const nightNo = Math.floor(sim.timeSec / CYCLE_SEC);
    if (night && recon === 0 && this.reconNight !== nightNo) {
      kind = UnitKind.ReconDrone;
      this.reconNight = nightNo; // one recon drone a night: if it's shot down, so be it
    } else if (this.difficulty !== 'easy' && strike === 0) {
      const tgt = this.strikeTarget(sim);
      const commander = tgt.unit >= 0 && tgt.unit === sim.commanderOf(this.enemy);
      if ((this.attackGroup.length > 0 || commander) && (tgt.structure >= 0 || tgt.unit >= 0)) kind = UnitKind.StrikeDrone;
    }
    if (kind < 0 || sim.drones.launchBlocker(this.owner, bay.id, kind)) return;
    this.lastDroneAt = sim.elapsed;
    sim.enqueue({ type: 'launchDrone', owner: this.owner, bay: bay.id, kind });
  }

  /** Best strike-drone target: their Commander if we can see it, a crewed gun tower, else a wall-top defender. */
  private strikeTarget(sim: Sim): { structure: number; unit: number } {
    const u = sim.units;
    const c = sim.commanderOf(this.enemy);
    if (this.difficulty !== 'easy' && c >= 0 && u.isAlive(c) && sim.vision.isSeen(this.owner, c)) return { structure: -1, unit: c };
    for (const s of sim.structures) {
      if (s.owner === this.enemy && s.kind === 'guntower' && sim.combat.crewed(s)) return { structure: s.id, unit: -1 };
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.enemy || u.layer[i] !== 1 || !sim.vision.isSeen(this.owner, i)) continue;
      const d = Math.hypot(u.x[i] - this.home.x, u.z[i] - this.home.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { structure: -1, unit: best };
  }

  private nearestIntruder(sim: Sim, radius: number): number {
    const u = sim.units;
    let best = -1;
    let bestD = radius;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.owner[i] !== this.enemy || !UNIT_TYPES[u.kind[i]].armed) continue;
      const d = Math.hypot(u.x[i] - this.home.x, u.z[i] - this.home.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Debug/inspection summary (used by tests and the balancing report). */
  summary(sim: Sim): string {
    const p = sim.economy.player(this.owner);
    const kinds = new Map<string, number>();
    for (const s of sim.structures) if (s.owner === this.owner) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    const soldiers = sim.units.kind.filter(
      (k, i) => sim.units.alive[i] && sim.units.owner[i] === this.owner && UNIT_TYPES[k].armed,
    ).length;
    const gear = GEAR_RES.map((g) => Math.floor(p.stock[g])).join('/');
    const arms = sim.structures.filter((st) => st.owner === this.owner && st.kind === 'arms').map((st) => st.status).join(',');
    return `gear ${gear} arms[${arms}] pop ${p.population}/${p.housing} morale ${p.morale.toFixed(0)} $${p.funds.toFixed(0)} T${p.stock[Res.Timber].toFixed(0)} C${p.stock[Res.Concrete].toFixed(0)} S${p.stock[Res.Steel].toFixed(0)} soldiers ${soldiers} garrison ${this.garrison.size} | ${[...kinds.entries()].map(([k, n]) => `${k}:${n}`).join(' ')}`;
  }
}
