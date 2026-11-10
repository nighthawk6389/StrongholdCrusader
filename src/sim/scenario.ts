import { generateDesertMap } from './map';
import { Sim } from './sim';
import { Res } from './structures';
import { UnitKind } from './unitTypes';
import { WaveDirector, type Wave } from './waves';

export const PLAYER = 1;
export const ENEMY = 2;

export type GameMode = 'sandbox' | 'hold';

export interface Scenario {
  sim: Sim;
  mode: GameMode;
  player: number;
  playerBase: { x: number; z: number };
  enemyBase: { x: number; z: number };
}

type Side = 'east' | 'west' | 'north' | 'south';

interface BaseLayout {
  cx: number;
  cz: number;
  /** Chebyshev radius of the wall ring. */
  ring: number;
  /** Sides with a gatehouse in the middle. */
  gates: Side[];
}

/** Square compound: corner towers, a gatehouse per listed side, walls everywhere else. */
function buildWalledBase(sim: Sim, owner: number, b: BaseLayout): void {
  const { cx, cz, ring, gates } = b;
  const corners: [number, number][] = [
    [cx - ring, cz - ring],
    [cx + ring - 1, cz - ring],
    [cx - ring, cz + ring - 1],
    [cx + ring - 1, cz + ring - 1],
  ];
  for (const [x, z] of corners) sim.placeStructure('tower', owner, x, z);

  const quarter = Math.PI / 2;
  if (gates.includes('east')) sim.placeStructure('gate', owner, cx + ring, cz - 1, quarter);
  if (gates.includes('west')) sim.placeStructure('gate', owner, cx - ring, cz - 1, quarter);
  if (gates.includes('north')) sim.placeStructure('gate', owner, cx - 1, cz - ring, 0);
  if (gates.includes('south')) sim.placeStructure('gate', owner, cx - 1, cz + ring, 0);

  for (let z = cz - ring; z <= cz + ring; z++) {
    for (let x = cx - ring; x <= cx + ring; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== ring) continue;
      sim.placeStructure('wall', owner, x, z);
    }
  }
}

function placeStairs(sim: Sim, owner: number, spots: [number, number][]): void {
  for (const [x, z] of spots) {
    const s = sim.placeStructure('stairs', owner, x, z);
    if (s) s.rot = sim.economy.stairsFacing(x, z, owner) ?? 0;
  }
}

/** Hold the Line: six escalating waves from the east, two of them at night. */
export const HOLD_WAVES: Wave[] = [
  { at: 150, groups: [{ kind: UnitKind.Rifleman, n: 6 }] },
  {
    at: 300,
    groups: [
      { kind: UnitKind.Rifleman, n: 8 },
      { kind: UnitKind.Gunner, n: 2 },
    ],
  },
  {
    at: 450,
    groups: [
      { kind: UnitKind.Rifleman, n: 10 },
      { kind: UnitKind.Gunner, n: 2 },
      { kind: UnitKind.Engineer, n: 2 },
    ],
  },
  {
    at: 600,
    groups: [
      { kind: UnitKind.Rifleman, n: 10 },
      { kind: UnitKind.Gunner, n: 3 },
      { kind: UnitKind.Engineer, n: 3 },
      { kind: UnitKind.Marksman, n: 2 },
    ],
  },
  {
    at: 750,
    groups: [
      { kind: UnitKind.Rifleman, n: 14 },
      { kind: UnitKind.Gunner, n: 4 },
      { kind: UnitKind.Engineer, n: 4 },
      { kind: UnitKind.Marksman, n: 3 },
    ],
  },
  {
    at: 900,
    groups: [
      { kind: UnitKind.Rifleman, n: 18 },
      { kind: UnitKind.Gunner, n: 5 },
      { kind: UnitKind.Engineer, n: 5 },
      { kind: UnitKind.Marksman, n: 4 },
    ],
  },
];

