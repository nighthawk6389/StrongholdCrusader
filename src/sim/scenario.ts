import { generateDesertMap } from './map';
import { Sim } from './sim';
import { Res } from './structures';
import { UnitKind } from './unitTypes';
import { AiCommander, DIFFICULTY, OLD_SARGE, type Difficulty } from './ai';
import { ringBlueprint, type Side } from './blueprint';
import { WaveDirector, type Wave } from './waves';

export const PLAYER = 1;
export const ENEMY = 2;

export type GameMode = 'sandbox' | 'hold' | 'skirmish';

export interface Scenario {
  sim: Sim;
  mode: GameMode;
  /** Skirmish opponent (null in other modes). */
  ai: AiCommander | null;
  player: number;
  playerBase: { x: number; z: number };
  enemyBase: { x: number; z: number };
}

/** Build a compound from the shared ring blueprint (scenario setup: free and instant). */
function buildWalledBase(sim: Sim, owner: number, cx: number, cz: number, ring: number, gates: Side[]): void {
  for (const p of ringBlueprint(cx, cz, ring, gates)) {
    const s = sim.placeStructure(p.kind, owner, p.tx, p.tz, p.rot);
    if (s && p.kind === 'stairs') s.rot = sim.economy.stairsFacing(p.tx, p.tz, owner) ?? 0;
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

/** Pre-built core of a base (HQ, hub, housing, stores, barracks, armory), mirrored for the east side. */
function placeCore(sim: Sim, owner: number, cx: number, cz: number, mirror: boolean): void {
  const at = (kind: Parameters<Sim['placeStructure']>[0], dx: number, dz: number, w: number): void => {
    const tx = mirror ? cx - dx - w : cx + dx;
    sim.placeStructure(kind, owner, tx, cz + dz);
  };
  at('hq', -2, -2, 4);
  at('hub', -7, 2, 2);
  at('house', -8, -8, 2);
  at('house', -5, -8, 2);
  at('depot', 3, -8, 3);
  at('rations', 3, 5, 3);
  at('barracks', 6, -2, 3);
  at('armory', -8, -4, 3);
}

function stockUp(sim: Sim, owner: number, extra = { timber: 0, concrete: 0, funds: 0 }): void {
  const eco = sim.economy.player(owner);
  eco.active = true;
  eco.funds = 350 + extra.funds;
  eco.stock[Res.Timber] = 90 + extra.timber;
  eco.stock[Res.Concrete] = 40 + extra.concrete;
  eco.stock[Res.Steel] = 10;
  eco.stock[Res.Produce] = 50;
  eco.stock[Res.Rifle] = 2;
}

/** 1v1 against an AI commander on a mirrored map. */
function createSkirmish(seed: number, difficulty: Difficulty): Scenario {
  const playerBase = { x: 28, z: 64 };
  const enemyBase = { x: 100, z: 64 };
  const map = generateDesertMap({
    width: 128,
    height: 128,
    seed,
    clearings: [
      { x: playerBase.x, z: playerBase.z, r: 15 },
      { x: enemyBase.x, z: enemyBase.z, r: 15 },
    ],
    oases: [
      { x: 47, z: 38, r: 3.5 },
      { x: 81, z: 90, r: 3.5 },
      { x: 64, z: 64, r: 4.5 },
    ],
    extraOases: 2,
    oilPatches: 3,
    groves: [
      { x: 10, z: 86, r: 5 },
      { x: 44, z: 88, r: 4 },
      { x: 118, z: 42, r: 5 },
      { x: 84, z: 40, r: 4 },
    ],
  });
  const sim = new Sim({ map, seed, startSec: 45 });

  for (const [owner, base, mirror] of [
    [PLAYER, playerBase, false],
    [ENEMY, enemyBase, true],
  ] as const) {
    placeCore(sim, owner, base.x, base.z, mirror);
    sim.placeStructure('floodlight', owner, base.x + (mirror ? -5 : 4), base.z + 3, mirror ? -Math.PI / 2 : Math.PI / 2);
    sim.placeStructure('floodlight', owner, base.x + (mirror ? 4 : -5), base.z - 1, mirror ? Math.PI / 2 : -Math.PI / 2);
    stockUp(sim, owner, owner === ENEMY ? DIFFICULTY[difficulty].bonus : undefined);
    sim.economy.spawnArrivals(owner, 8);
    const dir = mirror ? -1 : 1;
    sim.spawnUnit(UnitKind.Commander, owner, base.x - 3.5 * dir, base.z + 0.5, (dir * Math.PI) / 2);
    for (let i = 0; i < 4; i++) {
      sim.spawnUnit(UnitKind.Rifleman, owner, base.x + dir * (2.6 + Math.floor(i / 2) * 0.8), base.z - 1 + (i % 2) * 0.8, (dir * Math.PI) / 2);
    }
  }

  const ai = new AiCommander(ENEMY, PLAYER, enemyBase, OLD_SARGE, difficulty);
  sim.controllers.push(ai);
  sim.defender = PLAYER;
  sim.opponent = ENEMY;
  return { sim, mode: 'skirmish', ai, player: PLAYER, playerBase, enemyBase };
}

export function createScenario(mode: GameMode, seed = 1337, difficulty: Difficulty = 'normal'): Scenario {
  if (mode === 'skirmish') return createSkirmish(seed, difficulty);
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
  buildWalledBase(sim, PLAYER, P.x, P.z, 12, ['east', 'west', 'north', 'south']);
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
  buildWalledBase(sim, ENEMY, E.x, E.z, 7, ['west']);
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

  return { sim, mode, ai: null, player: PLAYER, playerBase, enemyBase };
}

/** The open sandbox (economy + skirmish), kept for tests and the M0/M1 flow. */
export function createM0Scenario(seed = 1337): Scenario {
  return createScenario('sandbox', seed);
}
