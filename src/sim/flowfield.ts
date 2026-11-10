import type { GameMap } from './map';

/** 8 neighbour directions: E, SE, S, SW, W, NW, N, NE (in +x / +z grid space). */
export const DIR_X = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const DIR_Z = [0, 1, 1, 1, 0, -1, -1, -1] as const;
const DIR_COST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2] as const;

export const UNREACHABLE = -2;
export const AT_GOAL = -1;

/**
 * A flow field toward one goal tile: for each tile, the neighbour direction (0..7) that leads
 * downhill on the Dijkstra integration field, AT_GOAL for the goal, UNREACHABLE otherwise.
 */
export class FlowField {
  constructor(
    readonly goal: number,
    readonly mapVersion: number,
    readonly dist: Float32Array,
    readonly dir: Int8Array,
  ) {}
}

/** Binary min-heap keyed by float priority, storing int payloads. */
class MinHeap {
  private keys: Float32Array;
  private vals: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float32Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  push(key: number, val: number): void {
    if (this.size >= this.keys.length) this.grow();
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }

  /** Pops the min; returns its payload. Read `lastKey` for its priority. */
  lastKey = 0;
  pop(): number {
    const topVal = this.vals[0];
    this.lastKey = this.keys[0];
    const key = this.keys[--this.size];
    const val = this.vals[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const c = r < this.size && this.keys[r] < this.keys[l] ? r : l;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = key;
    this.vals[i] = val;
    return topVal;
  }

  private grow(): void {
    const k = new Float32Array(this.keys.length * 2);
    k.set(this.keys);
    const v = new Int32Array(this.vals.length * 2);
    v.set(this.vals);
    this.keys = k;
    this.vals = v;
  }
}

/** Whether a diagonal step from (x,z) in direction d is allowed (no corner cutting). */
function diagonalOk(map: GameMap, x: number, z: number, d: number): boolean {
  if ((d & 1) === 0) return true;
  return map.isWalkableTile(x + DIR_X[d], z) && map.isWalkableTile(x, z + DIR_Z[d]);
}

export function buildFlowField(map: GameMap, goal: number): FlowField {
  const n = map.width * map.height;
  const dist = new Float32Array(n).fill(Infinity);
  const dir = new Int8Array(n).fill(UNREACHABLE);
  const heap = new MinHeap(1024);
  const w = map.width;

  dist[goal] = 0;
  heap.push(0, goal);
  while (heap.size > 0) {
    const cur = heap.pop();
    const d0 = heap.lastKey;
    if (d0 > dist[cur]) continue;
    const cx = cur % w;
    const cz = (cur - cx) / w;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DIR_X[d];
      const nz = cz + DIR_Z[d];
      if (!map.isWalkableTile(nx, nz)) continue;
      if (!diagonalOk(map, cx, cz, d)) continue;
      const ni = nz * w + nx;
      const nd = d0 + DIR_COST[d];
      if (nd < dist[ni]) {
        dist[ni] = nd;
        heap.push(nd, ni);
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (i === goal) {
      dir[i] = AT_GOAL;
      continue;
    }
    if (dist[i] === Infinity) continue;
    const x = i % w;
    const z = (i - x) / w;
    let best = -1;
    let bestD = dist[i];
    for (let d = 0; d < 8; d++) {
      const nx = x + DIR_X[d];
      const nz = z + DIR_Z[d];
      if (!map.isWalkableTile(nx, nz) || !diagonalOk(map, x, z, d)) continue;
      const nd = dist[nz * w + nx];
      if (nd < bestD) {
        bestD = nd;
        best = d;
      }
    }
    if (best >= 0) dir[i] = best;
  }

  return new FlowField(goal, map.version, dist, dir);
}

/** Small LRU cache of flow fields keyed by goal tile; invalidated when the map changes. */
export class FlowFieldCache {
  private fields = new Map<number, FlowField>();
  builds = 0;

  constructor(
    private map: GameMap,
    private capacity = 32,
  ) {}

  get(goal: number): FlowField {
    let f = this.fields.get(goal);
    if (f && f.mapVersion === this.map.version) {
      // Refresh LRU position.
      this.fields.delete(goal);
      this.fields.set(goal, f);
      return f;
    }
    f = buildFlowField(this.map, goal);
    this.builds++;
    this.fields.delete(goal);
    this.fields.set(goal, f);
    if (this.fields.size > this.capacity) {
      const oldest = this.fields.keys().next().value;
      if (oldest !== undefined) this.fields.delete(oldest);
    }
    return f;
  }

  clear(): void {
    this.fields.clear();
  }
}
