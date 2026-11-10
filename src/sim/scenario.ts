import { generateDesertMap } from './map';
import { Sim } from './sim';
import { Res } from './structures';
import { UnitKind } from './unitTypes';

export const PLAYER = 1;
export const ENEMY = 2;

export interface Scenario {
  sim: Sim;
  player: number;
  playerBase: { x: number; z: number };
  enemyBase: { x: number; z: number };
}

interface BaseLayout {
  cx: number;
  cz: number;
  /** Chebyshev radius of the wall ring. */
  ring: number;
  /** Sides with a 3-tile checkpoint gate. */
  gates: ('east' | 'west' | 'north' | 'south')[];
}

function buildWalledBase(sim: Sim, owner: number, b: BaseLayout): void {
  const { cx, cz, ring, gates } = b;
  const isGate = (x: number, z: number): number | null => {
    if (gates.includes('east') && x === cx + ring && Math.abs(z - cz) <= 1) return Math.PI / 2;
    if (gates.includes('west') && x === cx - ring && Math.abs(z - cz) <= 1) return Math.PI / 2;
    if (gates.includes('north') && z === cz - ring && Math.abs(x - cx) <= 1) return 0;
    if (gates.includes('south') && z === cz + ring && Math.abs(x - cx) <= 1) return 0;
    return null;
  };

  // Corner towers first so walls flow around them.
  const corners: [number, number][] = [
    [cx - ring, cz - ring],
    [cx + ring - 1, cz - ring],
    [cx - ring, cz + ring - 1],
    [cx + ring - 1, cz + ring - 1],
  ];
  for (const [x, z] of corners) sim.placeStructure('tower', owner, x, z);

  for (let z = cz - ring; z <= cz + ring; z++) {
    for (let x = cx - ring; x <= cx + ring; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== ring) continue;
      const g = isGate(x, z);
      sim.placeStructure(g === null ? 'wall' : 'gate', owner, x, z, g ?? 0);
    }
  }
}

/** The M0 sandbox: your walled outpost in the west, a hostile outpost in the east. */
export function createM0Scenario(seed = 1337): Scenario {
  const playerBase = { x: 28, z: 64 };
  const enemyBase = { x: 100, z: 70 };
  const map = generateDesertMap({
    width: 128,
    height: 128,
    seed,
    clearings: [
      { x: playerBase.x, z: playerBase.z, r: 13 },
      { x: enemyBase.x, z: enemyBase.z, r: 10 },
    ],
    oases: [
      { x: 46, z: 40, r: 3.5 },
      { x: 64, z: 66, r: 4.5 },
      { x: 86, z: 96, r: 3 },
    ],
    extraOases: 2,
    oilPatches: 3,
    groves: [
      { x: 12, z: 84, r: 5 },
      { x: 44, z: 86, r: 4 },
      { x: 112, z: 50, r: 4 },
    ],
  });

  // Start mid-morning: ~4.5 minutes until dusk.
  const sim = new Sim({ map, seed, startSec: 45 });

  // --- Player outpost: the pre-built core (HQ, arrivals hub, 2 housing blocks, depot, ration store).
  const P = playerBase;
  sim.placeStructure('hq', PLAYER, P.x - 2, P.z - 2);
  sim.placeStructure('hub', PLAYER, P.x - 7, P.z + 2);
  sim.placeStructure('house', PLAYER, P.x - 8, P.z - 8);
  sim.placeStructure('house', PLAYER, P.x - 5, P.z - 8);
  sim.placeStructure('depot', PLAYER, P.x + 3, P.z - 8);
  sim.placeStructure('rations', PLAYER, P.x + 3, P.z + 5);
  buildWalledBase(sim, PLAYER, { cx: P.x, cz: P.z, ring: 10, gates: ['east', 'west', 'north', 'south'] });
  sim.placeStructure('floodlight', PLAYER, P.x + 8, P.z - 4, Math.PI / 2);
  sim.placeStructure('floodlight', PLAYER, P.x + 8, P.z + 4, Math.PI / 2);
  sim.placeStructure('floodlight', PLAYER, P.x - 8, P.z, -Math.PI / 2);
  sim.placeStructure('floodlight', PLAYER, P.x, P.z + 8, 0);

  const eco = sim.economy.player(PLAYER);
  eco.active = true;
  eco.funds = 300;
  eco.stock[Res.Timber] = 60;
  eco.stock[Res.Concrete] = 20;
  eco.stock[Res.Produce] = 50;
  sim.economy.spawnArrivals(PLAYER, 8);

  sim.spawnUnit(UnitKind.Commander, PLAYER, P.x - 3.5, P.z + 0.5, Math.PI / 2);
  for (let i = 0; i < 18; i++) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    sim.spawnUnit(UnitKind.Rifleman, PLAYER, P.x + 3.6 + row * 0.8, P.z - 2 + col * 0.8, Math.PI / 2);
  }

  // --- Hostile outpost
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
  // A patrol camped outside the gate.
  for (let i = 0; i < 6; i++) {
    sim.spawnUnit(UnitKind.Rifleman, ENEMY, E.x - 14 + (i % 3) * 0.9, E.z - 1 + Math.floor(i / 3) * 0.9, -Math.PI / 2);
  }

  return { sim, player: PLAYER, playerBase, enemyBase };
}
