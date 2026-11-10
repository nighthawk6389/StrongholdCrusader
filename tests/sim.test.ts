import { describe, expect, it } from 'vitest';
import { CYCLE_SEC, cycleInfo, formatHour, TICK_RATE } from '../src/sim/clock';
import { AT_GOAL, buildFlowField, UNREACHABLE } from '../src/sim/flowfield';
import { Block, GameMap, generateDesertMap, Tile } from '../src/sim/map';
import { Rng } from '../src/sim/rng';
import { createM0Scenario, ENEMY, PLAYER } from '../src/sim/scenario';
import { Sim } from '../src/sim/sim';
import { UnitKind } from '../src/sim/unitTypes';
import { Order } from '../src/sim/units';

function openMap(w = 32, h = 32): GameMap {
  const m = new GameMap(w, h, 1);
  m.tiles.fill(Tile.Sand);
  return m;
}

function runTicks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new Rng(43).next()).not.toEqual(seqA[0]);
    for (const v of seqA) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('clock', () => {
  it('runs an 8 minute cycle: dawn → day → dusk → night', () => {
    expect(CYCLE_SEC).toBe(480);
    expect(cycleInfo(10).phase).toBe('dawn');
    expect(cycleInfo(100).phase).toBe('day');
    expect(cycleInfo(100).daylight).toBe(1);
    expect(cycleInfo(310).phase).toBe('dusk');
    expect(cycleInfo(400).phase).toBe('night');
    expect(cycleInfo(400).daylight).toBe(0);
    expect(cycleInfo(480 + 100).day).toBe(1);
    expect(formatHour(cycleInfo(30).hour)).toBe('07:00');
    expect(formatHour(cycleInfo(330).hour)).toBe('21:00');
  });
});

describe('flow field', () => {
  it('routes around a wall through its gap', () => {
    const m = openMap(16, 16);
    // Vertical wall at x=8 with a gap at z=14.
    for (let z = 0; z < 16; z++) if (z !== 14) m.setBlocked(8, z, Block.Structure);
    const goal = m.idx(12, 2);
    const f = buildFlowField(m, goal);
    expect(f.dir[goal]).toBe(AT_GOAL);
    const start = m.idx(3, 2);
    expect(f.dir[start]).toBeGreaterThanOrEqual(0);
    // Path length must go via the gap: way longer than the straight-line 9 tiles.
    expect(f.dist[start]).toBeGreaterThan(20);
    expect(f.dir[m.idx(8, 5)]).toBe(UNREACHABLE); // the wall itself
  });

  it('marks enclosed areas unreachable', () => {
    const m = openMap(16, 16);
    for (let i = 4; i <= 8; i++) {
      m.setBlocked(i, 4, Block.Structure);
      m.setBlocked(i, 8, Block.Structure);
      m.setBlocked(4, i, Block.Structure);
      m.setBlocked(8, i, Block.Structure);
    }
    const f = buildFlowField(m, m.idx(1, 1));
    expect(f.dir[m.idx(6, 6)]).toBe(UNREACHABLE);
  });

  it('never cuts corners diagonally', () => {
    const m = openMap(8, 8);
    m.setBlocked(4, 3, Block.Structure);
    m.setBlocked(3, 4, Block.Structure);
    const f = buildFlowField(m, m.idx(4, 4));
    // From (3,3) the diagonal to (4,4) squeezes between two blocked tiles; must not be taken.
    expect(f.dist[m.idx(3, 3)]).toBeGreaterThan(Math.SQRT2 + 0.01);
  });
});

describe('map generation', () => {
  it('is deterministic and keeps clearings open', () => {
    const spec = {
      width: 64,
      height: 64,
      seed: 7,
      clearings: [{ x: 16, z: 32, r: 8 }],
      oases: [{ x: 44, z: 20, r: 3 }],
    };
    const a = generateDesertMap(spec);
    const b = generateDesertMap(spec);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    for (let z = 28; z < 36; z++) for (let x = 12; x < 20; x++) expect(a.isWalkableTile(x, z)).toBe(true);
    expect(a.tileAt(44, 20)).toBe(Tile.Water);
    expect(a.oases.length).toBeGreaterThanOrEqual(1);
  });
});

