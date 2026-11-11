import { Block, type GameMap } from './map';

/** 8 neighbour directions: E, SE, S, SW, W, NW, N, NE (in +x / +z grid space). */
export const DIR_X = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const DIR_Z = [0, 1, 1, 1, 0, -1, -1, -1] as const;
const DIR_COST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2] as const;

/** Direction code: change layer here (only on stairs). */
export const SWITCH_LAYER = 8;
/** Direction codes CLIMB_BASE + d: climb/drop onto the other layer of neighbour d (climbers only). */
export const CLIMB_BASE = 9;
const CLIMB_UP_COST = 2.5;
const CLIMB_DOWN_COST = 1.5;
export const UNREACHABLE = -2;
export const AT_GOAL = -1;

/** Extra cost for routing through an enemy structure in breach mode (≈ "how far would you walk around"). */
const BREACH_COST = 16;

/**
 * A flow field over both navigation layers (ground and deck). Node index = layer * N + tile.
 * `dir[node]` is a neighbour direction 0..7 on the same layer, SWITCH_LAYER, AT_GOAL or UNREACHABLE.
 */
export class FlowField {
  constructor(
    readonly key: number,
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
  lastKey = 0;

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

export interface FieldSpec {
  goal: number;
  goalLayer: number;
  team: number;
  /** Treat enemy structures as passable at a high cost (for attackers that will blow through). */
  breach: boolean;
  /** Can scale walls: step between the ground and any adjacent wall top. */
  climb?: boolean;
  /** Vehicles: ground only (no stairs, no wall tops). */
  ground?: boolean;
}

export function fieldKey(map: GameMap, s: FieldSpec): number {
  const n = map.width * map.height;
  return ((((s.team * 2 + (s.breach ? 1 : 0)) * 2 + (s.climb ? 1 : 0)) * 2 + (s.ground ? 1 : 0)) * 2 + s.goalLayer) * n + s.goal;
}

/** Enemy structure tile that attackers may route through in breach mode. */
export function isBreachable(map: GameMap, i: number, team: number): boolean {
  const b = map.blocked[i];
  return (b === Block.Structure || b === Block.Gate || b === Block.Ditch) && map.structOwner[i] !== team && map.structOwner[i] !== 0;
}

export function buildFlowField(map: GameMap, spec: FieldSpec): FlowField {
  const w = map.width;
  const h = map.height;
  const n = w * h;
  const dist = new Float32Array(2 * n).fill(Infinity);
  const dir = new Int8Array(2 * n).fill(UNREACHABLE);
  const heap = new MinHeap(2048);
  const { team, breach } = spec;
  const stairs = !spec.ground;
  const climb = !!spec.climb;

  // Passability, worked out once: a grid padded with a blocked border (so neighbour lookups need no
  // bounds checks), ground layer then deck layer; plus the extra cost of breaching each tile.
  const pw = w + 2;
  const pn = pw * (h + 2);
  const pass = new Uint8Array(2 * pn);
  const enter = new Float32Array(n);
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      const b = map.blocked[i];
      let ok = b === Block.Free || (b === Block.Gate && map.gateOwner[i] === team);
      if (breach && isBreachable(map, i, team)) {
        enter[i] = BREACH_COST;
        ok = true;
      }
      const pi = (z + 1) * pw + x + 1;
      pass[pi] = ok ? 1 : 0;
      pass[pn + pi] = map.deck[i] === 1 ? 1 : 0;
    }
  }
  const pOff = [0, 0, 0, 0, 0, 0, 0, 0];
  const tOff = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let d = 0; d < 8; d++) {
    pOff[d] = DIR_Z[d] * pw + DIR_X[d];
    tOff[d] = DIR_Z[d] * w + DIR_X[d];
  }

  const start = spec.goalLayer * n + spec.goal;
  dist[start] = 0;
  heap.push(0, start);
  while (heap.size > 0) {
    const cur = heap.pop();
    const d0 = heap.lastKey;
    if (d0 > dist[cur]) continue;
    const layer = cur >= n ? 1 : 0;
    const tile = cur - layer * n;
    const cx = tile % w;
    const cz = (tile - cx) / w;
    const pi = (cz + 1) * pw + cx + 1;
    const lp = layer * pn;
    const ln = layer * n;
    // Walking forward from the neighbour INTO `cur` costs the step plus entering `cur`.
    const entering = layer === 0 ? enter[tile] : 0;
    for (let d = 0; d < 8; d++) {
      if (pass[lp + pi + pOff[d]] !== 1) continue;
      // Diagonals on the ground can't cut a corner (deck chains may run diagonally).
      if ((d & 1) === 1 && layer === 0 && (pass[pi + DIR_X[d]] !== 1 || pass[pi + DIR_Z[d] * pw] !== 1)) continue;
      const ni = ln + tile + tOff[d];
      const nd = d0 + DIR_COST[d] + entering;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        heap.push(nd, ni);
      }
    }
    if (stairs && map.stairs[tile]) {
      const other = (1 - layer) * n + tile;
      const nd = d0 + 1;
      if (nd < dist[other]) {
        dist[other] = nd;
        heap.push(nd, other);
      }
    }
    if (climb) {
      // Neighbour on the other layer steps INTO cur: climbing up if cur is a deck, dropping if not.
      const cost = layer === 1 ? CLIMB_UP_COST : CLIMB_DOWN_COST;
      const op = (1 - layer) * pn;
      const on = (1 - layer) * n;
      for (let d = 0; d < 8; d += 2) {
        if (pass[op + pi + pOff[d]] !== 1) continue;
        const ni = on + tile + tOff[d];
        const nd = d0 + cost;
        if (nd < dist[ni]) {
          dist[ni] = nd;
          heap.push(nd, ni);
        }
      }
    }
  }

  for (let node = 0; node < 2 * n; node++) {
    if (node === start) {
      dir[node] = AT_GOAL;
      continue;
    }
    if (dist[node] === Infinity) continue;
    const layer = node >= n ? 1 : 0;
    const tile = node - layer * n;
    const x = tile % w;
    const z = (tile - x) / w;
    const pi = (z + 1) * pw + x + 1;
    const lp = layer * pn;
    const ln = layer * n;
    let best = -1;
    let bestD = dist[node];
    for (let d = 0; d < 8; d++) {
      if (pass[lp + pi + pOff[d]] !== 1) continue;
      if ((d & 1) === 1 && layer === 0 && (pass[pi + DIR_X[d]] !== 1 || pass[pi + DIR_Z[d] * pw] !== 1)) continue;
      const nd = dist[ln + tile + tOff[d]];
      if (nd < bestD) {
        bestD = nd;
        best = d;
      }
    }
    if (stairs && map.stairs[tile] && dist[(1 - layer) * n + tile] < bestD) {
      bestD = dist[(1 - layer) * n + tile];
      best = SWITCH_LAYER;
    }
    if (climb) {
      const op = (1 - layer) * pn;
      const on = (1 - layer) * n;
      for (let d = 0; d < 8; d += 2) {
        if (pass[op + pi + pOff[d]] !== 1) continue;
        const nd = dist[on + tile + tOff[d]];
        if (nd < bestD) {
          bestD = nd;
          best = CLIMB_BASE + d;
        }
      }
    }
    if (best >= 0) dir[node] = best;
  }

  return new FlowField(fieldKey(map, spec), map.version, dist, dir);
}

