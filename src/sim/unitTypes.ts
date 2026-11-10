/** Data-driven unit definitions. Tweak numbers here to balance. */

import { Res, type ResId } from './structures';

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
  /** Breach charges carried (engineers). */
  charges: number;

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
    gear: Res.Charges,
    funds: 30,
    blurb: 'Blows breaches in walls and gates (2 charges each).',
  },
];

export const UnitKind = {
  Rifleman: 0,
  Commander: 1,
  Civilian: 2,
  Gunner: 3,
  Marksman: 4,
  Engineer: 5,
} as const;

/** Units the barracks can train, in menu order. */
export const RECRUITABLE = [UnitKind.Rifleman, UnitKind.Gunner, UnitKind.Marksman, UnitKind.Engineer];
