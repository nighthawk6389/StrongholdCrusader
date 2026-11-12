import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { GameMap, Tile } from '../src/sim/map';
import { createScenario, ENEMY, PLAYER } from '../src/sim/scenario';
import { loadSim, saveSim, type SimSave } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { Res } from '../src/sim/structures';
import { UnitKind } from '../src/sim/unitTypes';
import { Order, STANCE_HOLD_FIRE } from '../src/sim/units';

function runSec(sim: Sim, sec: number, onShot?: (unit: number) => void): void {
  for (let i = 0; i < sec * TICK_RATE; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'shot' && onShot) onShot(e.unit);
  }
}

/** Flat open map in daylight. */
function openSim(w = 64, h = 64): Sim {
  const map = new GameMap(w, h, 1);
  map.tiles.fill(Tile.Sand);
  const sim = new Sim({ map, seed: 9, startSec: 100 });
  sim.economy.player(PLAYER);
  sim.economy.player(ENEMY);
  return sim;
}

describe('orders and stances', () => {
  it('hold fire: soldiers stay quiet with an enemy in range until told to attack', () => {
    const sim = openSim();
    const mine = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 20.5);
    const enemy = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 28.5, 20.5);
    sim.units.stance[enemy] = STANCE_HOLD_FIRE; // keep the test one-sided
    sim.enqueue({ type: 'stance', owner: PLAYER, ids: [mine], holdFire: true });
    let shots = 0;
    runSec(sim, 6, (u) => {
      if (u === mine) shots++;
    });
    expect(sim.units.stance[mine]).toBe(STANCE_HOLD_FIRE);
    expect(shots).toBe(0);
    // An explicit attack order still fires.
    sim.enqueue({ type: 'attack', owner: PLAYER, ids: [mine], target: enemy });
    runSec(sim, 4, (u) => {
      if (u === mine) shots++;
    });
    expect(shots).toBeGreaterThan(0);
    // Weapons free again.
    sim.enqueue({ type: 'stance', owner: PLAYER, ids: [mine], holdFire: false });
    runSec(sim, 0.1);
    expect(sim.units.stance[mine]).toBe(0);
  });

  it('attack-move: stops to fight on the way, then carries on to the destination', () => {
    const sim = openSim();
    const mine = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 30.5);
    const enemy = sim.spawnUnit(UnitKind.Civilian, ENEMY, 26.5, 31.5); // unarmed: it won't shoot back
    sim.enqueue({ type: 'attackMove', owner: PLAYER, ids: [mine], x: 50.5, z: 30.5 });
    runSec(sim, 0.1);
    expect(sim.units.order[mine]).toBe(Order.AttackMove);
    let fired = false;
    for (let t = 0; t < 20 && sim.units.isAlive(enemy); t++) {
      runSec(sim, 1, (u) => {
        if (u === mine) fired = true;
      });
    }
    expect(fired).toBe(true);
    expect(sim.units.isAlive(enemy)).toBe(false);
    // It stopped short of where the enemy stood while shooting, and now walks on.
    runSec(sim, 30);
    expect(Math.hypot(sim.units.x[mine] - 50.5, sim.units.z[mine] - 30.5)).toBeLessThan(2.5);
    expect(sim.units.order[mine]).toBe(Order.Idle);
  });

  it('patrol: walks back and forth between start and target', () => {
    const sim = openSim();
    const mine = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
    sim.enqueue({ type: 'patrol', owner: PLAYER, ids: [mine], x: 30.5, z: 10.5 });
    let reachedFar = false;
    let backHome = false;
    for (let t = 0; t < 40; t++) {
      runSec(sim, 1);
      const x = sim.units.x[mine];
      if (x > 28) reachedFar = true;
      if (reachedFar && x < 12.5) backHome = true;
    }
    expect(reachedFar).toBe(true);
    expect(backHome).toBe(true);
    expect(sim.units.order[mine]).toBe(Order.Patrol);
  });

  it('rally point: new recruits head there, and it survives a save', { timeout: 60_000 }, () => {
    const { sim } = createScenario('sandbox', 1337);
    const p = sim.economy.player(PLAYER);
    p.stock[Res.Rifle] = 5;
    p.funds = 500;
    let barracks = sim.structures.find((s) => s.owner === PLAYER && s.kind === 'barracks');
    if (!barracks) {
      const hq = sim.economy.hqOf(PLAYER)!;
      for (let dz = -12; dz <= 12 && !barracks; dz += 2) {
        for (let dx = -12; dx <= 12 && !barracks; dx += 2) barracks = sim.placeStructure('barracks', PLAYER, hq.tx + dx, hq.tz + dz) ?? undefined;
      }
    }
    expect(barracks).toBeDefined();
    const rx = barracks!.tx + 10.5;
    const rz = barracks!.tz + 4.5;
    sim.enqueue({ type: 'rally', owner: PLAYER, id: barracks!.id, x: rx, z: rz });
    runSec(sim, 0.1);
    expect(barracks!.rallyX).toBeCloseTo(rx);
    const back = loadSim(JSON.parse(JSON.stringify(saveSim(sim, 'sandbox', 1337, 'normal'))) as SimSave);
    expect(back.sim.structureById(barracks!.id)?.rallyX).toBeCloseTo(rx);

    const before = new Set<number>();
    for (let i = 0; i < sim.units.count; i++) if (sim.units.alive[i] && sim.units.kind[i] === UnitKind.Rifleman) before.add(i);
    sim.enqueue({ type: 'recruit', owner: PLAYER, barracks: barracks!.id, kind: UnitKind.Rifleman, count: 1 });
    runSec(sim, 45);
    let recruit = -1;
    for (let i = 0; i < sim.units.count; i++) {
      if (sim.units.alive[i] && sim.units.owner[i] === PLAYER && sim.units.kind[i] === UnitKind.Rifleman && !before.has(i)) recruit = i;
    }
    expect(recruit).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(sim.units.x[recruit] - rx, sim.units.z[recruit] - rz)).toBeLessThan(3);
  });
});
