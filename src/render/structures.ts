import * as THREE from 'three';
import type { Sim, SimEvent } from '../sim/sim';
import { footprint, structureTop, type Structure, type StructureKind } from '../sim/structures';
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
  halo: THREE.Sprite;
}

/** A soft round glow (white centre fading out), shared by every lamp halo. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface GunMount {
  id: number;
  gun: THREE.Object3D;
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
    case 'guntower':
      return cached(`guntower${owner}`, () =>
        merge([
          box(0.2, 2.6, 0.2, -0.75, 1.3, -0.75, COLORS.concreteDark),
          box(0.2, 2.6, 0.2, 0.75, 1.3, -0.75, COLORS.concreteDark),
          box(0.2, 2.6, 0.2, -0.75, 1.3, 0.75, COLORS.concreteDark),
          box(0.2, 2.6, 0.2, 0.75, 1.3, 0.75, COLORS.concreteDark),
          box(1.5, 1.5, 1.5, 0, 0.75, 0, COLORS.concrete),
          box(2.0, 0.2, 2.0, 0, 2.65, 0, COLORS.concrete),
          // Sandbagged parapet
          box(2.0, 0.45, 0.3, 0, 2.97, -0.85, 0xb7a479),
          box(2.0, 0.45, 0.3, 0, 2.97, 0.85, 0xb7a479),
          box(0.3, 0.45, 1.4, -0.85, 2.97, 0, 0xb7a479),
          box(0.3, 0.45, 1.4, 0.85, 2.97, 0, 0xb7a479),
          box(2.02, 0.08, 0.32, 0, 3.2, -0.85, 0xa08f66),
          box(2.02, 0.08, 0.32, 0, 3.2, 0.85, 0xa08f66),
          // Pintle post (the gun turns on top of it)
          cylinder(0.08, 0.1, 0.7, 0, 3.1, 0, COLORS.metal, 6),
          box(0.7, 0.3, 0.03, 0.62, 3.65, -0.86, team),
        ]),
      );
    case 'dronebay':
      return cached(`dronebay${owner}`, () =>
        merge([
          box(1.95, 0.1, 1.95, 0, 0.05, 0, COLORS.asphalt),
          // Landing "H"
          box(0.08, 0.02, 0.7, -0.25, 0.11, 0, 0xe8e2d0),
          box(0.08, 0.02, 0.7, 0.25, 0.11, 0, 0xe8e2d0),
          box(0.5, 0.02, 0.08, 0, 0.11, 0, 0xe8e2d0),
          // Charging cabinet and antenna
          box(0.5, 0.75, 0.4, -0.7, 0.45, -0.7, 0x5d6650),
          box(0.52, 0.06, 0.42, -0.7, 0.85, -0.7, 0x454c3c),
          box(0.3, 0.1, 0.03, -0.7, 0.6, -0.49, 0x6fd06f),
          cylinder(0.02, 0.03, 1.2, 0.8, 0.6, -0.8, COLORS.metal, 4),
          sphere(0.07, 0.8, 1.22, -0.8, 0xd0d0d0),
          box(0.6, 0.25, 0.03, 0.4, 0.3, 0.97, team),
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
    case 'derrick':
      return cached(`derrick${owner}`, () =>
        merge([
          box(1.9, 0.1, 1.9, 0, 0.05, 0, COLORS.asphalt),
          // A-frame and walking beam of a pumpjack
          box(0.1, 1.5, 0.1, -0.25, 0.8, -0.2, COLORS.metal, { rz: 0.25 }),
          box(0.1, 1.5, 0.1, 0.25, 0.8, -0.2, COLORS.metal, { rz: -0.25 }),
          box(0.14, 0.14, 1.9, 0, 1.55, 0, 0x8a3b2a),
          box(0.3, 0.55, 0.22, 0, 1.4, 0.95, 0x8a3b2a),
          box(0.12, 0.9, 0.12, 0, 0.95, -0.8, 0x3a3a3a),
          cylinder(0.25, 0.25, 0.2, 0, 0.5, -0.8, 0x3a3a3a, 10, { rx: Math.PI / 2 }),
          cylinder(0.05, 0.05, 1.0, 0, 0.6, 0.95, COLORS.metal, 6),
          // Storage tank
          cylinder(0.35, 0.35, 0.8, 0.65, 0.5, 0.6, 0x2f3530, 10),
          box(0.5, 0.25, 0.03, -0.6, 0.35, 0.96, team),
        ]),
      );
    case 'motorpool':
      return cached(`motorpool${owner}`, () =>
        merge([
          box(2.9, 0.08, 2.9, 0, 0.04, 0, COLORS.asphalt),
          box(2.6, 1.5, 2.2, 0, 0.75, -0.3, 0x6f765e),
          box(2.75, 0.14, 2.35, 0, 1.55, -0.3, 0x4f5640),
          box(1.6, 1.2, 0.05, 0, 0.6, 0.82, 0x2a2c24),
          box(1.7, 0.08, 0.06, 0, 1.24, 0.84, 0x9a9a8a),
          box(2.62, 0.12, 0.05, 0, 1.38, 0.83, team),
          // Fuel pump out front
          box(0.25, 0.6, 0.2, 1.1, 0.34, 1.15, 0xc8a23a),
          box(0.2, 0.12, 0.05, 1.1, 0.52, 1.26, 0x222222),
        ]),
      );
    case 'mines':
      return cached('mines', () =>
        merge([
          cylinder(0.32, 0.4, 0.06, -0.22, 0.03, -0.18, 0xa48a62, 8),
          cylinder(0.32, 0.4, 0.06, 0.22, 0.03, 0.2, 0xa48a62, 8),
          cylinder(0.1, 0.1, 0.05, -0.22, 0.07, -0.18, 0x4a4a42, 8),
          cylinder(0.1, 0.1, 0.05, 0.22, 0.07, 0.2, 0x4a4a42, 8),
          box(0.04, 0.3, 0.04, 0.38, 0.15, -0.38, 0x7a6a4a),
          box(0.14, 0.1, 0.01, 0.38, 0.27, -0.37, 0xd03a2a),
        ]),
      );
    case 'ditch':
      return cached('ditch', () =>
        merge([
          box(1.0, 0.05, 1.0, 0, 0.0, 0, 0x3a2c1e),
          box(0.7, 0.05, 0.7, 0, 0.01, 0, 0x1f1812),
          box(1.0, 0.16, 0.12, 0, 0.06, -0.46, 0x9c8058),
          box(1.0, 0.16, 0.12, 0, 0.06, 0.46, 0x9c8058),
        ]),
      );
    case 'trench':
      return cached('trench', () =>
        merge([
          box(1.0, 0.04, 1.0, 0, 0.0, 0, 0x5a4a36),
          box(0.8, 0.04, 0.8, 0, 0.02, 0, 0x14110d),
          box(0.25, 0.02, 0.12, -0.15, 0.045, 0.1, 0x3b3a44),
        ]),
      );
    case 'mortar':
      // Sandbag ring around a mortar tube on a baseplate, with a radar mast.
      return cached(`mortar${owner}`, () => {
        const parts = [box(1.9, 0.06, 1.9, 0, 0.03, 0, 0x8a7a5a)];
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          parts.push(box(0.55, 0.32, 0.3, Math.sin(a) * 0.78, 0.2, Math.cos(a) * 0.78, k % 2 ? 0xb39a6a : 0xa58c5e, { ry: a }));
        }
        parts.push(
          cylinder(0.22, 0.26, 0.08, 0, 0.1, 0, 0x2f322b, 10),
          cylinder(0.07, 0.08, 0.95, 0, 0.5, 0.1, 0x3a3e34, 8, { rx: -0.5 }),
          box(0.04, 1.4, 0.04, 0.62, 0.7, -0.62, COLORS.metal),
          box(0.42, 0.22, 0.03, 0.62, 1.42, -0.62, 0xd8d8d0, { rx: 0.4 }),
          box(0.5, 0.1, 0.04, -0.55, 0.42, 0.62, team),
        );
        return merge(parts);
      });
    case 'ramp':
      // Steel assault ramp rising toward +z (the wall it leans on), in the owner's colours.
      return cached(`ramp${owner}`, () =>
        merge([
          box(0.92, 0.08, 1.25, 0, 0.42, -0.02, 0x9a9c86, { rx: -0.66 }),
          box(0.06, 0.2, 1.25, -0.45, 0.5, -0.02, 0x6a6e5c, { rx: -0.66 }),
          box(0.06, 0.2, 1.25, 0.45, 0.5, -0.02, 0x6a6e5c, { rx: -0.66 }),
          box(0.9, 0.07, 0.04, 0, 0.2, -0.3, 0x2c2f28, { rx: -0.66 }),
          box(0.9, 0.07, 0.04, 0, 0.47, 0.05, 0x2c2f28, { rx: -0.66 }),
          box(0.12, 0.8, 0.12, -0.38, 0.4, 0.42, 0x3e4238),
          box(0.12, 0.8, 0.12, 0.38, 0.4, 0.42, 0x3e4238),
          box(0.7, 0.08, 0.03, 0, 0.12, -0.5, team),
        ]),
      );
    case 'contracts':
      // A prefab office with a sign, a flagpole and a parked pickup.
      return cached(`contracts${owner}`, () =>
        merge([
          box(2.9, 0.06, 2.9, 0, 0.03, 0, COLORS.asphalt),
          box(2.2, 1.2, 1.5, -0.25, 0.6, -0.55, 0xd6d0c0),
          box(2.3, 0.1, 1.6, -0.25, 1.25, -0.55, 0x5a5f66),
          box(0.6, 0.85, 0.04, -0.25, 0.43, 0.21, COLORS.windowDark),
          box(0.5, 0.3, 0.04, -1.0, 0.75, 0.21, 0x9fb7c8),
          box(1.4, 0.32, 0.06, -0.25, 1.5, 0.15, 0x1f2328),
          box(1.2, 0.1, 0.07, -0.25, 1.5, 0.16, team),
          cylinder(0.035, 0.04, 2.4, 1.15, 1.2, -1.1, COLORS.metal, 5),
          box(0.6, 0.36, 0.03, 1.45, 2.2, -1.1, team),
          // Pickup truck
          box(0.6, 0.35, 1.2, 0.9, 0.35, 0.75, 0x3d3f3a),
          box(0.56, 0.3, 0.45, 0.9, 0.67, 0.55, 0x3d3f3a),
          box(0.5, 0.2, 0.03, 0.9, 0.7, 0.33, 0x8fa3b0),
          cylinder(0.14, 0.14, 0.64, 0.9, 0.16, 0.4, 0x1a1a1a, 8, { rz: Math.PI / 2 }),
          cylinder(0.14, 0.14, 0.64, 0.9, 0.16, 1.1, 0x1a1a1a, 8, { rz: Math.PI / 2 }),
        ]),
      );
    case 'wire':
      return cached('wire', () =>
        merge([
          box(0.05, 0.5, 0.05, -0.42, 0.25, 0, 0x5a4a32),
          box(0.05, 0.5, 0.05, 0.42, 0.25, 0, 0x5a4a32),
          cylinder(0.22, 0.22, 0.96, 0, 0.24, 0, 0x8d8f88, 7, { rz: Math.PI / 2 }),
          cylinder(0.16, 0.16, 0.96, 0, 0.24, 0.03, 0xa7a9a2, 7, { rz: Math.PI / 2 }),
        ]),
      );
  }
}

/** Kinds drawn as instanced tiles (built in lines). */
const LINE_KINDS: StructureKind[] = ['wall', 'mines', 'ditch', 'trench', 'wire'];

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
  /** Soft additive glow around lit lamps at night (a cheap stand-in for bloom). */
  private haloMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0xffd8a0,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
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
  private guns: GunMount[] = [];
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
  private lineMeshes = new Map<StructureKind, THREE.InstancedMesh>();
  private wallsDirty = true;
  /** Which enemy mines you've spotted (changes as engineers and dogs find them). */
  private mineSig = -1;
  private frame = 0;
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
      } else if (e.type === 'upgraded') {
        // New look (and maybe a new kind): rebuild its mesh.
        this.remove(e.id);
        const s = this.sim.structureById(e.id);
        if (s) this.add(s);
      }
    }
    if (this.wallsDirty) this.rebuildWalls();
  }

  private add(s: Structure): void {
    if (this.objects.has(s.id)) return;
    if (LINE_KINDS.includes(s.kind)) {
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
    } else if (s.kind === 'gate' || s.kind === 'stairs' || s.kind === 'ramp') {
      mesh.rotation.y = s.rot;
    } else if (s.kind === 'floodlight') {
      mesh.rotation.y = s.rot;
      const lamp = new THREE.Mesh(this.lampGeo, this.lampMaterial);
      lamp.position.set(0, 3.1, 0.16);
      lamp.rotation.x = 0.35;
      mesh.add(lamp);
      const halo = new THREE.Sprite(this.haloMat);
      halo.position.set(0, 3.12, 0.34);
      halo.scale.setScalar(1.15);
      mesh.add(halo);
      lamp.userData.halo = halo;
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
      const halo = new THREE.Sprite(this.haloMat);
      halo.position.z = 0.4;
      halo.scale.setScalar(0.95);
      lens.userData.halo = halo;
      const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
      beam.rotation.x = 0.12;
      beam.renderOrder = 5;
      head.add(housing, lens, beam, lens.userData.halo as THREE.Sprite);
      root.add(head);
      this.searchlights.push({ id: s.id, head, beam, halo: lens.userData.halo as THREE.Sprite });
    } else if (s.kind === 'guntower') {
      const gun = new THREE.Mesh(
        cached('hmg', () =>
          merge([
            box(0.16, 0.16, 0.6, 0, 0, 0.05, 0x2a2a28),
            box(0.05, 0.05, 0.75, 0, 0.02, 0.62, 0x1b1b1a),
            box(0.1, 0.08, 0.1, 0, 0.02, 0.98, 0x1b1b1a),
            box(0.18, 0.14, 0.2, 0.15, -0.04, 0.0, 0x4f5640),
            box(0.36, 0.26, 0.04, 0, 0.12, 0.38, 0x5a6048),
            box(0.05, 0.12, 0.22, 0, -0.04, -0.32, 0x2a2a28),
          ]),
        ),
        this.bodyMat,
      );
      gun.position.set(0, 3.5, 0);
      gun.rotation.y = s.aim;
      gun.castShadow = true;
      root.add(gun);
      this.guns.push({ id: s.id, gun });
    }
    // Upgrade badge: a gold chevron per level above 1.
    for (let k = 1; k < (s.level ?? 1); k++) {
      const chevron = new THREE.Mesh(this.badgeGeo, this.badgeMat);
      chevron.position.set(s.w / 2 - 0.25, Math.max(0.6, structureTop(s.kind)) + 0.15 + k * 0.16, -s.h / 2 + 0.25);
      root.add(chevron);
    }
    this.group.add(root);
    this.objects.set(s.id, root);
  }

  private badgeGeo = new THREE.ConeGeometry(0.16, 0.14, 3).rotateX(Math.PI);
  private badgeMat = new THREE.MeshBasicMaterial({ color: 0xf0c050 });

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
    this.guns = this.guns.filter((g) => g.id !== id);
    this.wallsDirty = true; // cheap to rebuild; covers wall removal
  }

  /** Per-frame: lamps follow power, searchlight beams sweep. `lightsOn` is 0 by day, 1 at night. */
  update(lightsOn: number): void {
    this.updateTraps();
    for (const f of this.floodlights) {
      const powered = this.sim.structureById(f.id)?.powered ?? false;
      if (f.light) f.light.intensity = powered ? 45 * lightsOn : 0;
      f.lamp.material = powered ? this.lampMaterial : this.lampOff;
      const halo = f.lamp.userData.halo as THREE.Sprite | undefined;
      if (halo) halo.visible = powered && lightsOn > 0.02;
    }
    this.haloMat.opacity = 0.55 * lightsOn;
    this.beamMat.opacity = 0.16 * lightsOn;
    for (const sl of this.searchlights) {
      const s = this.sim.structureById(sl.id);
      if (!s) continue;
      sl.head.rotation.y = this.sim.vision.beamAngle(s);
      sl.beam.visible = s.powered && lightsOn > 0.02;
      sl.halo.visible = sl.beam.visible;
    }
    for (const g of this.guns) {
      const s = this.sim.structureById(g.id);
      if (!s) continue;
      // Ease toward the sim's aim so hand-aiming and tracking look smooth.
      let d = s.aim - g.gun.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.gun.rotation.y += d * 0.5;
    }
  }

  /** World position of a gun tower's gun (for cameras). */
  gunPosition(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const g = this.guns.find((m) => m.id === id);
    if (!g) return null;
    return g.gun.getWorldPosition(out);
  }

  /** Viewing side: enemy mines stay hidden until it has spotted them. */
  team = 1;

  private visibleLine(s: Structure): boolean {
    return s.kind !== 'mines' || this.sim.traps.knows(this.team, s);
  }

  private rebuildWalls(): void {
    this.wallsDirty = false;
    const m4 = new THREE.Matrix4();
    for (const kind of LINE_KINDS) {
      const old = this.lineMeshes.get(kind);
      if (old) {
        this.group.remove(old);
        old.dispose();
      }
      const tiles = this.sim.structures.filter((s) => s.kind === kind && this.visibleLine(s));
      if (tiles.length === 0) {
        this.lineMeshes.delete(kind);
        continue;
      }
      const mesh = new THREE.InstancedMesh(bodyGeometry(kind, 0), this.bodyMat, tiles.length);
      tiles.forEach((s, i) => {
        m4.makeTranslation(s.tx + 0.5, footprintBase(this.sim, s.tx, s.tz, 1, 1), s.tz + 0.5);
        mesh.setMatrixAt(i, m4);
      });
      mesh.count = tiles.length;
      mesh.castShadow = kind === 'wall' || kind === 'wire';
      mesh.receiveShadow = true;
      this.lineMeshes.set(kind, mesh);
      this.group.add(mesh);
    }
  }

  /** Per-frame traps: refresh which enemy mines you know about. (Burning trenches: see GameRenderer's particles.) */
  private updateTraps(): void {
    if (++this.frame % 15 === 0) {
      let sig = 0;
      for (const s of this.sim.structures) if (s.kind === 'mines' && this.visibleLine(s)) sig += s.id;
      if (sig !== this.mineSig) {
        this.mineSig = sig;
        this.wallsDirty = true;
      }
    }
    if (this.wallsDirty) this.rebuildWalls();
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
