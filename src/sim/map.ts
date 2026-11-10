import { Rng, fbm, hash2 } from './rng';

/** Tile types. Plain object (not a TS enum) so it works under isolatedModules everywhere. */
export const Tile = {
  Sand: 0,
  Rock: 1,
  Fertile: 2,
  Water: 3,
  Oil: 4,
} as const;
export type TileType = (typeof Tile)[keyof typeof Tile];

/** Passability values stored in `GameMap.blocked`. */
export const Block = {
  Free: 0,
  Terrain: 1,
  Structure: 2,
  /** Gatehouse: walkable on the ground only for `gateOwner`'s team. */
  Gate: 3,
} as const;

/** Navigation layers: the ground, and the walkable tops of walls/towers/gatehouses. */
export const Layer = {
  Ground: 0,
  Deck: 1,
} as const;

export interface Oasis {
  x: number;
  z: number;
  r: number;
  /** Ground level of the flattened oasis basin. */
  level: number;
}

/** A tree that lumber workers can fell. Trees are walkable but block construction. */
export interface Tree {
  x: number;
  z: number;
  /** Logs left; the tree disappears at 0. */
  wood: number;
  /** 0 = date palm (oases), 1 = acacia (groves). */
  kind: 0 | 1;
}

export interface Clearing {
  x: number;
  z: number;
  r: number;
}

/**
 * Tile grid. One tile = one world unit (~2 m). Tile (tx, tz) covers [tx, tx+1) × [tz, tz+1).
 * Heights are stored per tile *corner* ((w+1)·(h+1) vertices) for a continuous surface.
 */
