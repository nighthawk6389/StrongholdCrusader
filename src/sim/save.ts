import type { Difficulty } from './ai';
import { createScenario, type GameMode, type Scenario } from './scenario';
import type { Sim } from './sim';

/**
 * Save games. The simulation is deterministic and all of its state lives in plain fields of a few
 * objects (Sim, its map, units, economy, combat, vision, drones, waves, AI). A snapshot walks those
 * objects generically; restoring rebuilds the same scenario (same seed, so the same terrain and the
 * same constructor-time setup) and then pours the snapshot back into it, in place, so every class
 * instance keeps its methods. A restored game continues exactly as the original would have.
 */

/** Bump when a change to the sim's state would make older saves restore wrongly (they're then discarded). */
export const SAVE_VERSION = 1;

export interface SimSave {
  v: number;
  mode: GameMode;
  seed: number;
  difficulty: Difficulty;
  /** Encoded simulation state (see `encode`). */
  sim: unknown;
}

/**
 * Fields never saved: back-references to the sim, caches rebuilt on demand, scratch buffers,
 * per-step queues, and AI data that its constructor derives again from the scenario.
 */
const SKIP = new Set([
  'sim',
  'flow',
  'structById',
  'cellHead',
  'cellNext',
  'queue',
  'events',
  'personality',
  'tuning',
  'pieces',
  'reserved',
  // Terrain is regenerated from the seed and never changes during a match.
  'tiles',
  'heights',
  'oases',
]);

// ------------------------------------------------------------------ typed arrays

type Typed =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array;

const TYPED: Record<string, new (buf: ArrayBuffer) => Typed> = {
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
};

/** Bytes → string: runs of zero bytes are collapsed (unit tables are mostly empty), then base64. */
export function packBytes(src: Uint8Array): string {
  const out: number[] = [];
  const varint = (n: number): void => {
    while (n >= 0x80) {
      out.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    out.push(n);
  };
  let i = 0;
  while (i < src.length) {
    // literal run (stops at a run of 4+ zeros), then a zero run
    let j = i;
    while (j < src.length && !(src[j] === 0 && src[j + 1] === 0 && src[j + 2] === 0 && src[j + 3] === 0)) j++;
    if (j >= src.length) j = src.length;
    varint(j - i);
    for (let k = i; k < j; k++) out.push(src[k]);
    let z = j;
    while (z < src.length && src[z] === 0) z++;
    varint(z - j);
    i = z;
  }
  let bin = '';
  const CHUNK = 0x8000;
  for (let k = 0; k < out.length; k += CHUNK) bin += String.fromCharCode(...out.slice(k, k + CHUNK));
  return btoa(bin);
}

export function unpackBytes(s: string, length: number): Uint8Array {
  const bin = atob(s);
  const dst = new Uint8Array(length);
  let p = 0;
  let o = 0;
  const varint = (): number => {
    let n = 0;
    let shift = 0;
    for (;;) {
      const b = bin.charCodeAt(p++);
      n |= (b & 0x7f) << shift;
      if (b < 0x80) return n >>> 0;
      shift += 7;
    }
  };
  while (p < bin.length) {
    const lit = varint();
    for (let k = 0; k < lit; k++) dst[o++] = bin.charCodeAt(p++);
    o += varint(); // zeros: already 0
  }
  return dst;
}

// ------------------------------------------------------------------ encode / restore

/** Turn live objects into JSON-safe data (typed arrays packed, Maps/Sets tagged, Infinity kept). */
export function encode(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? v : { $n: String(v) };
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) {
    const t = v as Typed;
    return { $t: t.constructor.name, n: t.length, d: packBytes(new Uint8Array(t.buffer, t.byteOffset, t.byteLength)) };
  }
  if (v instanceof Map) return { $m: [...v.entries()].map(([k, x]) => [encode(k), encode(x)]) };
  if (v instanceof Set) return { $s: [...v.values()].map(encode) };
  if (Array.isArray(v)) return v.map(encode);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (SKIP.has(k) || typeof x === 'function') continue;
    out[k] = encode(x);
  }
  return out;
}

function isTag(s: unknown, tag: string): s is Record<string, unknown> {
  return !!s && typeof s === 'object' && !Array.isArray(s) && tag in (s as object);
}

/**
 * Pour saved data into `target` in place where possible (keeps class instances, readonly arrays and
 * typed arrays). Returns the value the caller should store.
 */
export function restore(target: unknown, s: unknown): unknown {
  if (s === null || typeof s !== 'object') return s;
  if (isTag(s, '$n')) return Number(s.$n);
  if (isTag(s, '$t')) {
    const Ctor = TYPED[s.$t as string];
    const n = s.n as number;
    const bytes = unpackBytes(s.d as string, n * new Ctor(new ArrayBuffer(0)).BYTES_PER_ELEMENT);
    const fresh = new Ctor(bytes.buffer as ArrayBuffer);
    if (ArrayBuffer.isView(target) && (target as Typed).length === n && target.constructor === Ctor) {
      (target as Typed).set(fresh as never);
      return target;
    }
    return fresh;
  }
  if (isTag(s, '$m')) {
    const entries = s.$m as [unknown, unknown][];
    const map = target instanceof Map ? target : new Map();
    const old = new Map(map);
    map.clear();
    for (const [k, x] of entries) {
      const key = restore(undefined, k);
      map.set(key, restore(old.get(key), x));
    }
    return map;
  }
  if (isTag(s, '$s')) {
    const set = target instanceof Set ? target : new Set();
    set.clear();
    for (const x of s.$s as unknown[]) set.add(restore(undefined, x));
    return set;
  }
  if (Array.isArray(s)) {
    const arr = Array.isArray(target) ? target : [];
    const items = s.map((x, i) => restore(arr[i], x));
    arr.length = 0;
    arr.push(...items);
    return arr;
  }
  const obj = target && typeof target === 'object' ? (target as Record<string, unknown>) : {};
  for (const [k, x] of Object.entries(s as Record<string, unknown>)) obj[k] = restore(obj[k], x);
  return obj;
}

// ------------------------------------------------------------------ whole games

export function saveSim(sim: Sim, mode: GameMode, seed: number, difficulty: Difficulty): SimSave {
  return { v: SAVE_VERSION, mode, seed, difficulty, sim: encode(sim) };
}

/** Rebuild the scenario and restore the saved state into it. Throws on an incompatible save. */
export function loadSim(save: SimSave): Scenario {
  if (save.v !== SAVE_VERSION) throw new Error(`Save version ${save.v} is not supported`);
  const scenario = createScenario(save.mode, save.seed, save.difficulty);
  const sim = scenario.sim;
  const data = save.sim as { economy?: { players?: { $m?: [number, unknown][] } } };
  // Make sure every saved side has a PlayerEconomy instance to restore into.
  for (const [owner] of data.economy?.players?.$m ?? []) sim.economy.player(owner);
  restore(sim, save.sim);
  sim.afterRestore();
  return scenario;
}
