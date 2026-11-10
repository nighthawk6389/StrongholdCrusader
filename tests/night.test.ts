import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { GameMap, Tile } from '../src/sim/map';
import { ENEMY, PLAYER } from '../src/sim/scenario';
import { Sim } from '../src/sim/sim';
import { Res } from '../src/sim/structures';
import { UnitKind } from '../src/sim/unitTypes';

/** Open map; startSec 100 = day, 400 = night. */
function openSim(startSec: number, w = 48, h = 48): Sim {
  const map = new GameMap(w, h, 1);
  map.tiles.fill(Tile.Sand);
  const sim = new Sim({ map, seed: 9, startSec });
  sim.economy.player(PLAYER);
  sim.economy.player(ENEMY);
  return sim;
}

function runTicks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}

describe('vision: light and darkness', () => {
  it('daylight reveals everything; darkness hides unlit enemies beyond short range', () => {
    const day = openSim(100);
    const a = day.spawnUnit(UnitKind.Rifleman, PLAYER, 5.5, 5.5);
    const b = day.spawnUnit(UnitKind.Rifleman, ENEMY, 40.5, 40.5);
    runTicks(day, 6);
    expect(day.vision.isSeen(PLAYER, b)).toBe(true);

    const night = openSim(400);
    night.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
    const far = night.spawnUnit(UnitKind.Rifleman, ENEMY, 10.5, 22.5);
    const near = night.spawnUnit(UnitKind.Rifleman, ENEMY, 10.5, 14.5);
    runTicks(night, 1); // first detection pass, before anyone fires (gunfire would give them away)
    expect(night.cycle.daylight).toBe(0);
    expect(night.vision.isSeen(PLAYER, far)).toBe(false);
    expect(night.vision.isSeen(PLAYER, near)).toBe(true);
    void a;
  });

  it('night vision sees in the dark', () => {
    const sim = openSim(400);
    sim.spawnUnit(UnitKind.Operator, PLAYER, 10.5, 10.5);
    const foe = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 10.5, 24.5);
    runTicks(sim, 6);
    expect(sim.vision.isSeen(PLAYER, foe)).toBe(true);
  });

  it('a powered floodlight reveals enemies in its cone; without power it does nothing', () => {
    const sim = openSim(400);
    sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 6.5);
    const foe = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 10.5, 16.5);
    const light = sim.placeStructure('floodlight', PLAYER, 10, 8, 0)!; // facing +z
    sim.economy.allocatePower();
    runTicks(sim, 6);
    expect(light.powered).toBe(false); // no generator, no HQ
    expect(sim.vision.isSeen(PLAYER, foe)).toBe(false);

    sim.placeStructure('hq', PLAYER, 2, 2); // HQ supplies 4 power
    sim.economy.allocatePower();
    runTicks(sim, 6);
    expect(light.powered).toBe(true);
    expect(sim.vision.lightAt(10.5, 16.5)).toBeGreaterThan(0.5);
    expect(sim.vision.isSeen(PLAYER, foe)).toBe(true);
  });

  it('power is shared out oldest-first; the rest go dark', () => {
    const sim = openSim(400);
    sim.placeStructure('hq', PLAYER, 2, 2); // 4 power
    const l1 = sim.placeStructure('floodlight', PLAYER, 20, 20)!;
    const l2 = sim.placeStructure('floodlight', PLAYER, 22, 20)!;
    const l3 = sim.placeStructure('floodlight', PLAYER, 24, 20)!;
    sim.economy.allocatePower();
    expect([l1.powered, l2.powered, l3.powered]).toEqual([true, true, false]);
    expect(sim.economy.player(PLAYER).powerDemand).toBe(6);
  });

  it('flares light an area, cost funds and need a soldier nearby', () => {
    const sim = openSim(400);
    sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
    const foe = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 10.5, 22.5);
    const p = sim.economy.player(PLAYER);
    p.funds = 20;
    sim.enqueue({ type: 'flare', owner: PLAYER, x: 45, z: 45 }); // too far
    sim.enqueue({ type: 'flare', owner: PLAYER, x: 10.5, z: 22.5 });
    runTicks(sim, 2);
    expect(p.funds).toBe(5);
    expect(sim.vision.flares.length).toBe(1);
    runTicks(sim, 6);
    expect(sim.vision.isSeen(PLAYER, foe)).toBe(true);
    runTicks(sim, 31 * TICK_RATE);
    expect(sim.vision.flares.length).toBe(0);
  });
});

