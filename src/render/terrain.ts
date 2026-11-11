import * as THREE from 'three';
import { Tile, type GameMap } from '../sim/map';
import { hash2 } from '../sim/rng';
import { COLORS } from './palette';
import { paint } from './geometry';

function pick(list: readonly number[], h: number): number {
  return list[Math.floor(h * list.length) % list.length];
}

/** Flat-shaded tile terrain: two triangles per tile, coloured per tile for a crisp low-poly look. */
export function buildTerrain(map: GameMap): THREE.Mesh {
  const { width, height } = map;
  const tileCount = width * height;
  const pos = new Float32Array(tileCount * 6 * 3);
  const col = new Float32Array(tileCount * 6 * 3);
  const c = new THREE.Color();
  let p = 0;

  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const h00 = map.vertexHeight(tx, tz);
      const h10 = map.vertexHeight(tx + 1, tz);
      const h01 = map.vertexHeight(tx, tz + 1);
      const h11 = map.vertexHeight(tx + 1, tz + 1);
      const t = map.tileAt(tx, tz);
      const hv = hash2(tx, tz, map.seed);
      let hex: number;
      switch (t) {
        case Tile.Rock:
          hex = pick(COLORS.rock, hv);
          break;
        case Tile.Fertile:
          hex = pick(COLORS.fertile, hv);
          break;
        case Tile.Water:
          hex = COLORS.waterBed;
          break;
        case Tile.Oil:
          hex = pick(COLORS.oil, hv);
          break;
        default:
          hex = pick(COLORS.sand, hv);
      }
      c.setHex(hex);
      if (t !== Tile.Water && t !== Tile.Fertile) c.offsetHSL(map.tint.hue, map.tint.sat, map.tint.light);
      // Subtle height shading so dunes read even under flat light.
      const avgH = (h00 + h10 + h01 + h11) * 0.25;
      if (t === Tile.Sand) c.offsetHSL(0, 0, avgH * 0.018);

      // Triangles (00, 11, 10) and (00, 01, 11) — must match GameMap.heightAt.
      const verts = [
        [tx, h00, tz],
        [tx + 1, h11, tz + 1],
        [tx + 1, h10, tz],
        [tx, h00, tz],
        [tx, h01, tz + 1],
        [tx + 1, h11, tz + 1],
      ];
      for (const v of verts) {
        pos[p] = v[0];
        pos[p + 1] = v[1];
        pos[p + 2] = v[2];
        col[p] = c.r;
        col[p + 1] = c.g;
        col[p + 2] = c.b;
        p += 3;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export function buildWater(map: GameMap): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({
    color: COLORS.water,
    transparent: true,
    opacity: 0.82,
    emissive: 0x0b2a35,
  });
  for (const o of map.oases) {
    const geo = new THREE.CircleGeometry(o.r + 2.2, 28);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(o.x, o.level - 0.18, o.z);
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/** Rocks on rock tiles and sparse scrub on sand. All instanced. (Trees are sim objects: see TreeRenderer.) */
export function buildScatter(map: GameMap): THREE.Group {
  const g = new THREE.Group();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();

  type Item = { x: number; z: number; h: number };
  const rocks: Item[] = [];
  const scrub: Item[] = [];
  for (let tz = 0; tz < map.height; tz++) {
    for (let tx = 0; tx < map.width; tx++) {
      const t = map.tileAt(tx, tz);
      const h = hash2(tx, tz, map.seed + 17);
      if (t === Tile.Rock) rocks.push({ x: tx + 0.5, z: tz + 0.5, h });
      else if (t === Tile.Sand && h > 0.988 && map.isWalkableTile(tx, tz) && map.treeAt[map.idx(tx, tz)] < 0) {
        scrub.push({ x: tx + 0.5, z: tz + 0.5, h });
      }
    }
  }

  const rockGeo = paint(new THREE.IcosahedronGeometry(0.7, 0), 0xffffff);
  const rockMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(COLORS.rockMesh).offsetHSL(map.tint.hue, map.tint.sat, map.tint.light),
    flatShading: true,
  });
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
  rocks.forEach((r, i) => {
    const k = 0.75 + r.h * 0.7;
    e.set(r.h * 3, r.h * 17, r.h * 5);
    q.setFromEuler(e);
    s.set(k * 1.1, k * (0.8 + r.h * 0.9), k * 1.1);
    v.set(r.x + (r.h - 0.5) * 0.3, map.heightAt(r.x, r.z) + 0.25 * k, r.z + (r.h - 0.5) * 0.3);
    m4.compose(v, q, s);
    rockMesh.setMatrixAt(i, m4);
  });
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  g.add(rockMesh);

  const scrubMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.28, 0),
    new THREE.MeshLambertMaterial({ color: 0x7d7a45, flatShading: true }),
    scrub.length,
  );
  scrub.forEach((p, i) => {
    q.identity();
    s.set(1, 0.6, 1);
    v.set(p.x, map.heightAt(p.x, p.z) + 0.08, p.z);
    m4.compose(v, q, s);
    scrubMesh.setMatrixAt(i, m4);
  });
  g.add(scrubMesh);
  return g;
}

