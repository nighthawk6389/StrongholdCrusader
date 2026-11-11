import { describe, expect, it } from 'vitest';
import { generateDesertMap, Tile, type GameMap } from '../src/sim/map';
import { MAPS, MAP_KEYS } from '../src/sim/maps';
import { createScenario } from '../src/sim/scenario';

const BASES = [
  { x: 28, z: 64 },
  { x: 100, z: 64 },
];

/** Ground tiles reachable on foot from a point (4-way flood fill). */
function reach(map: GameMap, x: number, z: number): Uint8Array {
  const seen = new Uint8Array(map.width * map.height);
  const stack = [map.idx(Math.floor(x), Math.floor(z))];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const tx = i % map.width;
    const tz = (i - tx) / map.width;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = tx + dx;
      const nz = tz + dz;
      if (!map.walkable(nx, nz, 0, 0)) continue;
      const j = map.idx(nx, nz);
      if (seen[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

function countNear(map: GameMap, b: { x: number; z: number }, r: number, tile: number): number {
  let n = 0;
  for (let tz = 0; tz < map.height; tz++) {
    for (let tx = 0; tx < map.width; tx++) {
      if (map.tileAt(tx, tz) === tile && Math.hypot(tx + 0.5 - b.x, tz + 0.5 - b.z) < r) n++;
    }
  }
  return n;
}

describe('skirmish maps', () => {
  for (const key of MAP_KEYS) {
    describe(MAPS[key].name, () => {
      for (const seed of [1337, 7]) {
        const map = generateDesertMap(MAPS[key].spec(seed, BASES));

        it(`is a mirror image west to east (seed ${seed})`, () => {
          for (let tz = 0; tz < map.height; tz++) {
            for (let tx = 0; tx < map.width / 2; tx++) {
              expect(map.tileAt(map.width - 1 - tx, tz)).toBe(map.tileAt(tx, tz));
            }
          }
          const west = map.trees.filter((t) => t.x < 64).length;
          expect(map.trees.length).toBe(west * 2);
        });

        it(`lets the two bases reach each other (seed ${seed})`, () => {
          const seen = reach(map, BASES[0].x, BASES[0].z);
          expect(seen[map.idx(BASES[1].x, BASES[1].z)]).toBe(1);
        });

        it(`gives each base timber, stone, farmland and oil within reach (seed ${seed})`, () => {
          for (const b of BASES) {
            const trees = map.trees.filter((t) => Math.hypot(t.x - b.x, t.z - b.z) < 36).length;
            expect(trees).toBeGreaterThan(key === 'dunes' ? 6 : 12);
            expect(countNear(map, b, 36, Tile.Rock)).toBeGreaterThan(4);
            expect(countNear(map, b, 36, Tile.Fertile)).toBeGreaterThan(20);
            expect(countNear(map, b, 36, Tile.Oil)).toBeGreaterThan(3);
          }
        });
      }
    });
  }

  it('Rocky Pass funnels traffic through its passes', () => {
    const map = generateDesertMap(MAPS.pass.spec(1337, BASES));
    // Mid-ridge, away from the passes, the ridge band is solid rock.
    let rock = 0;
    for (let x = 50; x <= 58; x++) if (map.tileAt(x, 44) === Tile.Rock) rock++;
    expect(rock).toBeGreaterThanOrEqual(3);
  });

  it('skirmish uses the chosen map and opponent', () => {
    const a = createScenario('skirmish', 1337, 'normal', { map: 'pass' });
    const b = createScenario('skirmish', 1337, 'normal', { map: 'dunes' });
    let diff = 0;
    for (let i = 0; i < a.sim.map.tiles.length; i++) if (a.sim.map.tiles[i] !== b.sim.map.tiles[i]) diff++;
    expect(diff).toBeGreaterThan(500);
    expect(a.ai?.personality.key).toBe('sarge');
  });
});
