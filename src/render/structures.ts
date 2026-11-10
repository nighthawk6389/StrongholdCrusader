import * as THREE from 'three';
import type { Sim, SimEvent } from '../sim/sim';
import { footprint, type Structure, type StructureKind } from '../sim/structures';
import { box, cone, cylinder, merge, sphere } from './geometry';
import { COLORS, TEAM_COLORS } from './palette';

export interface Floodlight {
  id: number;
  owner: number;
  light: THREE.SpotLight | null;
  lamp: THREE.Mesh;
}

interface Searchlight {
  id: number;
  head: THREE.Group;
  beam: THREE.Mesh;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = build();
    geoCache.set(key, g);
  }
  return g;
}

const WOOD = 0x8a6a45;
const WOOD_DARK = 0x6b4a2b;
const STONE = 0xaaa293;

/** Main body geometry for a structure kind, centred on its footprint at y=0. */
export function bodyGeometry(kind: StructureKind, owner: number): THREE.BufferGeometry {
  const team = TEAM_COLORS[owner] ?? 0xaaaaaa;
  switch (kind) {
    case 'hq':
      return cached(`hq${owner}`, () =>
        merge([
          box(3.8, 1.5, 3.8, 0, 0.75, 0, COLORS.concrete),
          box(3.9, 0.15, 3.9, 0, 1.55, 0, COLORS.concreteDark),
          box(2.4, 1.1, 2.4, -0.4, 2.15, -0.4, COLORS.concrete),
          box(2.5, 0.12, 2.5, -0.4, 2.75, -0.4, COLORS.roof),
          box(0.9, 0.9, 0.08, 0, 0.45, 1.92, COLORS.windowDark),
          cylinder(0.04, 0.05, 2.6, 1.4, 2.85, 1.4, COLORS.metal, 5),
          box(0.7, 0.42, 0.03, 1.75, 3.9, 1.4, team),
          cylinder(0.35, 0.05, 0.25, 0.9, 2.95, -1.0, COLORS.metal, 8),
          box(0.5, 0.3, 0.4, -1.3, 1.75, 1.3, COLORS.metal),
          box(3.82, 0.18, 0.1, 0, 1.25, 1.91, team),
        ]),
      );
    case 'hub':
      return cached(`hub${owner}`, () =>
        merge([
          box(1.9, 0.05, 1.9, 0, 0.025, 0, 0xb59a6c),
          cone(0.62, 0.9, -0.4, 0.45, -0.35, 0xcdb88e, 4, { ry: Math.PI / 4 }),
          cone(0.5, 0.75, 0.45, 0.375, -0.45, 0xbfa77a, 4, { ry: Math.PI / 4 }),
          cylinder(0.32, 0.36, 0.14, 0.3, 0.07, 0.45, 0x55504a, 8),
          box(0.7, 0.14, 0.18, -0.45, 0.2, 0.55, WOOD),
          cylinder(0.03, 0.03, 2.0, 0.8, 1.0, 0.8, COLORS.metal, 5),
          box(0.5, 0.3, 0.02, 1.05, 1.82, 0.8, team),
        ]),
      );
    case 'house':
      return cached('house', () =>
        merge([
          box(1.8, 1.15, 1.8, 0, 0.575, 0, COLORS.concrete),
          box(1.95, 0.12, 1.95, 0, 1.2, 0, COLORS.roof),
          box(0.45, 0.75, 0.06, 0.4, 0.375, 0.91, COLORS.windowDark),
          box(0.42, 0.3, 0.3, -0.5, 1.4, -0.4, COLORS.metal),
          cylinder(0.25, 0.25, 0.5, 0.5, 1.5, -0.4, 0x7d8a8f, 8),
        ]),
      );
    case 'market':
      return cached(`market${owner}`, () =>
        merge([
          box(2.95, 0.06, 2.95, 0, 0.03, 0, 0xb9a77f),
          box(0.1, 1.4, 0.1, -1.3, 0.7, -1.3, WOOD),
          box(0.1, 1.4, 0.1, 1.3, 0.7, -1.3, WOOD),
          box(0.1, 1.4, 0.1, -1.3, 0.7, 1.3, WOOD),
          box(0.1, 1.4, 0.1, 1.3, 0.7, 1.3, WOOD),
          box(2.9, 0.08, 2.9, 0, 1.45, 0, 0xc0603a, { rx: 0.05 }),
          box(1.2, 0.6, 0.6, -0.6, 0.3, -0.6, COLORS.crate),
          box(0.6, 0.5, 0.6, 0.7, 0.25, -0.7, 0x5d6e3f),
          cylinder(0.25, 0.25, 0.6, 0.7, 0.3, 0.6, 0xd18b3c, 8),
          box(1.0, 0.7, 0.5, -0.5, 0.35, 0.8, 0x9a8f7a),
          box(0.7, 0.3, 0.03, 0, 1.75, 1.46, team),
        ]),
      );
    case 'depot':
      return cached('depot', () =>
        merge([
          box(2.9, 0.08, 2.9, 0, 0.04, 0, COLORS.asphalt),
          box(2.9, 0.5, 0.08, 0, 0.29, -1.41, COLORS.concreteDark),
          box(0.08, 0.5, 2.9, -1.41, 0.29, 0, COLORS.concreteDark),
          box(0.08, 0.5, 2.9, 1.41, 0.29, 0, COLORS.concreteDark),
          box(0.6, 0.6, 0.6, -0.8, 0.38, -0.7, COLORS.crate),
          box(0.6, 0.6, 0.6, -0.15, 0.38, -0.75, COLORS.crate),
          box(0.6, 0.6, 0.6, -0.5, 0.98, -0.7, COLORS.crate),
          box(1.0, 0.5, 0.7, 0.7, 0.33, 0.6, COLORS.tarp),
          cylinder(0.25, 0.25, 0.8, 0.8, 0.48, -0.6, 0x5d6e3f, 8),
          cylinder(0.25, 0.25, 0.8, 0.8, 0.48, -0.05, 0x5d6e3f, 8),
        ]),
      );
    case 'rations':
      return cached('rations', () =>
        merge([
          box(2.8, 1.3, 2.6, 0, 0.65, -0.1, 0xb3ac98),
          box(3.0, 0.14, 2.8, 0, 1.37, -0.1, 0x5f7a46),
          box(1.2, 0.95, 0.06, 0, 0.475, 1.21, 0x6d5f48),
          box(0.6, 0.45, 0.5, -1.0, 0.225, 1.3, COLORS.crate),
          box(0.5, 0.4, 0.5, 1.05, 0.2, 1.3, 0xd18b3c),
          cylinder(0.2, 0.2, 0.55, 1.15, 1.7, -0.8, COLORS.metal, 6),
        ]),
      );
    case 'lumber':
      return cached('lumber', () =>
        merge([
          box(1.9, 0.05, 1.9, 0, 0.025, 0, 0xa98a62),
          box(1.2, 0.9, 0.9, -0.3, 0.45, -0.45, WOOD),
          box(1.4, 0.1, 1.15, -0.3, 1.0, -0.45, WOOD_DARK, { rx: -0.25 }),
          cylinder(0.12, 0.12, 1.2, 0.35, 0.14, 0.45, WOOD_DARK, 6, { rz: Math.PI / 2 }),
          cylinder(0.12, 0.12, 1.2, 0.35, 0.14, 0.7, WOOD_DARK, 6, { rz: Math.PI / 2 }),
          cylinder(0.12, 0.12, 1.2, 0.35, 0.36, 0.58, WOOD_DARK, 6, { rz: Math.PI / 2 }),
          box(0.7, 0.35, 0.3, 0.55, 0.18, -0.35, 0xb0905e),
          cylinder(0.16, 0.16, 0.03, 0.55, 0.42, -0.35, 0xb8b8b8, 10, { rx: Math.PI / 2 }),
        ]),
      );
    case 'quarry':
      return cached('quarry', () =>
        merge([
          box(2.9, 0.06, 2.9, 0, 0.03, 0, 0x8d7a62),
          box(0.6, 0.5, 0.6, -0.9, 0.25, -0.9, STONE),
          box(0.6, 0.5, 0.6, -0.25, 0.25, -0.95, STONE),
          box(0.6, 0.5, 0.6, -0.6, 0.75, -0.9, STONE),
          box(0.6, 0.5, 0.6, -0.9, 0.25, -0.25, 0x9f978a),
          cylinder(0.45, 0.45, 0.9, 0.7, 0.9, 0.6, 0xd08a3a, 10, { rz: Math.PI / 2 - 0.3 }),
          box(0.1, 1.2, 0.1, 0.3, 0.6, 0.35, COLORS.metal),
          box(0.1, 1.2, 0.1, 1.1, 0.6, 0.35, COLORS.metal),
          box(0.1, 1.2, 0.1, 0.3, 0.6, 0.85, COLORS.metal),
          box(0.1, 1.2, 0.1, 1.1, 0.6, 0.85, COLORS.metal),
          box(0.12, 2.6, 0.12, 1.05, 1.3, -1.05, 0xc9a23a),
          box(1.8, 0.1, 0.1, 0.25, 2.55, -1.05, 0xc9a23a),
        ]),
      );
    case 'orchard': {
      return cached('orchard', () => {
        const parts = [box(2.95, 0.05, 2.95, 0, 0.025, 0, 0x5d6b33)];
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            if (r === 2 && c === 2) continue;
            const x = -0.95 + c * 0.95;
            const z = -0.95 + r * 0.95;
            parts.push(cylinder(0.05, 0.07, 0.5, x, 0.25, z, WOOD_DARK, 5));
            parts.push(sphere(0.36, x, 0.72, z, 0x4f7f2f));
            parts.push(sphere(0.07, x + 0.2, 0.7, z + 0.22, 0xe08a2c, 4, 3));
          }
        }
        parts.push(box(0.7, 0.6, 0.6, 0.95, 0.3, 0.95, WOOD));
        parts.push(box(0.8, 0.08, 0.7, 0.95, 0.64, 0.95, WOOD_DARK));
        return merge(parts);
      });
    }
    case 'ranch': {
      return cached('ranch', () => {
        const parts = [box(2.95, 0.05, 2.95, 0, 0.025, 0, 0xb39b6e)];
        for (const s of [-1.42, 1.42]) {
          parts.push(box(2.9, 0.06, 0.06, 0, 0.4, s, WOOD));
          parts.push(box(2.9, 0.06, 0.06, 0, 0.2, s, WOOD));
          parts.push(box(0.06, 0.06, 2.9, s, 0.4, 0, WOOD));
          parts.push(box(0.06, 0.06, 2.9, s, 0.2, 0, WOOD));
        }
        parts.push(box(1.0, 0.8, 0.9, -0.85, 0.4, -0.85, 0x9a4a32));
        parts.push(box(1.1, 0.1, 1.0, -0.85, 0.85, -0.85, COLORS.roof));
        const goats: [number, number, number][] = [
          [0.4, 0.1, 0xf0ece0],
          [0.9, -0.5, 0x8a6a4a],
          [-0.2, 0.8, 0xe8e2d0],
        ];
        for (const [x, z, c] of goats) {
          parts.push(box(0.36, 0.2, 0.18, x, 0.28, z, c));
          parts.push(box(0.12, 0.14, 0.12, x + 0.22, 0.4, z, c));
        }
        parts.push(cylinder(0.25, 0.25, 0.4, 0.9, 0.2, 0.9, 0xd8c070, 8, { rz: Math.PI / 2 }));
        return merge(parts);
      });
    }
    case 'tower':
      return cached(`tower${owner}`, () =>
        merge([
          box(0.2, 2.6, 0.2, -0.75, 1.3, -0.75, COLORS.concreteDark),
          box(0.2, 2.6, 0.2, 0.75, 1.3, -0.75, COLORS.concreteDark),
          box(0.2, 2.6, 0.2, -0.75, 1.3, 0.75, COLORS.concreteDark),
          box(0.2, 2.6, 0.2, 0.75, 1.3, 0.75, COLORS.concreteDark),
          box(1.4, 1.4, 1.4, 0, 0.7, 0, COLORS.concrete),
          box(2.0, 0.18, 2.0, 0, 2.65, 0, COLORS.concrete),
          box(2.0, 0.4, 0.15, 0, 2.95, -0.93, 0xa89a78),
          box(2.0, 0.4, 0.15, 0, 2.95, 0.93, 0xa89a78),
          box(0.15, 0.4, 2.0, -0.93, 2.95, 0, 0xa89a78),
          box(0.15, 0.4, 2.0, 0.93, 2.95, 0, 0xa89a78),
          box(0.1, 0.9, 0.1, -0.85, 3.4, -0.85, COLORS.metal),
          box(0.1, 0.9, 0.1, 0.85, 3.4, 0.85, COLORS.metal),
          box(2.1, 0.1, 2.1, 0, 3.9, 0, COLORS.roof),
          box(0.6, 0.35, 0.03, 0, 4.2, 0, team),
        ]),
      );
    case 'generator':
      return cached(`generator${owner}`, () =>
        merge([
          box(1.9, 0.08, 1.9, 0, 0.04, 0, COLORS.asphalt),
          box(1.4, 0.9, 0.9, -0.15, 0.5, -0.2, 0x6f7a5a),
          box(1.42, 0.12, 0.92, -0.15, 0.98, -0.2, 0x4f5640),
          box(0.3, 0.6, 0.06, -0.15, 0.55, 0.26, 0x2d2d2d),
          cylinder(0.07, 0.07, 0.9, 0.45, 1.35, -0.45, COLORS.metal, 6),
          cylinder(0.3, 0.3, 0.9, 0.55, 0.45, 0.55, 0xb04a2a, 10, { rz: Math.PI / 2 }),
          box(1.4, 0.06, 0.06, -0.15, 0.8, 0.27, team),
        ]),
      );
    case 'searchlight':
      return cached(`searchlight${owner}`, () =>
        merge([
          box(0.18, 2.6, 0.18, -0.6, 1.3, -0.6, COLORS.concreteDark),
          box(0.18, 2.6, 0.18, 0.6, 1.3, -0.6, COLORS.concreteDark),
          box(0.18, 2.6, 0.18, -0.6, 1.3, 0.6, COLORS.concreteDark),
          box(0.18, 2.6, 0.18, 0.6, 1.3, 0.6, COLORS.concreteDark),
          box(1.6, 0.16, 1.6, 0, 2.62, 0, COLORS.concrete),
          box(0.12, 0.7, 0.12, 0, 0.35, 0, COLORS.metal),
          box(0.5, 0.3, 0.03, 0.75, 2.85, 0, team),
        ]),
      );
    case 'sensor':
      return cached('sensor', () =>
        merge([
          box(0.5, 0.16, 0.5, 0, 0.08, 0, COLORS.concreteDark),
          cylinder(0.04, 0.05, 1.6, 0, 0.9, 0, COLORS.metal, 6),
          sphere(0.16, 0, 1.75, 0, 0x8a9096, 8, 6),
          box(0.3, 0.2, 0.06, 0.12, 1.3, 0.05, 0x3a3f44),
        ]),
      );
    case 'kennel':
      return cached('kennel', () => {
        const parts = [box(1.9, 0.05, 1.9, 0, 0.025, 0, 0xa98a62)];
        for (const s2 of [-0.93, 0.93]) {
          parts.push(box(1.86, 0.05, 0.05, 0, 0.35, s2, WOOD));
          parts.push(box(0.05, 0.05, 1.86, s2, 0.35, 0, WOOD));
        }
        parts.push(box(0.6, 0.45, 0.6, -0.45, 0.25, -0.45, 0x8a5a2b));
        parts.push(cone(0.48, 0.3, -0.45, 0.62, -0.45, 0x5a3a1b, 4, { ry: Math.PI / 4 }));
        for (const [x, z, c] of [
          [0.3, 0.2, 0x3a2a1a],
          [0.5, -0.4, 0x8a6a3a],
        ] as [number, number, number][]) {
          parts.push(box(0.4, 0.18, 0.14, x, 0.22, z, c));
          parts.push(box(0.14, 0.14, 0.14, x + 0.24, 0.3, z, c));
        }
        return merge(parts);
      });
    case 'floodlight':
      return cached('floodlight', () =>
        merge([
          box(0.5, 0.2, 0.5, 0, 0.1, 0, COLORS.concreteDark),
          cylinder(0.05, 0.08, 3.0, 0, 1.6, 0, COLORS.metal, 6),
          box(0.5, 0.32, 0.2, 0, 3.1, 0.05, COLORS.metal),
        ]),
      );
    case 'gate':
      // Gatehouse built along x (3 long); rotated a quarter turn when it sits in a north–south wall.
      return cached(`gate${owner}`, () =>
        merge([
          box(3.0, 0.04, 1.0, 0, 0.02, 0, COLORS.asphalt),
          box(0.7, 2.0, 1.1, -1.15, 1.0, 0, COLORS.concrete),
          box(0.7, 2.0, 1.1, 1.15, 1.0, 0, COLORS.concrete),
          box(3.1, 0.3, 1.15, 0, 1.9, 0, COLORS.concreteDark),
          box(1.6, 1.55, 0.12, 0, 0.78, 0, 0x5a5348),
          box(1.6, 0.12, 0.14, 0, 1.1, 0, 0xc9a23a),
          box(0.5, 0.3, 0.03, -1.15, 1.45, 0.57, team),
          box(0.5, 0.3, 0.03, 1.15, 1.45, -0.57, team),
        ]),
      );
    case 'stairs':
      // Ramp rising toward +z (the wall it serves).
      return cached('stairs', () => {
        const parts = [box(0.9, 0.06, 0.95, 0, 0.03, 0, COLORS.concreteDark)];
        for (let k = 0; k < 5; k++) {
          const h = 0.31 * (k + 1);
          parts.push(box(0.85, h, 0.19, 0, h / 2, -0.38 + k * 0.19, COLORS.concrete));
        }
        parts.push(box(0.05, 0.5, 0.95, -0.44, 1.2, 0, COLORS.metal, { rx: -0.9 }));
        return merge(parts);
      });
    case 'scrapyard':
      return cached('scrapyard', () =>
        merge([
          box(2.95, 0.05, 2.95, 0, 0.025, 0, 0x8a7a64),
          box(1.2, 0.5, 0.9, -0.7, 0.25, -0.7, 0x7b5a3c, { ry: 0.3 }),
          box(0.8, 0.6, 1.2, 0.6, 0.3, -0.8, 0x6d6a66, { ry: -0.4 }),
          cylinder(0.3, 0.3, 1.0, -0.8, 0.3, 0.7, 0x8c4a2f, 8, { rz: Math.PI / 2 }),
          box(0.6, 0.35, 0.6, 0.2, 0.18, 0.2, 0x9a8f7a),
          box(0.12, 2.4, 0.12, 1.1, 1.2, 0.9, 0xc9a23a),
          box(1.4, 0.1, 0.1, 0.45, 2.35, 0.9, 0xc9a23a),
          cylinder(0.25, 0.25, 0.08, -0.2, 2.0, 0.9, COLORS.metal, 10),
          box(0.8, 0.7, 0.7, 0.9, 0.35, 0.0, COLORS.metal),
        ]),
      );
    case 'arms':
      return cached(`arms${owner}`, () =>
        merge([
          box(2.8, 1.4, 2.6, 0, 0.7, -0.1, 0x8f8a80),
          box(2.9, 0.15, 2.7, 0, 1.47, -0.1, COLORS.roof),
          box(1.0, 0.9, 0.06, 0.6, 0.45, 1.21, 0x4a443c),
          cylinder(0.18, 0.22, 1.4, -0.9, 2.1, -0.9, COLORS.metal, 8),
          box(0.9, 0.06, 0.2, -0.3, 1.0, 1.22, team),
          box(0.6, 0.5, 0.5, -0.9, 0.25, 1.35, COLORS.crate),
        ]),
      );
    case 'armory':
      return cached(`armory${owner}`, () =>
        merge([
          box(2.8, 1.2, 2.8, 0, 0.6, 0, 0x7d7a5f),
          box(3.0, 0.2, 3.0, 0, 1.3, 0, 0x5d5a45),
          box(1.1, 0.9, 0.06, 0, 0.45, 1.41, 0x3d3a30),
          box(0.6, 0.06, 0.06, 0, 0.95, 1.45, team),
          box(0.5, 0.35, 0.8, -1.0, 0.18, 1.6, 0x5f6b4a),
          box(0.5, 0.35, 0.8, 1.0, 0.18, 1.6, 0x5f6b4a),
        ]),
      );
    case 'barracks':
      return cached(`barracks${owner}`, () =>
        merge([
          box(2.9, 1.1, 1.8, 0, 0.55, -0.5, 0xa79c80),
          box(3.0, 0.12, 1.9, 0, 1.16, -0.5, 0x5f6b4a),
          box(0.7, 0.8, 0.06, 0, 0.4, 0.42, 0x4a443c),
          box(2.9, 0.04, 1.0, 0, 0.02, 0.95, 0xb9a77f),
          cylinder(0.03, 0.03, 2.2, 1.3, 1.1, 1.2, COLORS.metal, 5),
          box(0.6, 0.38, 0.03, 1.6, 2.0, 1.2, team),
          box(0.12, 0.6, 0.12, -1.2, 0.3, 1.2, 0x6b4a2b),
          box(0.9, 0.08, 0.08, -0.8, 0.55, 1.2, 0x6b4a2b),
        ]),
      );
    case 'wall':
      return cached('wall', () =>
        merge([box(1.0, 1.45, 1.0, 0, 0.725, 0, COLORS.concrete), box(1.04, 0.1, 1.04, 0, 1.5, 0, COLORS.concreteDark)]),
      );
  }
}

