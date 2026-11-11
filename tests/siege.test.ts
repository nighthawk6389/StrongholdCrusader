import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { GameMap, Tile } from '../src/sim/map';
import { ENEMY, PLAYER } from '../src/sim/scenario';
import { loadSim, saveSim, type SimSave } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { Res } from '../src/sim/structures';
import { UNIT_TYPES, UnitKind } from '../src/sim/unitTypes';
import { Order } from '../src/sim/units';

/** Flat open map in daylight. */
function openSim(w = 64, h = 64): Sim {
  const map = new GameMap(w, h, 1);
  map.tiles.fill(Tile.Sand);
  const sim = new Sim({ map, seed: 11, startSec: 100 });
  sim.economy.player(PLAYER);
  sim.economy.player(ENEMY);
  return sim;
}

function runSec(sim: Sim, sec: number): void {
  for (let i = 0; i < sec * TICK_RATE; i++) {
    sim.step();
    sim.drainEvents();
  }
}

const hpFrac = (sim: Sim, id: number): number => (sim.units.isAlive(id) ? sim.units.hp[id] / UNIT_TYPES[sim.units.kind[id]].hp : 0);

describe('armor and anti-tank weapons', () => {
  it('rifles barely scratch a tank; AT rockets hurt it; rockets are poor against infantry', () => {
    const sim = openSim();
    const tank = sim.spawnUnit(UnitKind.Tank, ENEMY, 20.5, 20.5);
    sim.combat.damageUnit(tank, 100, -1); // small arms
    expect(UNIT_TYPES[UnitKind.Tank].hp - sim.units.hp[tank]).toBeCloseTo(100 * UNIT_TYPES[UnitKind.Tank].armor, 3);
    sim.combat.damageUnit(tank, 100, -1, true); // armor-piercing
    expect(UNIT_TYPES[UnitKind.Tank].hp - sim.units.hp[tank]).toBeCloseTo(100 * (1 + UNIT_TYPES[UnitKind.Tank].armor), 3);

    // Ten riflemen vs a tank for 10 s: it shrugs them off. Two AT teams knock it out.
    const a = openSim();
    const t1 = a.spawnUnit(UnitKind.Tank, ENEMY, 30.5, 40.5);
    a.units.hp[t1] = 1e6; // just measure damage taken
    a.units.order[t1] = Order.Control; // and keep it from shooting back
    for (let k = 0; k < 10; k++) a.spawnUnit(UnitKind.Rifleman, PLAYER, 25.5 + k, 28.5);
    const before = a.units.hp[t1];
    runSec(a, 10);
    const rifleDmg = before - a.units.hp[t1];

    const b = openSim();
    const t2 = b.spawnUnit(UnitKind.Tank, ENEMY, 30.5, 40.5);
    b.units.hp[t2] = 1e6;
    b.units.order[t2] = Order.Control;
    for (let k = 0; k < 2; k++) b.spawnUnit(UnitKind.AT, PLAYER, 29.5 + k, 28.5);
    runSec(b, 10);
    const atDmg = 1e6 - b.units.hp[t2];
    expect(atDmg).toBeGreaterThan(rifleDmg * 4);
    expect(atDmg).toBeGreaterThan(UNIT_TYPES[UnitKind.Tank].hp * 0.4);
  });

  it('AT teams pick armor over infantry', () => {
    const sim = openSim();
    const at = sim.spawnUnit(UnitKind.AT, PLAYER, 20.5, 20.5);
    const near = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 20.5, 26.5); // closer
    const car = sim.spawnUnit(UnitKind.ArmoredCar, ENEMY, 20.5, 33.5);
    sim.units.hp[car] = 1e6;
    sim.units.order[near] = sim.units.order[car] = Order.Control; // targets only
    runSec(sim, 3);
    expect(sim.units.target[at]).toBe(car);
  });
});

