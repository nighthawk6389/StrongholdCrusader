import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Paint every vertex of a geometry with one colour (stored as a `color` attribute). */
export function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

interface Rot {
  rx?: number;
  ry?: number;
  rz?: number;
}

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, hex: number, rot?: Rot): THREE.BufferGeometry {
  if (rot?.rx) g.rotateX(rot.rx);
  if (rot?.rz) g.rotateZ(rot.rz);
  if (rot?.ry) g.rotateY(rot.ry);
  g.translate(x, y, z);
  return paint(g, hex);
}

/** An axis-aligned (optionally rotated) coloured box centred at (x, y, z). */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number, rot?: Rot) {
  return place(new THREE.BoxGeometry(w, h, d), x, y, z, hex, rot);
}

export function cylinder(rt: number, rb: number, h: number, x: number, y: number, z: number, hex: number, seg = 6, rot?: Rot) {
  return place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, hex, rot);
}

export function cone(r: number, h: number, x: number, y: number, z: number, hex: number, seg = 6, rot?: Rot) {
  return place(new THREE.ConeGeometry(r, h, seg), x, y, z, hex, rot);
}

/** Low-poly sphere (indexed, so it can merge with boxes). */
export function sphere(r: number, x: number, y: number, z: number, hex: number, wSeg = 6, hSeg = 4) {
  return place(new THREE.SphereGeometry(r, wSeg, hSeg), x, y, z, hex);
}

/** Merge coloured parts into one geometry (all parts must be indexed BufferGeometries with uv). */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries failed');
  for (const p of parts) p.dispose();
  return g;
}