/** Palms and acacias driven by the sim tree list; felled trees vanish. */
export class TreeRenderer {
  readonly group = new THREE.Group();
  private meshes: [THREE.InstancedMesh, THREE.InstancedMesh][] = [];
  /** Per tree: instance slot within its kind's meshes. */
  private slot: Int32Array;
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private map: GameMap) {
    const palmTrunk = new THREE.CylinderGeometry(0.06, 0.1, 1.8, 5);
    palmTrunk.translate(0, 0.9, 0);
    const palmCrown = new THREE.ConeGeometry(0.9, 0.45, 7);
    palmCrown.translate(0, 1.85, 0);
    const acTrunk = new THREE.CylinderGeometry(0.07, 0.11, 1.3, 5);
    acTrunk.translate(0, 0.65, 0);
    const acCrown = new THREE.CylinderGeometry(0.95, 0.55, 0.38, 7);
    acCrown.translate(0, 1.42, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: COLORS.palmTrunk });
    const kinds = [
      { trunk: palmTrunk, crown: palmCrown, color: COLORS.palmCrown },
      { trunk: acTrunk, crown: acCrown, color: 0x6f7c38 },
    ];
    const counts = [0, 0];
    for (const t of map.trees) counts[t.kind]++;
    kinds.forEach((k, i) => {
      const trunk = new THREE.InstancedMesh(k.trunk, trunkMat, Math.max(1, counts[i]));
      const crown = new THREE.InstancedMesh(
        k.crown,
        new THREE.MeshLambertMaterial({ color: k.color, flatShading: true }),
        Math.max(1, counts[i]),
      );
      trunk.count = crown.count = counts[i];
      trunk.castShadow = crown.castShadow = true;
      this.meshes.push([trunk, crown]);
      this.group.add(trunk, crown);
    });

    this.slot = new Int32Array(map.trees.length);
    const next = [0, 0];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const v = new THREE.Vector3();
    map.trees.forEach((t, i) => {
      const h = hash2(Math.floor(t.x * 7), Math.floor(t.z * 7), map.seed + 5);
      const k = t.kind === 0 ? 0.8 + h * 0.9 : 0.75 + h * 0.6;
      e.set((h - 0.5) * 0.25, h * 40, (h - 0.5) * 0.2);
      q.setFromEuler(e);
      sc.set(k, k, k);
      v.set(t.x, map.heightAt(t.x, t.z) - 0.05, t.z);
      m4.compose(v, q, sc);
      const s = next[t.kind]++;
      this.slot[i] = s;
      const [trunk, crown] = this.meshes[t.kind];
      trunk.setMatrixAt(s, m4);
      crown.setMatrixAt(s, m4);
      if (t.wood <= 0) {
        trunk.setMatrixAt(s, this.zero);
        crown.setMatrixAt(s, this.zero);
      }
    });
  }

  fell(index: number): void {
    const t = this.map.trees[index];
    if (!t) return;
    const [trunk, crown] = this.meshes[t.kind];
    trunk.setMatrixAt(this.slot[index], this.zero);
    crown.setMatrixAt(this.slot[index], this.zero);
    trunk.instanceMatrix.needsUpdate = true;
    crown.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Additive light pools on the ground, driven by the sim's light grid (floodlights, searchlights,
 * flares, fires). Cheap on phones: one extra draw call instead of dozens of real lights.
 */
export class LightOverlay {
  readonly mesh: THREE.Mesh;
  private colors: Float32Array;
  /** Ground colour per vertex (the overlay brightens the terrain's own colour, not white). */
  private ground: Float32Array;
  /** Corner index (cz * (w + 1) + cx) per vertex, so pools blend smoothly across tiles. */
  private corner: Int32Array;
  private cornerLight: Float32Array;
  private lastVersion = -1;
  private lastNight = -1;

  constructor(
    private map: GameMap,
    terrain: THREE.Mesh,
  ) {
    const src = terrain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pos = new Float32Array(src.array as Float32Array);
    for (let i = 1; i < pos.length; i += 3) pos[i] += 0.04;
    this.ground = new Float32Array((terrain.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array);
    const verts = pos.length / 3;
    this.corner = new Int32Array(verts);
    const cw = map.width + 1;
    for (let v = 0; v < verts; v++) this.corner[v] = Math.round(pos[v * 3 + 2]) * cw + Math.round(pos[v * 3]);
    this.cornerLight = new Float32Array(cw * (map.height + 1));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.colors = new Float32Array(pos.length);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(light: Float32Array, version: number, night: number): void {
    this.mesh.visible = night > 0.03;
    if (!this.mesh.visible) return;
    const n = Math.round(night * 20) / 20;
    if (version === this.lastVersion && n === this.lastNight) return;
    this.lastVersion = version;
    this.lastNight = n;
    const { width: w, height: h } = this.map;
    const cw = w + 1;
    const cl = this.cornerLight;
    // Each corner takes the mean of the (up to four) tiles that touch it.
    for (let cz = 0; cz <= h; cz++) {
      for (let cx = 0; cx <= w; cx++) {
        let sum = 0;
        let cnt = 0;
        for (let dz = -1; dz <= 0; dz++) {
          const tz = cz + dz;
          if (tz < 0 || tz >= h) continue;
          for (let dx = -1; dx <= 0; dx++) {
            const tx = cx + dx;
            if (tx < 0 || tx >= w) continue;
            sum += light[tz * w + tx];
            cnt++;
          }
        }
        cl[cz * cw + cx] = cnt ? sum / cnt : 0;
      }
    }
    const c = this.colors;
    const g = this.ground;
    const corner = this.corner;
    const k = 0.8 * n;
    for (let v = 0, p = 0; v < corner.length; v++, p += 3) {
      const l = cl[corner[v]] * k;
      c[p] = g[p] * l * 1.05 + l * 0.05;
      c[p + 1] = g[p + 1] * l * 0.95 + l * 0.04;
      c[p + 2] = g[p + 2] * l * 0.8 + l * 0.02;
    }
    (this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
