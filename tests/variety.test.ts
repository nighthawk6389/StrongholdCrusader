import { describe, expect, it } from 'vitest';
import { ringBlueprint } from '../src/sim/blueprint';
import { TICK_RATE } from '../src/sim/clock';
import { CONTRACT_COOLDOWN, CONTRACTS } from '../src/sim/contracts';
import { GameMap, Tile } from '../src/sim/map';
import { ENEMY, PLAYER } from '../src/sim/scenario';
import { Sim } from '../src/sim/sim';
import { UNIT_TYPES, UnitKind } from '../src/sim/unitTypes';
import { Order } from '../src/sim/units';

function openSim(w = 64, h = 64): Sim {
  const map = new GameMap(w, h, 1);
  map.tiles.fill(Tile.Sand);
  const sim = new Sim({ map, seed: 23, startSec: 100 });
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

/** The player's HQ inside a closed ring of walls (gatehouses only open for the player). */
function walledBase(sim: Sim, cx = 40, cz = 32, ring = 8): void {
  sim.placeStructure('hq', PLAYER, cx - 2, cz - 2);
  for (const p of ringBlueprint(cx, cz, ring, ['east', 'west', 'north', 'south'])) {
    const s = sim.placeStructure(p.kind, PLAYER, p.tx, p.tz, p.rot);
    if (s && p.kind === 'stairs') s.rot = sim.economy.stairsFacing(p.tx, p.tz, PLAYER) ?? 0;
  }
}

const inside = (sim: Sim, i: number, cx = 40, cz = 32, ring = 8): boolean =>
  sim.units.layer[i] === 0 && Math.abs(sim.units.x[i] - cx) < ring - 1 && Math.abs(sim.units.z[i] - cz) < ring - 1;

describe('the Breacher', () => {
  it('plows straight through a minefield without setting it off', () => {
    const sim = openSim();
    for (let x = 14; x <= 26; x++) sim.placeStructure('mines', PLAYER, x, 30);
    const b = sim.spawnUnit(UnitKind.Breacher, ENEMY, 20.5, 22.5);
    sim.enqueue({ type: 'move', owner: ENEMY, ids: [b], x: 20.5, z: 40.5 });
    runSec(sim, 12);
    expect(sim.units.z[b]).toBeGreaterThan(36);
    expect(sim.units.hp[b]).toBe(UNIT_TYPES[UnitKind.Breacher].hp);
    expect(sim.structureAt(20, 30)).toBeUndefined();
    // Only its own lane was cleared.
    expect(sim.structureAt(14, 30)?.kind).toBe('mines');
  });

  it('bulldozes a ditch in a couple of seconds', () => {
    const sim = openSim();
    for (let x = 0; x < 64; x++) sim.placeStructure('ditch', PLAYER, x, 30);
    const b = sim.spawnUnit(UnitKind.Breacher, ENEMY, 20.5, 27.5);
    const d = sim.structureAt(20, 30)!;
    sim.enqueue({ type: 'attackStructure', owner: ENEMY, ids: [b], structure: d.id });
    runSec(sim, 4);
    expect(sim.structureById(d.id)).toBeUndefined();
    expect(sim.units.charges[b]).toBe(UNIT_TYPES[UnitKind.Breacher].charges);
  });

  it('a ramp against a wall lets infantry climb over it and down the defenders’ own stairs', () => {
    const sim = openSim();
    walledBase(sim);
    const r = sim.spawnUnit(UnitKind.Rifleman, ENEMY, 20.5, 26.5);
    sim.units.hp[r] = 1e6;
    // Without a ramp the walls (and the player's gatehouses) keep him out.
    sim.enqueue({ type: 'move', owner: ENEMY, ids: [r], x: 37.5, z: 29.5 });
    runSec(sim, 20);
    expect(inside(sim, r)).toBe(false);
    // West wall runs along x = 32; push a ramp against it from the outside.
    const wall = sim.structureAt(32, 26)!;
    expect(wall.kind).toBe('wall');
    sim.placeStructure('ramp', ENEMY, 31, 26, Math.PI / 2);
    sim.enqueue({ type: 'move', owner: ENEMY, ids: [r], x: 37.5, z: 29.5 });
    runSec(sim, 25);
    expect(inside(sim, r)).toBe(true);
  });

  it('in an assault, pushes a ramp against the walls instead of waiting for engineers', () => {
    const sim = openSim();
    walledBase(sim);
    const b = sim.spawnUnit(UnitKind.Breacher, ENEMY, 14.5, 32.5);
    sim.units.hp[b] = 1e6;
    sim.enqueue({ type: 'assault', owner: ENEMY, ids: [b], target: PLAYER });
    runSec(sim, 50);
    const ramps = sim.structures.filter((s) => s.kind === 'ramp' && s.owner === ENEMY);
    expect(ramps.length).toBe(1);
    expect(sim.units.charges[b]).toBe(UNIT_TYPES[UnitKind.Breacher].charges - 1);
    // Squarely against the ring's wall line.
    const rp = ramps[0];
    const touching = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dz]) => sim.map.deck[sim.map.idx(rp.tx + dx, rp.tz + dz)] === 1 && sim.map.structOwner[sim.map.idx(rp.tx + dx, rp.tz + dz)] === PLAYER);
    expect(touching).toBe(true);
  });

  it('under direct control, pushes a ramp where you drive it', () => {
    const sim = openSim();
    walledBase(sim);
    const b = sim.spawnUnit(UnitKind.Breacher, ENEMY, 31.3, 26.5, Math.PI / 2);
    sim.enqueue({ type: 'control', owner: ENEMY, id: b, mx: 0, mz: 0, yaw: Math.PI / 2, fire: false, aim: false, plant: true });
    runSec(sim, 6);
    expect(sim.units.order[b]).toBe(Order.Control);
    expect(sim.structures.some((s) => s.kind === 'ramp' && s.owner === ENEMY)).toBe(true);
  });
});

