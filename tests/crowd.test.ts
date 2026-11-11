import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { Block, GameMap, Tile } from '../src/sim/map';
import { PLAYER } from '../src/sim/scenario';
import { Sim } from '../src/sim/sim';
import { UnitKind } from '../src/sim/unitTypes';

function openSim(w = 48, h = 48): Sim {
  const map = new GameMap(w, h, 1);
  map.tiles.fill(Tile.Sand);
  const sim = new Sim({ map, seed: 21, startSec: 100 });
  sim.economy.player(PLAYER);
  return sim;
}

function runSec(sim: Sim, sec: number): void {
  for (let i = 0; i < sec * TICK_RATE; i++) {
    sim.step();
    sim.drainEvents();
  }
}

describe('crowds', () => {
  it('two people meeting head-on in a one-tile corridor get past each other', () => {
    const sim = openSim();
    // Corridor along z = 20 from x = 10..30, walled both sides.
    for (let x = 10; x <= 30; x++) {
      sim.map.blocked[sim.map.idx(x, 19)] = Block.Terrain;
      sim.map.blocked[sim.map.idx(x, 21)] = Block.Terrain;
    }
    sim.map.version++;
    const a = sim.spawnUnit(UnitKind.Civilian, PLAYER, 8.5, 20.5);
    const b = sim.spawnUnit(UnitKind.Civilian, PLAYER, 32.5, 20.5);
    sim.goTo(a, 33.5, 20.5);
    sim.goTo(b, 7.5, 20.5);
    runSec(sim, 25);
    expect(sim.units.x[a]).toBeGreaterThan(31);
    expect(sim.units.x[b]).toBeLessThan(9);
  });

  it('two squads crossing paths in the open all get where they are going', () => {
    const sim = openSim();
    const west: number[] = [];
    const east: number[] = [];
    for (let k = 0; k < 8; k++) {
      west.push(sim.spawnUnit(UnitKind.Rifleman, PLAYER, 8.5 + (k % 3) * 0.8, 20 + Math.floor(k / 3) * 0.8));
      east.push(sim.spawnUnit(UnitKind.Rifleman, PLAYER, 38.5 - (k % 3) * 0.8, 20.2 + Math.floor(k / 3) * 0.8));
    }
    sim.enqueue({ type: 'move', owner: PLAYER, ids: west, x: 38.5, z: 21 });
    sim.enqueue({ type: 'move', owner: PLAYER, ids: east, x: 8.5, z: 21 });
    runSec(sim, 25);
    for (const i of west) expect(sim.units.x[i]).toBeGreaterThan(33);
    for (const i of east) expect(sim.units.x[i]).toBeLessThan(14);
  });

  it('people walking straight at each other in the open step aside quickly', () => {
    const sim = openSim();
    const a = sim.spawnUnit(UnitKind.Civilian, PLAYER, 10.5, 20.5);
    const b = sim.spawnUnit(UnitKind.Civilian, PLAYER, 30.5, 20.5);
    sim.goTo(a, 30.5, 20.5);
    sim.goTo(b, 10.5, 20.5);
    runSec(sim, 11);
    expect(Math.hypot(sim.units.x[a] - 30.5, sim.units.z[a] - 20.5)).toBeLessThan(1.5);
    expect(Math.hypot(sim.units.x[b] - 10.5, sim.units.z[b] - 20.5)).toBeLessThan(1.5);
  });
});

describe('group moves finish', () => {
  it('a squad of 18 marched around a busy base always settles (nobody shuffles forever)', { timeout: 60_000 }, async () => {
    const { createScenario } = await import('../src/sim/scenario');
    const { sim } = createScenario('sandbox', 1337);
    const u = sim.units;
    const ids: number[] = [];
    for (let i = 0; i < u.count; i++) if (u.alive[i] && u.owner[i] === PLAYER && u.kind[i] === UnitKind.Rifleman) ids.push(i);
    for (const [x, z, layer] of [
      [50, 64, 0],
      [28, 66, 0],
      [28, 52.5, 1],
      [30, 66, 0],
    ]) {
      sim.enqueue({ type: 'move', owner: PLAYER, ids, x, z, layer });
      runSec(sim, 20);
      expect(ids.filter((i) => u.order[i] === 1).length).toBe(0);
    }
  });
});
