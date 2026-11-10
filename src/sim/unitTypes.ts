/** Data-driven unit definitions (more arrive in M2). */

export interface UnitType {
  id: number;
  key: string;
  name: string;
  /** Tiles per second. */
  speed: number;
  hp: number;
  /** Collision radius in tiles. */
  radius: number;
  /** Weapon range in tiles. */
  range: number;
  damage: number;
  /** Ticks between shots. */
  cooldown: number;
  /** Can fight (auto-engage / fire). */
  armed: boolean;
  /** Can be possessed in over-the-shoulder mode. */
  controllable: boolean;
  /** Player can select and order it directly. */
  selectable: boolean;
}

export const UNIT_TYPES: UnitType[] = [
  {
    id: 0,
    key: 'rifleman',
    name: 'Rifleman',
    speed: 2.4,
    hp: 100,
    radius: 0.28,
    range: 24,
    damage: 34,
    cooldown: 4,
    armed: true,
    controllable: true,
    selectable: true,
  },
  {
    id: 1,
    key: 'commander',
    name: 'Commander',
    speed: 2.6,
    hp: 400,
    radius: 0.3,
    range: 24,
    damage: 40,
    cooldown: 3,
    armed: true,
    controllable: true,
    selectable: true,
  },
  {
    id: 2,
    key: 'civilian',
    name: 'Civilian',
    speed: 2.5,
    hp: 40,
    radius: 0.24,
    range: 0,
    damage: 0,
    cooldown: 0,
    armed: false,
    controllable: false,
    selectable: false,
  },
];

export const UnitKind = {
  Rifleman: 0,
  Commander: 1,
  Civilian: 2,
} as const;