/** Lowest ground height under a footprint, so buildings never float. */
export function footprintBase(sim: Sim, tx: number, tz: number, w: number, h: number): number {
  let y = Infinity;
  for (let z = tz; z <= tz + h; z++) {
    for (let x = tx; x <= tx + w; x++) y = Math.min(y, sim.map.vertexHeight(x, z));
  }
  return y;
}

/** Renders structures and keeps them in sync with sim add/remove events. */
export class StructureRenderer {
  readonly group = new THREE.Group();
  /** Emissive material for lamp heads (driven by day/night). */
  readonly lampMaterial = new THREE.MeshLambertMaterial({ color: 0x555555, emissive: COLORS.lamp, emissiveIntensity: 0 });
  /** Emissive material for building windows (driven by day/night). */
  readonly windowMaterial = new THREE.MeshLambertMaterial({
    color: COLORS.windowDark,
    emissive: 0xffb45e,
    emissiveIntensity: 0,
  });
  readonly floodlights: Floodlight[] = [];
  private searchlights: Searchlight[] = [];
  private lampOff = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
  private beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff3c8,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private beamGeo = (() => {
    const g = new THREE.ConeGeometry(4.1, 24, 20, 1, true);
    g.translate(0, -12, 0);
    g.rotateX(-Math.PI / 2);
    return g;
  })();

