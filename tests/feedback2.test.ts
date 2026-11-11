import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/clock';
import { BUILD_RADIUS } from '../src/sim/economy';
import { GameMap, Tile } from '../src/sim/map';
import { ENEMY, PLAYER } from '../src/sim/scenario';
import { Sim } from '../src/sim/sim';
import { Res, STRUCTURE_DEFS } from '../src/sim/structures';
import { UNIT_TYPES, UnitKind } from '../src/sim/unitTypes';

function openSim(w = 96, h = 96, startSec = 100): Sim {
  const map = new GameMap(w, h, 1);
  map.tiles.fill(Tile.Sand);
  const sim = new Sim({ map, seed: 41, startSec });
  sim.economy.player(PLAYER);
  sim.economy.player(ENEMY);
  return sim;
}

describe('howitzers and their counter', () => {
  it('a howitzer reaches only a little beyond a gun tower', () => {
    const gun = STRUCTURE_DEFS.guntower.turret!.range * (1 + 0.12 * STRUCTURE_DEFS.guntower.deckH!);
    expect(UNIT_TYPES[UnitKind.Howitzer].range).toBeLessThanOrEqual(gun + 6);
    expect(STRUCTURE_DEFS.mortar.mortar!.range).toBeGreaterThan(UNIT_TYPES[UnitKind.Howitzer].range);
  });

  it('a mortar pit fires back at an unseen howitzer that shells its side', () => {
    const sim = openSim();
    const target = sim.placeStructure('house', PLAYER, 40, 40)!;
    const mortar = sim.placeStructure('mortar', PLAYER, 44, 44)!;
    // The howitzer sits out of anyone's sight, 28 tiles from the house, ~31 from the mortar.
    const gun = sim.spawnUnit(UnitKind.Howitzer, ENEMY, 41, 68.5, Math.PI);
    sim.enqueue({ type: 'attackStructure', owner: ENEMY, ids: [gun], structure: target.id });
    expect(sim.vision.isSeen(PLAYER, gun)).toBe(false);
    let counter = false;
    for (let t = 0; t < 40 * TICK_RATE; t++) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'shell' && e.owner === PLAYER) counter = true;
    }
    expect(target.hp).toBeLessThan(STRUCTURE_DEFS.house.hp); // it did shell us
    expect(counter).toBe(true);
    expect(sim.units.isAlive(gun) ? sim.units.hp[gun] : 0).toBeLessThan(UNIT_TYPES[UnitKind.Howitzer].hp);
    void mortar;
  });

  it('a mortar pit ignores enemies nobody can see, unless they are guns that have fired', () => {
    const sim = openSim(96, 96, 400); // night: a lone rifleman far off stays unseen
    sim.placeStructure('mortar', PLAYER, 44, 44);
    sim.spawnUnit(UnitKind.Rifleman, ENEMY, 45, 72);
    let fired = false;
    for (let t = 0; t < 10 * TICK_RATE; t++) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'shell') fired = true;
    }
    expect(fired).toBe(false);
  });
});

describe('build distance', () => {
  it('farms, work sites and depots can go anywhere; defenses and the rest stay near the HQ', () => {
    const sim = openSim(128, 128);
    sim.placeStructure('hq', PLAYER, 10, 60);
    const p = sim.economy.player(PLAYER);
    p.funds = 5000;
    p.stock[Res.Timber] = 500;
    p.stock[Res.Concrete] = 500;
    p.stock[Res.Steel] = 500;
    const far = 12 + BUILD_RADIUS + 20;
    for (let x = far - 2; x < far + 6; x++) sim.map.tiles[sim.map.idx(x, 60)] = Tile.Rock;
    sim.map.tiles.fill(Tile.Fertile, sim.map.idx(far, 70), sim.map.idx(far + 4, 70));
    for (let z = 70; z < 74; z++) for (let x = far; x < far + 4; x++) sim.map.tiles[sim.map.idx(x, z)] = Tile.Fertile;
    expect(sim.economy.canPlace(PLAYER, 'quarry', far, 61).ok).toBe(true);
    expect(sim.economy.canPlace(PLAYER, 'orchard', far, 70).ok).toBe(true);
    expect(sim.economy.canPlace(PLAYER, 'depot', far, 80).ok).toBe(true);
    expect(sim.economy.canPlace(PLAYER, 'tower', far, 90).reason).toBe('Too far from your HQ');
    expect(sim.economy.canPlace(PLAYER, 'house', far, 90).reason).toBe('Too far from your HQ');
  });
});