describe('movement', () => {
  it('moves a squad to its destination in formation', () => {
    const map = openMap(40, 40);
    const sim = new Sim({ map, seed: 1, startSec: 0 });
    const ids: number[] = [];
    for (let i = 0; i < 9; i++) ids.push(sim.spawnUnit(UnitKind.Rifleman, PLAYER, 5 + (i % 3), 5 + Math.floor(i / 3)));
    sim.enqueue({ type: 'move', owner: PLAYER, ids, x: 30, z: 30 });
    runTicks(sim, TICK_RATE * 20);
    for (const id of ids) {
      expect(sim.units.order[id]).toBe(Order.Idle);
      expect(Math.hypot(sim.units.x[id] - 30, sim.units.z[id] - 30)).toBeLessThan(3);
    }
  });

  it('paths around walls via the gate in the M0 scenario', () => {
    const { sim } = createM0Scenario(1337);
    const ids: number[] = [];
    for (let i = 0; i < sim.units.count; i++) if (sim.units.owner[i] === PLAYER) ids.push(i);
    expect(ids.length).toBe(19);
    // A point just west of the base, outside the walls (the gate is on the east side).
    sim.enqueue({ type: 'move', owner: PLAYER, ids: ids.slice(0, 4), x: 12.5, z: 64.5 });
    runTicks(sim, TICK_RATE * 40);
    for (const id of ids.slice(0, 4)) {
      expect(sim.units.x[id]).toBeLessThan(18);
      expect(sim.map.isWalkable(sim.units.x[id], sim.units.z[id])).toBe(true);
    }
  });

  it('ignores orders for units the issuer does not own', () => {
    const { sim } = createM0Scenario(1337);
    let enemyId = -1;
    for (let i = 0; i < sim.units.count; i++) if (sim.units.owner[i] === ENEMY) enemyId = i;
    const x0 = sim.units.x[enemyId];
    sim.enqueue({ type: 'move', owner: PLAYER, ids: [enemyId], x: 10, z: 10 });
    runTicks(sim, 40);
    expect(sim.units.x[enemyId]).toBe(x0);
  });
});

describe('direct control & combat', () => {
  it('lets a possessed unit shoot an enemy dead', () => {
    const map = openMap(40, 40);
    const sim = new Sim({ map, seed: 3, startSec: 0 });
    const me = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
    const foe = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 10.5, 20.5);
    let killed = false;
    for (let t = 0; t < 200 && !killed; t++) {
      sim.enqueue({ type: 'control', owner: PLAYER, id: me, mx: 0, mz: 0, yaw: 0, fire: true, aim: true });
      sim.step();
      killed = sim.drainEvents().some((e) => e.type === 'death' && e.unit === foe);
    }
    expect(killed).toBe(true);
    expect(sim.units.alive[foe]).toBe(0);
  });

  it('walls stop bullets', () => {
    const map = openMap(40, 40);
    for (let x = 0; x < 40; x++) map.setBlocked(x, 15, Block.Structure);
    const sim = new Sim({ map, seed: 3, startSec: 0 });
    const me = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
    const foe = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 10.5, 20.5);
    for (let t = 0; t < 100; t++) {
      sim.enqueue({ type: 'control', owner: PLAYER, id: me, mx: 0, mz: 0, yaw: 0, fire: true, aim: true });
      sim.step();
    }
    expect(sim.units.alive[foe]).toBe(1);
    expect(sim.units.hp[foe]).toBe(100);
  });
});

describe('determinism', () => {
  it('same seed + same commands ⇒ same state hash', () => {
    const run = (): number => {
      const { sim } = createM0Scenario(99);
      const ids: number[] = [];
      for (let i = 0; i < sim.units.count; i++) if (sim.units.owner[i] === PLAYER) ids.push(i);
      sim.enqueue({ type: 'move', owner: PLAYER, ids, x: 90, z: 70 });
      runTicks(sim, TICK_RATE * 45);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