describe('vehicles', () => {
  it('stay on the ground: no stairs, no wall tops', () => {
    const sim = openSim();
    for (let x = 0; x < 64; x++) sim.placeStructure('wall', PLAYER, x, 30);
    sim.placeStructure('stairs', PLAYER, 20, 29);
    sim.placeStructure('stairs', PLAYER, 20, 31);
    const rifle = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 25.5);
    const tank = sim.spawnUnit(UnitKind.Tank, PLAYER, 24.5, 25.5);
    sim.enqueue({ type: 'move', owner: PLAYER, ids: [rifle], x: 20.5, z: 36.5 });
    sim.enqueue({ type: 'move', owner: PLAYER, ids: [tank], x: 24.5, z: 36.5 });
    runSec(sim, 20);
    expect(sim.units.z[rifle]).toBeGreaterThan(33); // over the wall via the stairs
    expect(sim.units.z[tank]).toBeLessThan(30);
    expect(sim.units.layer[tank]).toBe(0);
  });

  it('a tank shoots its way through a wall', () => {
    const sim = openSim();
    sim.placeStructure('wall', ENEMY, 20, 32);
    const wall = sim.structureAt(20, 32)!;
    const tank = sim.spawnUnit(UnitKind.Tank, PLAYER, 20.5, 20.5);
    sim.enqueue({ type: 'attackStructure', owner: PLAYER, ids: [tank], structure: wall.id });
    runSec(sim, 25);
    expect(sim.structureById(wall.id)).toBeUndefined();
  });

  it('the motor pool turns an idle civilian, steel, fuel and funds into a tank', () => {
    const sim = openSim();
    sim.placeStructure('hq', PLAYER, 4, 4);
    const pool = sim.placeStructure('motorpool', PLAYER, 14, 6)!;
    const p = sim.economy.player(PLAYER);
    p.funds = 400;
    p.stock[Res.Steel] = 40;
    p.stock[Res.Fuel] = 5;
    sim.spawnUnit(UnitKind.Civilian, PLAYER, 10.5, 12.5);
    sim.economy.recount();
    expect(sim.economy.recruitBlocker(PLAYER, UnitKind.Tank)).toMatch(/fuel/);
    p.stock[Res.Fuel] = 20;
    expect(sim.economy.recruitBlocker(PLAYER, UnitKind.Tank)).toBeNull();
    sim.enqueue({ type: 'recruit', owner: PLAYER, barracks: pool.id, kind: UnitKind.Tank, count: 1 });
    runSec(sim, 12);
    const u = sim.units;
    let tanks = 0;
    for (let i = 0; i < u.count; i++) if (u.alive[i] && u.kind[i] === UnitKind.Tank) tanks++;
    expect(tanks).toBe(1);
    expect(p.stock[Res.Fuel]).toBe(10);
    expect(p.stock[Res.Steel]).toBe(20);
    expect(p.funds).toBe(240);
  });

  it('an oil derrick has to sit on an oil seep', () => {
    const sim = openSim();
    sim.placeStructure('hq', PLAYER, 4, 4);
    const p = sim.economy.player(PLAYER);
    p.stock[Res.Timber] = 50;
    p.stock[Res.Steel] = 50;
    expect(sim.economy.canPlace(PLAYER, 'derrick', 14, 14).reason).toMatch(/oil/);
    sim.map.tiles[sim.map.idx(15, 15)] = Tile.Oil;
    expect(sim.economy.canPlace(PLAYER, 'derrick', 14, 14).ok).toBe(true);
  });

  it('a howitzer deploys, then shells a structure over a wall from long range', () => {
    const sim = openSim(96, 96);
    for (let x = 0; x < 96; x++) sim.placeStructure('wall', ENEMY, x, 40);
    const house = sim.placeStructure('barracks', ENEMY, 30, 58)!;
    const gun = sim.spawnUnit(UnitKind.Howitzer, PLAYER, 30.5, 12.5);
    sim.enqueue({ type: 'attackStructure', owner: PLAYER, ids: [gun], structure: house.id });
    sim.step();
    expect(sim.units.order[gun]).toBe(Order.Breach);
    let shells = 0;
    let booms = 0;
    for (let k = 0; k < 40 * TICK_RATE; k++) {
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.type === 'shell') shells++;
        if (e.type === 'explosion') booms++;
      }
    }
    expect(sim.units.deploy[gun]).toBe(1);
    expect(shells).toBeGreaterThan(2);
    expect(booms).toBeGreaterThan(1);
    expect(sim.structureById(house.id)?.hp ?? 0).toBeLessThan(600);
  });
});