describe('noise, stealth and sensors', () => {
  it('unsilenced fire gives the shooter away; silenced fire does not', () => {
    const sim = openSim(400);
    sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
    const loud = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 10.5, 30.5);
    const quiet = sim.spawnUnit(UnitKind.Operator, ENEMY, 20.5, 30.5);
    sim.combat.fire(loud, 0, 10, 1, false, 0);
    sim.combat.fire(quiet, 0, 10, 1, false, 0);
    runTicks(sim, 6);
    expect(sim.vision.isSeen(PLAYER, loud)).toBe(true);
    expect(sim.vision.isSeen(PLAYER, quiet)).toBe(false);
  });

  it('operators are hard to spot in the dark, but sensors and dogs catch them', () => {
    const sim = openSim(400);
    sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
    const op = sim.spawnUnit(UnitKind.Operator, ENEMY, 10.5, 14.5); // 4 tiles away, standing still
    runTicks(sim, 6);
    expect(sim.vision.isSeen(PLAYER, op)).toBe(false);

    const dogs = openSim(400);
    dogs.spawnUnit(UnitKind.Rifleman, PLAYER, 30.5, 30.5);
    dogs.placeStructure('kennel', PLAYER, 10, 10);
    const op2 = dogs.spawnUnit(UnitKind.Operator, ENEMY, 11.5, 16.5);
    runTicks(dogs, 6);
    expect(dogs.vision.isSeen(PLAYER, op2)).toBe(true);
  });

  it("troops don't shoot at what they can't see", () => {
    const sim = openSim(400);
    sim.spawnUnit(UnitKind.Rifleman, PLAYER, 10.5, 10.5);
    sim.spawnUnit(UnitKind.Rifleman, ENEMY, 10.5, 19.5);
    let shots = 0;
    for (let t = 0; t < 5 * TICK_RATE; t++) {
      sim.step();
      shots += sim.drainEvents().filter((e) => e.type === 'shot').length;
    }
    expect(shots).toBe(0);
    sim.economy.player(PLAYER).funds = 100;
    sim.enqueue({ type: 'flare', owner: PLAYER, x: 10.5, z: 15 });
    for (let t = 0; t < 5 * TICK_RATE; t++) {
      sim.step();
      shots += sim.drainEvents().filter((e) => e.type === 'shot').length;
    }
    expect(shots).toBeGreaterThan(0);
  });
});

describe('special forces', () => {
  it('operators climb over a sealed wall that riflemen cannot pass', () => {
    const sim = openSim(100, 40, 40);
    for (let i = 10; i <= 20; i++) {
      for (const [x, z] of [
        [i, 10],
        [i, 20],
        [10, i],
        [20, i],
      ]) {
        sim.placeStructure('wall', ENEMY, x, z);
      }
    }
    const op = sim.spawnUnit(UnitKind.Operator, PLAYER, 5.5, 15.5);
    const rifle = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 5.5, 14.5);
    sim.enqueue({ type: 'move', owner: PLAYER, ids: [op], x: 15.5, z: 15.5 });
    sim.enqueue({ type: 'move', owner: PLAYER, ids: [rifle], x: 15.5, z: 15.5 });
    runTicks(sim, 15 * TICK_RATE);
    const inside = (i: number): boolean => sim.units.x[i] > 10.9 && sim.units.x[i] < 20 && sim.units.z[i] > 10.9 && sim.units.z[i] < 20;
    expect(inside(op)).toBe(true);
    expect(sim.units.layer[op]).toBe(0);
    expect(inside(rifle)).toBe(false);
  });

  it('operators carry one quick demolition charge', () => {
    const sim = openSim(100);
    const op = sim.spawnUnit(UnitKind.Operator, PLAYER, 10.5, 10.5);
    expect(sim.units.charges[op]).toBe(1);
  });
});

describe('night shifts', () => {
  it('keep production going at night at a morale cost', () => {
    const output = (nightShift: boolean): { made: number; factor: boolean } => {
      const sim = openSim(400, 40, 40);
      sim.placeStructure('hq', PLAYER, 18, 18);
      sim.placeStructure('hub', PLAYER, 12, 18);
      sim.placeStructure('depot', PLAYER, 24, 18);
      const p = sim.economy.player(PLAYER);
      p.active = true;
      p.stock[Res.Produce] = 200;
      p.nightShift = nightShift;
      sim.economy.spawnArrivals(PLAYER, 2);
      sim.placeStructure('scrapyard', PLAYER, 26, 22);
      let made = 0;
      let factor = false;
      for (let t = 0; t < 75 * TICK_RATE; t++) {
        sim.step();
        for (const e of sim.drainEvents()) if (e.type === 'delivered') made += e.amount;
        factor ||= p.factors.some((f) => f.key === 'night');
      }
      return { made, factor };
    };
    const off = output(false);
    const on = output(true);
    expect(on.made).toBeGreaterThan(off.made);
    expect(on.factor).toBe(true);
    expect(off.factor).toBe(false);
  });
});