/** Small LRU cache of flow fields; invalidated when the map changes. */
export class FlowFieldCache {
  private fields = new Map<number, FlowField>();
  builds = 0;

  constructor(
    private map: GameMap,
    private capacity = 48,
  ) {}

  get(spec: FieldSpec): FlowField {
    const key = fieldKey(this.map, spec);
    let f = this.fields.get(key);
    if (f && f.mapVersion === this.map.version) {
      this.fields.delete(key);
      this.fields.set(key, f);
      return f;
    }
    f = buildFlowField(this.map, spec);
    this.builds++;
    this.fields.delete(key);
    this.fields.set(key, f);
    if (this.fields.size > this.capacity) {
      const oldest = this.fields.keys().next().value;
      if (oldest !== undefined) this.fields.delete(oldest);
    }
    return f;
  }

  /** Decode a field key back to its spec (used by units that store only the key). */
  static decode(map: GameMap, key: number): FieldSpec {
    const n = map.width * map.height;
    const goal = key % n;
    let rest = (key - goal) / n;
    const goalLayer = rest % 2;
    rest = (rest - goalLayer) / 2;
    const ground = rest % 2 === 1;
    rest = (rest - (ground ? 1 : 0)) / 2;
    const climb = rest % 2 === 1;
    rest = (rest - (climb ? 1 : 0)) / 2;
    const breach = rest % 2 === 1;
    const team = (rest - (breach ? 1 : 0)) / 2;
    return { goal, goalLayer, team, breach, climb, ground };
  }

  clear(): void {
    this.fields.clear();
  }
}