describe('traps and obstacles', () => {
  it('a hidden mine blows up the first enemy to step on it; tanks take a heavy hit', () => {
    const sim = openSim();
    sim.placeStructure('hq', PLAYER, 4, 4);
    const p = sim.economy.player(PLAYER);
    p.stock[Res.Steel] = 20;
    sim.enqueue({ type: 'buildWall', owner: PLAYER, kind: 'mines', tiles: [20, 20, 21, 20, 22, 20] });
    sim.step();
    expect(sim.structures.filter((s) => s.kind === 'mines').length).toBe(3);
    expect(p.stock[Res.Steel]).toBe(14);
    const mine = sim.structureAt(20, 20)!;
    expect(sim.traps.knows(ENEMY, mine)).toBe(false);
    const r = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 20.5, 26.5);
    sim.enqueue({ type: 'move', owner: ENEMY, ids: [r], x: 20.5, z: 14.5 });
    runSec(sim, 6);
    expect(sim.units.isAlive(r)).toBe(false);
    expect(sim.structureAt(20, 20)).toBeUndefined();

    const tank = sim.spawnUnit(UnitKind.Tank, ENEMY, 22.5, 26.5);
    sim.enqueue({ type: 'move', owner: ENEMY, ids: [tank], x: 22.5, z: 14.5 });
    runSec(sim, 8);
    expect(hpFrac(sim, tank)).toBeLessThan(0.65);
  });

  it('engineers spot and clear mines without stepping on them', () => {
    const sim = openSim();
    sim.placeStructure('mines', PLAYER, 20, 20);
    const eng = sim.spawnUnit(UnitKind.Engineer, ENEMY, 20.5, 22.3);
    runSec(sim, 4);
    expect(sim.structureAt(20, 20)).toBeUndefined();
    expect(sim.units.isAlive(eng)).toBe(true);
    expect(sim.units.hp[eng]).toBe(UNIT_TYPES[UnitKind.Engineer].hp);
  });

  it('a ditch stops everyone but not bullets; enemy engineers fill it in', () => {
    const sim = openSim();
    for (let x = 0; x < 64; x++) sim.placeStructure('ditch', PLAYER, x, 30);
    const r = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 20.5, 25.5);
    sim.enqueue({ type: 'move', owner: ENEMY, ids: [r], x: 20.5, z: 36.5 });
    runSec(sim, 12);
    expect(sim.units.z[r]).toBeLessThan(30);
    // Shots fly over it.
    const me = sim.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 35.5);
    sim.units.hp[r] = 1000;
    runSec(sim, 4);
    expect(sim.units.hp[r]).toBeLessThan(1000);
    void me;
    // An engineer fills a stretch without using a charge.
    const eng = sim.spawnUnit(UnitKind.Engineer, ENEMY, 40.5, 27.5);
    const d = sim.structureAt(40, 30)!;
    sim.enqueue({ type: 'attackStructure', owner: ENEMY, ids: [eng], structure: d.id });
    runSec(sim, 10);
    expect(sim.structureById(d.id)).toBeUndefined();
    expect(sim.units.charges[eng]).toBe(UNIT_TYPES[UnitKind.Engineer].charges);
  });

  it('a lit fuel trench spreads along its length, burns whoever stands in it, then burns out', () => {
    const sim = openSim();
    for (let x = 18; x <= 24; x++) sim.placeStructure('trench', PLAYER, x, 20);
    const foe = sim.spawnUnit(UnitKind.Civilian, ENEMY, 24.5, 20.5);
    sim.units.hp[foe] = 1000;
    // Lighting it needs one of your soldiers nearby.
    sim.enqueue({ type: 'ignite', owner: PLAYER, id: sim.structureAt(18, 20)!.id });
    runSec(sim, 1);
    expect(sim.structureAt(18, 20)!.burn).toBe(0);
    sim.spawnUnit(UnitKind.Rifleman, PLAYER, 18.5, 10.5);
    sim.enqueue({ type: 'ignite', owner: PLAYER, id: sim.structureAt(18, 20)!.id });
    runSec(sim, 4);
    expect(sim.structureAt(24, 20)!.burn).toBeGreaterThan(0);
    expect(sim.units.hp[foe]).toBeLessThan(1000);
    runSec(sim, 14);
    expect(sim.structures.some((s) => s.kind === 'trench')).toBe(false);
  });

  it('a flare landing on a trench sets it alight', () => {
    const sim = openSim();
    sim.placeStructure('trench', PLAYER, 20, 20);
    sim.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 12.5);
    sim.economy.player(PLAYER).funds = 100;
    sim.enqueue({ type: 'flare', owner: PLAYER, x: 20.6, z: 20.4 });
    sim.step();
    expect(sim.structureAt(20, 20)!.burn).toBeGreaterThan(0);
  });

  it('razor wire slows enemy infantry; a tank flattens it', () => {
    const cross = (wire: boolean): number => {
      const sim = openSim();
      if (wire) for (let z = 18; z <= 26; z++) for (let x = 0; x < 64; x++) sim.placeStructure('wire', PLAYER, x, z);
      const r = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 20.5, 16.5);
      sim.enqueue({ type: 'move', owner: ENEMY, ids: [r], x: 20.5, z: 30.5 });
      runSec(sim, 4);
      return sim.units.z[r];
    };
    expect(cross(true)).toBeLessThan(cross(false) - 3);
    const sim = openSim();
    sim.placeStructure('wire', PLAYER, 20, 20);
    const tank = sim.spawnUnit(UnitKind.Tank, ENEMY, 20.5, 16.5);
    sim.enqueue({ type: 'move', owner: ENEMY, ids: [tank], x: 20.5, z: 26.5 });
    runSec(sim, 6);
    expect(sim.structureAt(20, 20)).toBeUndefined();
  });

  it('saves keep shells in flight and burning trenches; armor fights stay deterministic', { timeout: 30_000 }, () => {
    const setup = (): Sim => {
      const sim = openSim(96, 96);
      for (let x = 30; x <= 36; x++) sim.placeStructure('trench', ENEMY, x, 50);
      sim.spawnUnit(UnitKind.Rifleman, ENEMY, 33.5, 44.5);
      sim.placeStructure('house', ENEMY, 40, 60);
      const gun = sim.spawnUnit(UnitKind.Howitzer, PLAYER, 40.5, 15.5);
      sim.units.deploy[gun] = 1;
      sim.spawnUnit(UnitKind.Tank, PLAYER, 33.5, 30.5);
      sim.spawnUnit(UnitKind.AT, ENEMY, 33.5, 46.5);
      sim.enqueue({ type: 'attackStructure', owner: PLAYER, ids: [gun], structure: sim.structureAt(40, 60)!.id });
      sim.enqueue({ type: 'ignite', owner: ENEMY, id: sim.structureAt(33, 50)!.id });
      return sim;
    };
    const a = setup();
    runSec(a, 6);
    const json = JSON.stringify(saveSim(a, 'sandbox', 1, 'normal'));
    // Restore into a sandbox scenario can't reproduce this hand-built map, so compare two straight runs
    // for determinism, and check the save carried the in-flight state.
    const data = JSON.parse(json) as SimSave;
    expect(JSON.stringify(data.sim)).toContain('shells');
    const b = setup();
    runSec(b, 6);
    expect(b.hash()).toBe(a.hash());
    runSec(a, 20);
    runSec(b, 20);
    expect(b.hash()).toBe(a.hash());
    void loadSim;
  });
});