export function createScenario(mode: GameMode, seed = 1337): Scenario {
  const playerBase = { x: 28, z: 64 };
  const enemyBase = { x: 100, z: 70 };
  const map = generateDesertMap({
    width: 128,
    height: 128,
    seed,
    clearings: [
      { x: playerBase.x, z: playerBase.z, r: 15 },
      { x: enemyBase.x, z: enemyBase.z, r: 10 },
    ],
    oases: [
      { x: 47, z: 38, r: 3.5 },
      { x: 64, z: 66, r: 4.5 },
      { x: 86, z: 96, r: 3 },
    ],
    extraOases: 2,
    oilPatches: 3,
    groves: [
      { x: 10, z: 86, r: 5 },
      { x: 44, z: 88, r: 4 },
      { x: 112, z: 50, r: 4 },
    ],
  });

  // Start mid-morning: ~4.5 minutes until dusk.
  const sim = new Sim({ map, seed, startSec: 45 });
  const P = playerBase;

  // --- Player compound: the pre-built core inside a walled ring with four gatehouses.
  sim.placeStructure('hq', PLAYER, P.x - 2, P.z - 2);
  sim.placeStructure('hub', PLAYER, P.x - 7, P.z + 2);
  sim.placeStructure('house', PLAYER, P.x - 8, P.z - 8);
  sim.placeStructure('house', PLAYER, P.x - 5, P.z - 8);
  sim.placeStructure('depot', PLAYER, P.x + 3, P.z - 8);
  sim.placeStructure('rations', PLAYER, P.x + 3, P.z + 5);
  sim.placeStructure('barracks', PLAYER, P.x + 6, P.z - 2);
  sim.placeStructure('armory', PLAYER, P.x - 8, P.z - 4);
  buildWalledBase(sim, PLAYER, { cx: P.x, cz: P.z, ring: 12, gates: ['east', 'west', 'north', 'south'] });
  placeStairs(sim, PLAYER, [
    [P.x - 11, P.z - 6],
    [P.x - 11, P.z + 6],
    [P.x + 11, P.z - 6],
    [P.x + 11, P.z + 6],
    [P.x - 6, P.z - 11],
    [P.x + 6, P.z - 11],
    [P.x - 6, P.z + 11],
    [P.x + 6, P.z + 11],
  ]);
  sim.placeStructure('floodlight', PLAYER, P.x + 9, P.z - 5, Math.PI / 2);
  sim.placeStructure('floodlight', PLAYER, P.x + 9, P.z + 5, Math.PI / 2);
  sim.placeStructure('floodlight', PLAYER, P.x - 9, P.z, -Math.PI / 2);
  sim.placeStructure('floodlight', PLAYER, P.x, P.z + 10, 0);

  const eco = sim.economy.player(PLAYER);
  eco.active = true;
  sim.economy.spawnArrivals(PLAYER, 8);
  sim.spawnUnit(UnitKind.Commander, PLAYER, P.x - 3.5, P.z + 0.5, Math.PI / 2);

  if (mode === 'hold') {
    eco.funds = 500;
    eco.stock[Res.Timber] = 100;
    eco.stock[Res.Concrete] = 70;
    eco.stock[Res.Steel] = 24;
    eco.stock[Res.Produce] = 60;
    eco.stock[Res.Rifle] = 6;
    eco.stock[Res.MG] = 1;
    for (let i = 0; i < 8; i++) {
      const kind = i < 2 ? UnitKind.Gunner : UnitKind.Rifleman;
      sim.spawnUnit(kind, PLAYER, P.x + 2.6 + Math.floor(i / 4) * 0.8, P.z - 1.5 + (i % 4) * 0.8, Math.PI / 2);
    }
  } else {
    eco.funds = 300;
    eco.stock[Res.Timber] = 60;
    eco.stock[Res.Concrete] = 30;
    eco.stock[Res.Steel] = 10;
    eco.stock[Res.Produce] = 50;
    eco.stock[Res.Rifle] = 4;
    for (let i = 0; i < 18; i++) {
      sim.spawnUnit(UnitKind.Rifleman, PLAYER, P.x + 2.6 + Math.floor(i / 6) * 0.8, P.z - 2 + (i % 6) * 0.8, Math.PI / 2);
    }
  }

  // --- Hostile outpost (east)
  const E = enemyBase;
  sim.placeStructure('hq', ENEMY, E.x + 2, E.z - 5);
  sim.placeStructure('depot', ENEMY, E.x - 1, E.z - 4);
  sim.placeStructure('house', ENEMY, E.x + 2, E.z + 2);
  sim.placeStructure('house', ENEMY, E.x - 3, E.z + 2);
  buildWalledBase(sim, ENEMY, { cx: E.x, cz: E.z, ring: 7, gates: ['west'] });
  sim.placeStructure('floodlight', ENEMY, E.x - 5, E.z - 3, -Math.PI / 2);
  sim.placeStructure('floodlight', ENEMY, E.x - 5, E.z + 3, -Math.PI / 2);
  sim.placeStructure('floodlight', ENEMY, E.x + 5, E.z, Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    sim.spawnUnit(UnitKind.Rifleman, ENEMY, E.x - 3 + (i % 4) * 1.2, E.z - 1 + Math.floor(i / 4) * 1.2, -Math.PI / 2);
  }

  if (mode === 'hold') {
    sim.director = new WaveDirector(ENEMY, PLAYER, HOLD_WAVES, { x: E.x - 12, z: E.z });
    sim.defender = PLAYER;
  } else {
    // Sandbox: a patrol camped outside the hostile gate to skirmish with.
    for (let i = 0; i < 6; i++) {
      sim.spawnUnit(UnitKind.Rifleman, ENEMY, E.x - 14 + (i % 3) * 0.9, E.z - 1 + Math.floor(i / 3) * 0.9, -Math.PI / 2);
    }
  }

  return { sim, mode, player: PLAYER, playerBase, enemyBase };
}

/** The open sandbox (economy + skirmish), kept for tests and the M0/M1 flow. */
export function createM0Scenario(seed = 1337): Scenario {
  return createScenario('sandbox', seed);
}