  private bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private objects = new Map<number, THREE.Object3D>();
  private wallMesh: THREE.InstancedMesh | null = null;
  private wallsDirty = true;
  private lightBudget: number;
  private readonly windowGeo = new THREE.BoxGeometry(1.6, 0.18, 1.82);
  private readonly lampGeo = new THREE.BoxGeometry(0.42, 0.24, 0.04);

  constructor(
    private sim: Sim,
    maxLights: number,
  ) {
    this.group.name = 'structures';
    this.lightBudget = maxLights;
    // Player floodlights get priority for the limited real-light budget.
    const sorted = [...sim.structures].sort(
      (a, b) => (a.kind === 'floodlight' && a.owner === 1 ? 0 : 1) - (b.kind === 'floodlight' && b.owner === 1 ? 0 : 1),
    );
    for (const s of sorted) this.add(s);
    this.rebuildWalls();
  }

  handle(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'structureAdded') {
        const s = this.sim.structureById(e.id);
        if (s) this.add(s);
      } else if (e.type === 'structureRemoved') {
        this.remove(e.id);
      }
    }
    if (this.wallsDirty) this.rebuildWalls();
  }

  private add(s: Structure): void {
    if (this.objects.has(s.id)) return;
    if (s.kind === 'wall') {
      this.wallsDirty = true;
      this.objects.set(s.id, new THREE.Object3D());
      return;
    }
    const cx = s.tx + s.w / 2;
    const cz = s.tz + s.h / 2;
    const base = footprintBase(this.sim, s.tx, s.tz, s.w, s.h);
    const root = new THREE.Group();
    root.position.set(cx, base, cz);
    const mesh = new THREE.Mesh(bodyGeometry(s.kind, s.owner), this.bodyMat);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);

    if (s.kind === 'house') {
      const win = new THREE.Mesh(this.windowGeo, this.windowMaterial);
      win.position.set(0, 0.75, 0);
      root.add(win);
    } else if (s.kind === 'hq') {
      const win = new THREE.Mesh(new THREE.BoxGeometry(3.86, 0.2, 3.86), this.windowMaterial);
      win.position.set(0, 0.95, 0);
      root.add(win);
    } else if (s.kind === 'hub') {
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 5), this.lampMaterial);
      fire.position.set(0.3, 0.3, 0.45);
      root.add(fire);
    } else if (s.kind === 'gate' || s.kind === 'stairs') {
      mesh.rotation.y = s.rot;
    } else if (s.kind === 'floodlight') {
      mesh.rotation.y = s.rot;
      const lamp = new THREE.Mesh(this.lampGeo, this.lampMaterial);
      lamp.position.set(0, 3.1, 0.16);
      lamp.rotation.x = 0.35;
      mesh.add(lamp);
      let light: THREE.SpotLight | null = null;
      if (this.lightBudget > 0) {
        this.lightBudget--;
        light = new THREE.SpotLight(0xfff0d2, 0, 26, 0.62, 0.55, 1.1);
        light.position.set(Math.sin(s.rot) * 0.2, 3.2, Math.cos(s.rot) * 0.2);
        const tx = cx + Math.sin(s.rot) * 8;
        const tz = cz + Math.cos(s.rot) * 8;
        light.target.position.set(Math.sin(s.rot) * 8, this.sim.map.heightAt(tx, tz) - base, Math.cos(s.rot) * 8);
        root.add(light, light.target);
      }
      this.floodlights.push({ id: s.id, owner: s.owner, light, lamp });
    } else if (s.kind === 'searchlight') {
      const head = new THREE.Group();
      head.position.set(0, 3.05, 0);
      const housing = new THREE.Mesh(
        cached('searchhead', () => merge([cylinder(0.32, 0.38, 0.55, 0, 0, 0, COLORS.metal, 10, { rx: Math.PI / 2 })])),
        this.bodyMat,
      );
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), this.lampMaterial);
      lens.position.z = 0.28;
      const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
      beam.rotation.x = 0.12;
      beam.renderOrder = 5;
      head.add(housing, lens, beam);
      root.add(head);
      this.searchlights.push({ id: s.id, head, beam });
    }
    this.group.add(root);
    this.objects.set(s.id, root);
  }

  private remove(id: number): void {
    const o = this.objects.get(id);
    if (!o) return;
    this.objects.delete(id);
    if (o.parent) o.parent.remove(o);
    const fi = this.floodlights.findIndex((f) => f.id === id);
    if (fi >= 0) {
      if (this.floodlights[fi].light) this.lightBudget++;
      this.floodlights.splice(fi, 1);
    }
    this.searchlights = this.searchlights.filter((sl) => sl.id !== id);
    this.wallsDirty = true; // cheap to rebuild; covers wall removal
  }

  /** Per-frame: lamps follow power, searchlight beams sweep. `lightsOn` is 0 by day, 1 at night. */
  update(lightsOn: number): void {
    for (const f of this.floodlights) {
      const powered = this.sim.structureById(f.id)?.powered ?? false;
      if (f.light) f.light.intensity = powered ? 45 * lightsOn : 0;
      f.lamp.material = powered ? this.lampMaterial : this.lampOff;
    }
    this.beamMat.opacity = 0.16 * lightsOn;
    for (const sl of this.searchlights) {
      const s = this.sim.structureById(sl.id);
      if (!s) continue;
      sl.head.rotation.y = this.sim.vision.beamAngle(s.rot, s.id);
      sl.beam.visible = s.powered && lightsOn > 0.02;
    }
  }

  private rebuildWalls(): void {
    this.wallsDirty = false;
    if (this.wallMesh) {
      this.group.remove(this.wallMesh);
      this.wallMesh.dispose();
    }
    const walls = this.sim.structures.filter((s) => s.kind === 'wall');
    const mesh = new THREE.InstancedMesh(bodyGeometry('wall', 0), this.bodyMat, Math.max(1, walls.length));
    const m4 = new THREE.Matrix4();
    walls.forEach((s, i) => {
      m4.makeTranslation(s.tx + 0.5, footprintBase(this.sim, s.tx, s.tz, 1, 1), s.tz + 0.5);
      mesh.setMatrixAt(i, m4);
    });
    mesh.count = walls.length;
    mesh.castShadow = mesh.receiveShadow = true;
    this.wallMesh = mesh;
    this.group.add(mesh);
  }
}

