import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { FLARE_MAX, FLARE_REGEN_SEC } from '../src/sim/economy';
import { GameMap, Tile } from '../src/sim/map';
import { ENEMY, PLAYER } from '../src/sim/scenario';
import { Sim } from '../src/sim/sim';
import { Res, STRUCTURE_DEFS, maxHp } from '../src/sim/structures';
import { UnitKind } from '../src/sim/unitTypes';
import { Order } from '../src/sim/units';

function openSim(startSec = 100): Sim {
  const map = new GameMap(48, 48, 1);
  map.tiles.fill(Tile.Sand);
  const sim = new Sim({ map, seed: 31, startSec });
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

describe('flares are limited', () => {
  it('three on hand, then you wait for the next one', () => {
    const sim = openSim(400);
    sim.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 20.5);
    const p = sim.economy.player(PLAYER);
    p.funds = 500;
    for (let k = 0; k < FLARE_MAX + 1; k++) sim.enqueue({ type: 'flare', owner: PLAYER, x: 22 + k, z: 24 });
    sim.step();
    expect(sim.vision.flares.length).toBe(FLARE_MAX);
    expect(p.flares).toBe(0);
    runSec(sim, FLARE_REGEN_SEC + 1);
    expect(p.flares).toBe(1);
  });
});

describe('drones and gun towers', () => {
  it("a recon drone's thermal camera finds an operator lying still in the dark", () => {
    const sim = openSim(400);
    const op = sim.spawnUnit(UnitKind.Operator, ENEMY, 20.5, 30.5);
    sim.units.order[op] = Order.Control; // lying still, not shooting
    const rifle = openSim(400);
    const op2 = rifle.spawnUnit(UnitKind.Operator, ENEMY, 20.5, 30.5);
    rifle.units.order[op2] = Order.Control;
    rifle.spawnUnit(UnitKind.Rifleman, PLAYER, 20.5, 26.5);
    runSec(rifle, 1);
    expect(rifle.vision.isSeen(PLAYER, op2)).toBe(false);
    const d = sim.spawnUnit(UnitKind.ReconDrone, PLAYER, 20.5, 14.5);
    sim.units.battery[d] = 999;
    runSec(sim, 1);
    expect(sim.vision.isSeen(PLAYER, op)).toBe(true);
  });

  it('rockets, shells and explosives wreck gun towers faster', () => {
    const sim = openSim();
    const a = sim.placeStructure('guntower', ENEMY, 10, 10)!;
    const b = sim.placeStructure('tower', ENEMY, 20, 10)!;
    sim.damageStructure(a, 100, true);
    sim.damageStructure(b, 100, true);
    expect(STRUCTURE_DEFS.guntower.hp - a.hp).toBeCloseTo(175, 3);
    expect(STRUCTURE_DEFS.tower.hp - b.hp).toBeCloseTo(100, 3);
  });
});

describe('building upgrades', () => {
  function base(): Sim {
    const sim = openSim();
    sim.placeStructure('hq', PLAYER, 2, 2);
    const p = sim.economy.player(PLAYER);
    p.funds = 1000;
    p.stock[Res.Timber] = 100;
    p.stock[Res.Concrete] = 100;
    p.stock[Res.Steel] = 100;
    return sim;
  }

  it('an apartment block houses more people', () => {
    const sim = base();
    const h = sim.placeStructure('house', PLAYER, 12, 4)!;
    sim.economy.recount();
    const before = sim.economy.player(PLAYER).housing;
    sim.enqueue({ type: 'upgrade', owner: PLAYER, id: h.id });
    sim.step();
    expect(h.level).toBe(2);
    expect(sim.economy.player(PLAYER).housing).toBe(before + 6);
    expect(maxHp(h)).toBeCloseTo(STRUCTURE_DEFS.house.hp * 1.3, 3);
    expect(sim.economy.upgradeBlocker(PLAYER, h.id)).toBe('Fully upgraded');
  });

  it('a generator turbine adds power; upgrades cost what they say', () => {
    const sim = base();
    const g = sim.placeStructure('generator', PLAYER, 12, 4)!;
    sim.spawnUnit(UnitKind.Civilian, PLAYER, 13.5, 7.5);
    runSec(sim, 8); // a worker takes the job
    sim.economy.allocatePower();
    const supply = sim.economy.player(PLAYER).powerSupply;
    const steel = sim.economy.player(PLAYER).stock[Res.Steel];
    sim.enqueue({ type: 'upgrade', owner: PLAYER, id: g.id });
    sim.step();
    sim.economy.allocatePower();
    expect(sim.economy.player(PLAYER).powerSupply).toBe(supply + 8);
    expect(sim.economy.player(PLAYER).stock[Res.Steel]).toBe(steel - 8);
  });

  it('a watchtower becomes a gun tower, keeping its walkable top and its share of health', () => {
    const sim = base();
    const t = sim.placeStructure('tower', PLAYER, 12, 4)!;
    t.hp = STRUCTURE_DEFS.tower.hp / 2;
    sim.enqueue({ type: 'upgrade', owner: PLAYER, id: t.id });
    sim.step();
    expect(t.kind).toBe('guntower');
    expect(t.level).toBe(1);
    expect(t.hp).toBeCloseTo(STRUCTURE_DEFS.guntower.hp / 2, 3);
    expect(sim.map.deck[sim.map.idx(12, 4)]).toBe(1);
    expect(t.ammo).toBe(STRUCTURE_DEFS.guntower.turret!.mag);
  });

  it("can't upgrade without the materials", () => {
    const sim = base();
    const s = sim.placeStructure('scrapyard', PLAYER, 12, 4)!;
    sim.economy.player(PLAYER).stock[Res.Concrete] = 0;
    expect(sim.economy.upgradeBlocker(PLAYER, s.id)).toMatch(/concrete/);
  });

  it('upgraded producers work faster', () => {
    const run = (upgrade: boolean): number => {
      const sim = base();
      sim.placeStructure('depot', PLAYER, 16, 2);
      const yard = sim.placeStructure('scrapyard', PLAYER, 12, 8)!;
      for (let k = 0; k < 2; k++) sim.spawnUnit(UnitKind.Civilian, PLAYER, 10.5 + k, 14.5);
      sim.economy.player(PLAYER).active = true;
      sim.economy.player(PLAYER).stock[Res.Steel] = 0;
      if (upgrade) {
        sim.enqueue({ type: 'upgrade', owner: PLAYER, id: yard.id });
        sim.economy.player(PLAYER).stock[Res.Steel] = 0;
      }
      runSec(sim, 120);
      return sim.economy.player(PLAYER).stock[Res.Steel];
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });
});