describe('PMC contracts', () => {
  it('hire a team for cash at a Contracts Office; one contract a minute', () => {
    const sim = openSim();
    sim.placeStructure('hq', PLAYER, 2, 2);
    const office = sim.placeStructure('contracts', PLAYER, 12, 12)!;
    const p = sim.economy.player(PLAYER);
    p.funds = 1000;
    const before = sim.units.count;
    sim.enqueue({ type: 'hire', owner: PLAYER, office: office.id, contract: 0 });
    sim.step();
    const team = CONTRACTS[0];
    expect(p.funds).toBe(1000 - team.funds);
    const hired: number[] = [];
    for (let i = before; i < sim.units.count; i++) if (sim.units.alive[i]) hired.push(i);
    expect(hired.length).toBe(team.units[0][1]);
    for (const i of hired) {
      expect(sim.units.owner[i]).toBe(PLAYER);
      expect(sim.units.kind[i]).toBe(team.units[0][0]);
      expect(Math.hypot(sim.units.x[i] - 13.5, sim.units.z[i] - 13.5)).toBeLessThan(5);
    }
    expect(sim.economy.hireBlocker(PLAYER, office.id, 1)).toMatch(/Next contract/);
    runSec(sim, CONTRACT_COOLDOWN);
    expect(sim.economy.hireBlocker(PLAYER, office.id, 1)).toBeNull();
    p.funds = 10;
    expect(sim.economy.hireBlocker(PLAYER, office.id, 1)).toBe('Not enough funds');
  });

  it('an armored car contract rolls out onto open ground, ready to fight', () => {
    const sim = openSim();
    sim.placeStructure('hq', PLAYER, 2, 2);
    const office = sim.placeStructure('contracts', PLAYER, 12, 12)!;
    sim.economy.player(PLAYER).funds = 1000;
    const k = CONTRACTS.findIndex((c) => c.key === 'car');
    const ids = sim.economy.hire(PLAYER, office.id, k);
    expect(ids.length).toBe(1);
    expect(sim.units.kind[ids[0]]).toBe(UnitKind.ArmoredCar);
    expect(sim.map.isWalkableTile(Math.floor(sim.units.x[ids[0]]), Math.floor(sim.units.z[ids[0]]))).toBe(true);
  });
});