/** Translucent preview of a building being placed, plus a footprint tile overlay. */
export class PlacementGhost {
  readonly group = new THREE.Group();
  private body: THREE.Mesh;
  private footprint: THREE.Mesh;
  private mat = new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 0.45, depthWrite: false });
  private padMat = new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 0.3, depthWrite: false });
  private kind: StructureKind | null = null;

  constructor(private sim: Sim) {
    this.body = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    const pad = new THREE.PlaneGeometry(1, 1);
    pad.rotateX(-Math.PI / 2);
    this.footprint = new THREE.Mesh(pad, this.padMat);
    this.body.renderOrder = 4;
    this.footprint.renderOrder = 4;
    this.group.add(this.body, this.footprint);
    this.group.visible = false;
  }

  set(kind: StructureKind | null, tx: number, tz: number, valid: boolean, rot = 0): void {
    if (!kind) {
      this.group.visible = false;
      this.kind = null;
      return;
    }
    const { w, h } = footprint(kind, rot);
    if (kind !== this.kind) {
      this.body.geometry = bodyGeometry(kind, 1);
      this.kind = kind;
    }
    const color = valid ? 0x7dff8a : 0xff5a4a;
    this.mat.color.setHex(color);
    this.padMat.color.setHex(color);
    const base = footprintBase(this.sim, tx, tz, w, h);
    this.group.position.set(tx + w / 2, base, tz + h / 2);
    this.body.rotation.y = kind === 'gate' || kind === 'stairs' ? rot : 0;
    this.footprint.scale.set(w, 1, h);
    this.footprint.position.y = 0.06;
    this.group.visible = true;
  }
}

