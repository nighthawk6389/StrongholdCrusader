import * as THREE from 'three';
import type { Sim } from '../sim/sim';
import type { Structure, StructureKind } from '../sim/structures';
import { box, cylinder, merge } from './geometry';
import { COLORS, TEAM_COLORS } from './palette';

export interface Floodlight {
  owner: number;
  light: THREE.SpotLight | null;
}

export interface StructureVisuals {
  group: THREE.Group;
  /** Emissive material for lamp heads (driven by day/night). */
  lampMaterial: THREE.MeshLambertMaterial;
  /** Emissive material for building windows (driven by day/night). */
  windowMaterial: THREE.MeshLambertMaterial;
  floodlights: Floodlight[];
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

/** Main body geometry for a structure kind, centred on its footprint at y=0. */
function bodyGeometry(kind: StructureKind, owner: number): THREE.BufferGeometry {
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
    case 'floodlight':
      return cached('floodlight', () =>
        merge([
          box(0.5, 0.2, 0.5, 0, 0.1, 0, COLORS.concreteDark),
          cylinder(0.05, 0.08, 3.0, 0, 1.6, 0, COLORS.metal, 6),
          box(0.5, 0.32, 0.2, 0, 3.1, 0.05, COLORS.metal),
        ]),
      );
    case 'gate':
      return cached('gate', () => merge([box(1.0, 0.04, 1.0, 0, 0.02, 0, COLORS.asphalt)]));
    case 'wall':
      return cached('wall', () =>
        merge([box(1.0, 1.45, 1.0, 0, 0.725, 0, COLORS.concrete), box(1.04, 0.1, 1.04, 0, 1.5, 0, COLORS.concreteDark)]),
      );
  }
}

/** Lowest ground height under a footprint, so buildings never float. */
function footprintBase(sim: Sim, s: Structure): number {
  let h = Infinity;
  for (let z = s.tz; z <= s.tz + s.h; z++) {
    for (let x = s.tx; x <= s.tx + s.w; x++) h = Math.min(h, sim.map.vertexHeight(x, z));
  }
  return h;
}

export function buildStructures(sim: Sim, maxLights: number): StructureVisuals {
  const group = new THREE.Group();
  group.name = 'structures';
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const lampMaterial = new THREE.MeshLambertMaterial({ color: 0x555555, emissive: COLORS.lamp, emissiveIntensity: 0 });
  const windowMaterial = new THREE.MeshLambertMaterial({
    color: COLORS.windowDark,
    emissive: 0xffb45e,
    emissiveIntensity: 0,
  });
  const floodlights: Floodlight[] = [];

  const walls = sim.structures.filter((s) => s.kind === 'wall');
  const wallMesh = new THREE.InstancedMesh(bodyGeometry('wall', 0), bodyMat, walls.length);
  const m4 = new THREE.Matrix4();
  walls.forEach((s, i) => {
    m4.makeTranslation(s.tx + 0.5, footprintBase(sim, s), s.tz + 0.5);
    wallMesh.setMatrixAt(i, m4);
  });
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  group.add(wallMesh);

  const windowGeo = new THREE.BoxGeometry(1.6, 0.18, 1.82);
  const lampGeo = new THREE.BoxGeometry(0.42, 0.24, 0.04);

  // Player lights get priority for the limited real-light budget.
  const lights = sim.structures
    .filter((s) => s.kind === 'floodlight')
    .sort((a, b) => (a.owner === 1 ? 0 : 1) - (b.owner === 1 ? 0 : 1));
  const lit = new Set(lights.slice(0, maxLights).map((s) => s.id));

  for (const s of sim.structures) {
    if (s.kind === 'wall') continue;
    const cx = s.tx + s.w / 2;
    const cz = s.tz + s.h / 2;
    const base = footprintBase(sim, s);
    const mesh = new THREE.Mesh(bodyGeometry(s.kind, s.owner), bodyMat);
    mesh.position.set(cx, base, cz);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);

    if (s.kind === 'house') {
      const win = new THREE.Mesh(windowGeo, windowMaterial);
      win.position.set(cx, base + 0.75, cz);
      group.add(win);
    } else if (s.kind === 'hq') {
      const win = new THREE.Mesh(new THREE.BoxGeometry(3.86, 0.2, 3.86), windowMaterial);
      win.position.set(cx, base + 0.95, cz);
      group.add(win);
    } else if (s.kind === 'gate') {
      const beam = new THREE.Mesh(
        cached('gatebeam', () => box(0.5, 0.25, 1.0, 0, 0, 0, 0xc9a23a)),
        bodyMat,
      );
      beam.position.set(cx, base + 2.05, cz);
      beam.rotation.y = s.rot - Math.PI / 2;
      group.add(beam);
    } else if (s.kind === 'floodlight') {
      mesh.rotation.y = s.rot;
      const lamp = new THREE.Mesh(lampGeo, lampMaterial);
      lamp.position.set(0, 3.1, 0.16);
      lamp.rotation.x = 0.35;
      mesh.add(lamp);
      let light: THREE.SpotLight | null = null;
      if (lit.has(s.id)) {
        light = new THREE.SpotLight(0xfff0d2, 0, 26, 0.62, 0.55, 1.1);
        light.position.set(cx + Math.sin(s.rot) * 0.2, base + 3.2, cz + Math.cos(s.rot) * 0.2);
        const tx = cx + Math.sin(s.rot) * 8;
        const tz = cz + Math.cos(s.rot) * 8;
        light.target.position.set(tx, sim.map.heightAt(tx, tz), tz);
        group.add(light, light.target);
      }
      floodlights.push({ owner: s.owner, light });
    }
  }

  return { group, lampMaterial, windowMaterial, floodlights };
}