export class GameMap {
  readonly tiles: Uint8Array;
  readonly blocked: Uint8Array;
  readonly heights: Float32Array;
  readonly oases: Oasis[] = [];
  readonly trees: Tree[] = [];
  /** Owner of the gatehouse on a tile (0 = none). */
  readonly gateOwner: Uint8Array;
  /** 1 where the tile has a walkable top (wall, tower, gatehouse, stairs). */
  readonly deck: Uint8Array;
  /** Height of the walkable top above the ground. */
  readonly deckH: Float32Array;
  /** 1 on stairs: the only tiles where units switch between ground and deck. */
  readonly stairs: Uint8Array;
  /** Structure id covering each tile (0 = none). */
  readonly structAt: Int32Array;
  /** Owner of the structure covering each tile (0 = none). */
  readonly structOwner: Uint8Array;
  /** Tree index per tile, -1 if none. */
  readonly treeAt: Int32Array;
  /** Incremented whenever passability changes (flow-field caches key off this). */
  version = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly seed: number,
  ) {
    this.tiles = new Uint8Array(width * height);
    this.blocked = new Uint8Array(width * height);
    this.heights = new Float32Array((width + 1) * (height + 1));
    this.treeAt = new Int32Array(width * height).fill(-1);
    const n = width * height;
    this.gateOwner = new Uint8Array(n);
    this.deck = new Uint8Array(n);
    this.deckH = new Float32Array(n);
    this.stairs = new Uint8Array(n);
    this.structAt = new Int32Array(n);
    this.structOwner = new Uint8Array(n);
  }

  /** Walkability for a unit of `team` on `layer`. */
  walkable(tx: number, tz: number, layer: number, team: number): boolean {
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return false;
    const i = tz * this.width + tx;
    if (layer === 1) return this.deck[i] === 1;
    const b = this.blocked[i];
    return b === Block.Free || (b === Block.Gate && this.gateOwner[i] === team);
  }

  walkableAt(x: number, z: number, layer: number, team: number): boolean {
    return this.walkable(Math.floor(x), Math.floor(z), layer, team);
  }

  /** Does this tile stop bullets fired at ground level? (Rocks and structures; gates count as closed.) */
  blocksGroundFire(tx: number, tz: number): boolean {
    if (!this.inBounds(tx, tz)) return true;
    const b = this.blocked[tz * this.width + tx];
    return b === Block.Terrain || b === Block.Structure || b === Block.Gate;
  }

  /** Nearest tile walkable on `layer` for `team`, or -1. */
  nearestOnLayer(tx: number, tz: number, layer: number, team: number, maxR = 12): number {
    if (this.walkable(tx, tz, layer, team)) return this.idx(tx, tz);
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.walkable(tx + dx, tz + dz, layer, team)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = this.idx(tx + dx, tz + dz);
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Straight-line walkability on a layer (sampled). Deck movement ignores unit radius. */
  segmentClearOn(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    radius: number,
    layer: number,
    team: number,
  ): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return this.walkableAt(x0, z0, layer, team);
    const r = layer === 1 ? 0 : radius;
    const nx = (-dz / len) * r;
    const nz = (dx / len) * r;
    const steps = Math.ceil(len / 0.3);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      if (!this.walkableAt(px, pz, layer, team)) return false;
      if (r > 0 && (!this.walkableAt(px + nx, pz + nz, layer, team) || !this.walkableAt(px - nx, pz - nz, layer, team))) {
        return false;
      }
    }
    return true;
  }

  addTree(tx: number, tz: number, kind: 0 | 1, wood: number, jitter: number): void {
    const i = this.idx(tx, tz);
    if (this.treeAt[i] >= 0) return;
    this.treeAt[i] = this.trees.length;
    this.trees.push({ x: tx + 0.5 + (jitter - 0.5) * 0.4, z: tz + 0.5 + (jitter * 7.3 - Math.floor(jitter * 7.3) - 0.5) * 0.4, wood, kind });
  }

  /** Remove a depleted tree from its tile (the record stays so indices remain stable). */
  clearTree(index: number): void {
    const t = this.trees[index];
    if (!t) return;
    t.wood = 0;
    const i = this.idx(Math.floor(t.x), Math.floor(t.z));
    if (this.treeAt[i] === index) this.treeAt[i] = -1;
  }

  idx(tx: number, tz: number): number {
    return tz * this.width + tx;
  }

  inBounds(tx: number, tz: number): boolean {
    return tx >= 0 && tz >= 0 && tx < this.width && tz < this.height;
  }

  isWalkableTile(tx: number, tz: number): boolean {
    return this.inBounds(tx, tz) && this.blocked[tz * this.width + tx] === Block.Free;
  }

  isWalkable(x: number, z: number): boolean {
    return this.isWalkableTile(Math.floor(x), Math.floor(z));
  }

  tileAt(tx: number, tz: number): TileType {
    return this.tiles[tz * this.width + tx] as TileType;
  }

  setBlocked(tx: number, tz: number, value: number): void {
    const i = this.idx(tx, tz);
    if (this.blocked[i] !== value) {
      this.blocked[i] = value;
      this.version++;
    }
  }

  vertexHeight(vx: number, vz: number): number {
    const cx = Math.min(Math.max(vx, 0), this.width);
    const cz = Math.min(Math.max(vz, 0), this.height);
    return this.heights[cz * (this.width + 1) + cx];
  }

  /** Bilinear ground height at a world position. */
  heightAt(x: number, z: number): number {
    const cx = Math.min(Math.max(x, 0), this.width - 1e-4);
    const cz = Math.min(Math.max(z, 0), this.height - 1e-4);
    const x0 = Math.floor(cx);
    const z0 = Math.floor(cz);
    const fx = cx - x0;
    const fz = cz - z0;
    const w1 = this.width + 1;
    const h00 = this.heights[z0 * w1 + x0];
    const h10 = this.heights[z0 * w1 + x0 + 1];
    const h01 = this.heights[(z0 + 1) * w1 + x0];
    const h11 = this.heights[(z0 + 1) * w1 + x0 + 1];
    // Match the triangle split used by the terrain mesh (diagonal from (0,0) to (1,1)).
    if (fx >= fz) {
      return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    }
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  /** Nearest walkable tile index to (tx, tz) within `maxR` rings, or -1. */
  nearestWalkable(tx: number, tz: number, maxR = 12): number {
    if (this.isWalkableTile(tx, tz)) return this.idx(tx, tz);
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = tx + dx;
          const nz = tz + dz;
          if (!this.isWalkableTile(nx, nz)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = this.idx(nx, nz);
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * True if a unit of the given radius can walk the straight segment (x0,z0)→(x1,z1)
   * without touching a blocked tile. Sampled, which is plenty for steering decisions.
   */
  segmentClear(x0: number, z0: number, x1: number, z1: number, radius: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return this.isWalkable(x0, z0);
    const nx = -dz / len;
    const nz = dx / len;
    const steps = Math.ceil(len / 0.3);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      if (
        !this.isWalkable(px, pz) ||
        !this.isWalkable(px + nx * radius, pz + nz * radius) ||
        !this.isWalkable(px - nx * radius, pz - nz * radius)
      ) {
        return false;
      }
    }
    return true;
  }
}

export interface DesertMapSpec {
  width: number;
  height: number;
  seed: number;
  /** Areas kept flat and rock-free (bases). */
  clearings: Clearing[];
  /** Guaranteed oases; more are added procedurally. */
  oases: { x: number; z: number; r: number }[];
  extraOases?: number;
  oilPatches?: number;
  /** Guaranteed acacia groves (timber sources). */
  groves?: { x: number; z: number; r: number }[];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Procedurally generate a desert map with dunes, rock ridges, oases and oil. Deterministic per seed. */
export function generateDesertMap(spec: DesertMapSpec): GameMap {
  const { width, height, seed } = spec;
  const map = new GameMap(width, height, seed);
  const rng = new Rng(seed ^ 0x9e3779b9);
  const w1 = width + 1;

  // 1. Dune heights at vertices.
  for (let vz = 0; vz <= height; vz++) {
    for (let vx = 0; vx <= width; vx++) {
      const big = (fbm(vx * 0.03, vz * 0.03, seed, 4) - 0.5) * 3.4;
      const small = (fbm(vx * 0.11, vz * 0.11, seed + 7, 3) - 0.5) * 0.6;
      map.heights[vz * w1 + vx] = big + small;
    }
  }

  // 2. Pick oases (guaranteed + extra, away from clearings and each other).
  const oasisSeeds = spec.oases.map((o) => ({ ...o }));
  const extra = spec.extraOases ?? 2;
  for (let tries = 0, added = 0; added < extra && tries < 200; tries++) {
    const x = rng.range(12, width - 12);
    const z = rng.range(12, height - 12);
    const r = rng.range(2.5, 4.5);
    const nearClearing = spec.clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r + 10);
    const nearOasis = oasisSeeds.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 14);
    if (nearClearing || nearOasis) continue;
    oasisSeeds.push({ x, z, r });
    added++;
  }

  // 3. Flatten clearings and oasis basins (vertex heights).
  const flatten = (cx: number, cz: number, inner: number, outer: number): number => {
    const level = map.vertexHeight(Math.round(cx), Math.round(cz));
    for (let vz = 0; vz <= height; vz++) {
      for (let vx = 0; vx <= width; vx++) {
        const d = Math.hypot(vx - cx, vz - cz);
        if (d > outer) continue;
        const k = 1 - smoothstep(inner, outer, d);
        const i = vz * w1 + vx;
        map.heights[i] = map.heights[i] * (1 - k) + level * k;
      }
    }
    return level;
  };
  for (const c of spec.clearings) flatten(c.x, c.z, c.r + 1, c.r + 7);
  for (const o of oasisSeeds) {
    const level = flatten(o.x, o.z, o.r + 4, o.r + 9);
    map.oases.push({ x: o.x, z: o.z, r: o.r, level });
  }

  // 4. Classify tiles.
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const cx = tx + 0.5;
      const cz = tz + 0.5;
      const i = tz * width + tx;
      let type: TileType = Tile.Sand;

      for (const o of map.oases) {
        const n = (fbm(cx * 0.3, cz * 0.3, seed + 11, 2) - 0.5) * 2.2;
        const d = Math.hypot(cx - o.x, cz - o.z) + n;
        if (d < o.r) {
          type = Tile.Water;
          break;
        }
        if (d < o.r + 4.5) type = Tile.Fertile;
      }

      if (type === Tile.Sand) {
        const inClearing = spec.clearings.some((c) => Math.hypot(cx - c.x, cz - c.z) < c.r + 3);
        if (!inClearing) {
          const ridge = fbm(cx * 0.06, cz * 0.06, seed + 31, 4);
          if (ridge > 0.64 || hash2(tx, tz, seed + 99) < 0.006) type = Tile.Rock;
        }
      }
      map.tiles[i] = type;
    }
  }

  // 5. Oil patches on open sand.
  const oil = spec.oilPatches ?? 3;
  for (let tries = 0, added = 0; added < oil && tries < 300; tries++) {
    const x = rng.range(8, width - 8);
    const z = rng.range(8, height - 8);
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (map.tiles[tz * width + tx] !== Tile.Sand) continue;
    if (spec.clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 4)) continue;
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = tx + dx;
        const nz = tz + dz;
        if (!map.inBounds(nx, nz)) continue;
        const d = Math.hypot(dx, dz) + hash2(nx, nz, seed + 5) * 1.2;
        if (d < 2.6 && map.tiles[nz * width + nx] === Tile.Sand) map.tiles[nz * width + nx] = Tile.Oil;
      }
    }
    added++;
  }

  // 6. Sink water tiles' corners below the oasis water line; raise rock slightly.
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const t = map.tiles[tz * width + tx];
      if (t === Tile.Water) {
        const o = map.oases.reduce((best, cur) =>
          Math.hypot(cur.x - tx, cur.z - tz) < Math.hypot(best.x - tx, best.z - tz) ? cur : best,
        );
        for (const [vx, vz] of [
          [tx, tz],
          [tx + 1, tz],
          [tx, tz + 1],
          [tx + 1, tz + 1],
        ]) {
          const vi = vz * w1 + vx;
          map.heights[vi] = Math.min(map.heights[vi], o.level - 0.7);
        }
      }
    }
  }

  // 7. Passability.
  for (let i = 0; i < width * height; i++) {
    const t = map.tiles[i];
    map.blocked[i] = t === Tile.Rock || t === Tile.Water ? Block.Terrain : Block.Free;
  }

  // 8. Trees: palms on fertile ground, acacia groves on sand.
  const inClearing = (x: number, z: number, pad: number): boolean =>
    spec.clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + pad);
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (map.blocked[i] !== Block.Free) continue;
      const t = map.tiles[i];
      const h = hash2(tx, tz, seed + 17);
      const cx = tx + 0.5;
      const cz = tz + 0.5;
      if (t === Tile.Fertile) {
        if (h < 0.16) map.addTree(tx, tz, 0, 3, h * 6.1);
        continue;
      }
      if (t !== Tile.Sand || inClearing(cx, cz, 2)) continue;
      const grove = (spec.groves ?? []).some(
        (g) => Math.hypot(g.x - cx, g.z - cz) + (fbm(cx * 0.4, cz * 0.4, seed + 3, 2) - 0.5) * 2 < g.r,
      );
      const wild = fbm(cx * 0.07, cz * 0.07, seed + 77, 3) > 0.69;
      if ((grove && h < 0.5) || (wild && h < 0.22)) map.addTree(tx, tz, 1, 2, h * 2.3);
    }
  }

  map.version++;
  return map;
}