/** Preview for a wall line: one translucent block per tile, green or red. */
export class WallLineGhost {
  readonly mesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private col = new THREE.Color();

  constructor(private sim: Sim) {
    const geo = new THREE.BoxGeometry(0.96, 1.5, 0.96);
    geo.translate(0, 0.75, 0);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }),
      256,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    for (let i = 0; i < 256; i++) this.mesh.setColorAt(i, this.col.setHex(0xffffff));
  }

  /** tiles: flat [x, z, valid(0/1), ...] */
  set(tiles: number[]): void {
    let n = 0;
    for (let k = 0; k + 2 < tiles.length && n < 256; k += 3, n++) {
      const x = tiles[k];
      const z = tiles[k + 1];
      this.m4.makeTranslation(x + 0.5, footprintBase(this.sim, x, z, 1, 1), z + 0.5);
      this.mesh.setMatrixAt(n, this.m4);
      this.mesh.setColorAt(n, this.col.setHex(tiles[k + 2] ? 0x7dff8a : 0xff5a4a));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Flat outline around the selected structure. */
export class SelectionFrame {
  readonly group = new THREE.Group();
  private bars: THREE.Mesh[] = [];

  constructor(private sim: Sim) {
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.selection, transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.1), mat);
      m.renderOrder = 3;
      this.bars.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
  }

  set(s: Structure | undefined): void {
    if (!s) {
      this.group.visible = false;
      return;
    }
    const y = footprintBase(this.sim, s.tx, s.tz, s.w, s.h) + 0.08;
    const pad = 0.15;
    const x0 = s.tx - pad;
    const x1 = s.tx + s.w + pad;
    const z0 = s.tz - pad;
    const z1 = s.tz + s.h + pad;
    const [n, so, w, e] = this.bars;
    n.scale.set(x1 - x0, 1, 1);
    n.position.set((x0 + x1) / 2, y, z0);
    so.scale.set(x1 - x0, 1, 1);
    so.position.set((x0 + x1) / 2, y, z1);
    w.scale.set(z1 - z0, 1, 1);
    w.rotation.y = Math.PI / 2;
    w.position.set(x0, y, (z0 + z1) / 2);
    e.scale.set(z1 - z0, 1, 1);
    e.rotation.y = Math.PI / 2;
    e.position.set(x1, y, (z0 + z1) / 2);
    this.group.visible = true;
  }
}
