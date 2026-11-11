import type { DesertMapSpec } from './map';

/**
 * Skirmish maps. Every one is mirrored west–east so both commanders start with the same ground:
 * bases sit at (28, 64) and (100, 64) on a 128×128 map. Only the west half is described here.
 */
export type MapKey = 'basin' | 'dunes' | 'pass' | 'oilfields';

export interface MapInfo {
  key: MapKey;
  name: string;
  blurb: string;
  spec(seed: number, bases: { x: number; z: number }[]): DesertMapSpec;
}

const clearings = (bases: { x: number; z: number }[]) => bases.map((b) => ({ x: b.x, z: b.z, r: 15 }));

export const MAPS: Record<MapKey, MapInfo> = {
  basin: {
    key: 'basin',
    name: 'Oasis Basin',
    blurb: 'Balanced: a central oasis, palm groves and rock outcrops on both sides.',
    spec: (seed, bases) => ({
      width: 128,
      height: 128,
      seed,
      mirror: true,
      clearings: clearings(bases),
      oases: [
        { x: 46, z: 38, r: 3.5 },
        { x: 64, z: 64, r: 4.5 },
      ],
      extraOases: 1,
      oilPatches: 1,
      oil: [{ x: 22, z: 98 }],
      groves: [
        { x: 10, z: 86, r: 5 },
        { x: 44, z: 88, r: 4 },
        { x: 14, z: 36, r: 4 },
      ],
    }),
  },
  dunes: {
    key: 'dunes',
    name: 'Dune Sea',
    blurb: 'Rolling open dunes with little cover. Timber is scarce; water and oil are not.',
    spec: (seed, bases) => ({
      width: 128,
      height: 128,
      seed: seed + 101,
      mirror: true,
      duneScale: 1.7,
      rockiness: 0.7,
      wildTrees: 2,
      clearings: clearings(bases),
      oases: [
        { x: 40, z: 34, r: 3 },
        { x: 40, z: 96, r: 3 },
        { x: 64, z: 64, r: 4 },
      ],
      extraOases: 1,
      oilPatches: 1,
      oil: [
        { x: 50, z: 60 },
        { x: 22, z: 100 },
      ],
      groves: [{ x: 12, z: 88, r: 4.5 }],
      tint: { hue: 0.008, sat: 0.06, light: 0.04 },
    }),
  },
  pass: {
    key: 'pass',
    name: 'Rocky Pass',
    blurb: 'Two rock ridges split the map. Three passes are the only ways through: hold them.',
    spec: (seed, bases) => ({
      width: 128,
      height: 128,
      seed: seed + 202,
      mirror: true,
      rockiness: 0.6,
      clearings: clearings(bases),
      ridges: [
        {
          x: 54,
          w: 4,
          gaps: [
            [16, 26],
            [58, 70],
            [102, 112],
          ],
        },
      ],
      oases: [
        { x: 64, z: 64, r: 4 },
        { x: 38, z: 96, r: 3 },
        { x: 36, z: 32, r: 3 },
      ],
      extraOases: 0,
      oilPatches: 0,
      oil: [{ x: 42, z: 46 }],
      groves: [
        { x: 12, z: 30, r: 5 },
        { x: 14, z: 98, r: 5 },
      ],
      tint: { hue: -0.012, sat: 0.05, light: -0.03 },
    }),
  },
  oilfields: {
    key: 'oilfields',
    name: 'Oil Fields',
    blurb: 'Seeps everywhere and little farmland: fuel for armor, but food is tight.',
    spec: (seed, bases) => ({
      width: 128,
      height: 128,
      seed: seed + 303,
      mirror: true,
      clearings: clearings(bases),
      oases: [
        { x: 64, z: 64, r: 3.5 },
        { x: 30, z: 100, r: 3 },
      ],
      extraOases: 0,
      oilPatches: 1,
      oil: [
        { x: 48, z: 48 },
        { x: 48, z: 80 },
        { x: 58, z: 26 },
        { x: 58, z: 102 },
        { x: 24, z: 32 },
      ],
      groves: [
        { x: 10, z: 86, r: 5 },
        { x: 18, z: 30, r: 4 },
      ],
      tint: { hue: -0.02, sat: -0.1, light: -0.05 },
    }),
  },
};

export const MAP_KEYS = Object.keys(MAPS) as MapKey[];

export function isMapKey(k: string | null | undefined): k is MapKey {
  return !!k && k in MAPS;
}
