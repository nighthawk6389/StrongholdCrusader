import type { Sim } from './sim';
import { STRUCTURE_DEFS, maxHp, type StructureKind } from './structures';
import type { FlowField } from './flowfield';

/**
 * Siege planning for computer commanders: where to break into a walled base, the way a person would
 * look at it. Every point on the outer wall is scored by what covers it (towers, gun towers, mortars,
 * the defenders we've seen there), what's in front of it (traps we know about), how solid it is
 * (damage, more walls behind), what happened last time we tried that side, and only then how far it
 * is to walk. Uses only what the attacker can see: buildings, traps it has spotted, units it saw.
 */

export interface BreachPlan {
  /** Wall or gate to open. */
  wall: number;
  /** Standing spot just outside it. */
  ox: number;
  oz: number;
  /** Out of the defenders' reach, straight out from the breach. */
  sx: number;
  sz: number;
  /** Bearing of the breach from the enemy HQ (radians), for memory. */
  angle: number;
  score: number;
}

/** What covers a stretch of wall, and how far. */
const COVER: Partial<Record<StructureKind, { range: number; weight: number }>> = {
  tower: { range: 15, weight: 3 },
  guntower: { range: 21, weight: 7 },
  mortar: { range: 34, weight: 1.5 },
  gate: { range: 9, weight: 1 },
};

const TRAPS = new Set<StructureKind>(['wire', 'ditch', 'trench', 'mines']);
const OPENABLE = new Set<StructureKind>(['wall', 'gate']);

export interface SiegeMemory {
  /** Bearings (from the enemy HQ) where an attack was beaten back, and when. */
  failures: { angle: number; at: number }[];
  /** Coarse grid of where enemy soldiers have been seen lately (cell = `heatCell` tiles). */
  heat: Float32Array;
  heatCell: number;
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** How exposed a point is to the defenders. */
export function exposure(sim: Sim, enemy: number, x: number, z: number, mem: SiegeMemory | null): number {
  let e = 0;
  const night = sim.cycle.daylight < 0.3;
  for (const s of sim.structures) {
    if (s.owner !== enemy) continue;
    const c = COVER[s.kind];
    const lit = night && (s.kind === 'floodlight' || s.kind === 'searchlight') && s.powered;
    if (!c && !lit) continue;
    const d = Math.hypot(s.tx + s.w / 2 - x, s.tz + s.h / 2 - z);
    if (c && d < c.range) {
      let w = c.weight;
      if (s.kind === 'guntower' && !sim.combat.crewed(s)) w *= 0.4;
      e += w * (1 - (0.5 * d) / c.range);
    }
    if (lit && d < 12) e += 1;
  }
  if (mem) {
    const cx = Math.floor(x / mem.heatCell);
    const cz = Math.floor(z / mem.heatCell);
    const n = Math.round(Math.sqrt(mem.heat.length));
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= n || gz >= n) continue;
        e += mem.heat[gz * n + gx] * (dx === 0 && dz === 0 ? 0.6 : 0.25);
      }
    }
  }
  return e;
}

/** Ground field toward `owner`'s home: finite distance = reachable from home without breaking anything. */
export function homeField(sim: Sim, owner: number, hx: number, hz: number): FlowField | null {
  const goal = sim.map.nearestOnLayer(Math.floor(hx), Math.floor(hz), 0, owner, 8);
  if (goal < 0) return null;
  return sim.flow.get({ goal, goalLayer: 0, team: owner, breach: false, climb: false, ground: false });
}

/**
 * Best points to break in, best first, at least `spread` radians apart. Empty if the enemy isn't
 * walled in (there's already a way in) or nothing is reachable.
 */
export function planBreaches(
  sim: Sim,
  owner: number,
  enemy: number,
  home: { x: number; z: number },
  mem: SiegeMemory,
  opts: {
    max: number;
    spread: number;
    noise: number;
    directMargin?: number;
    /** Cost per radian of going round the base (a big army at home makes long marches risky). */
    marchCost?: number;
  },
): BreachPlan[] {
  const map = sim.map;
  const hq = sim.economy.hqOf(enemy);
  if (!hq) return [];
  const field = homeField(sim, owner, home.x, home.z);
  if (!field) return [];
  const dist = field.dist;
  const reach = (tx: number, tz: number): number => (map.inBounds(tx, tz) ? dist[map.idx(tx, tz)] : Infinity);
  const cx = hq.tx + hq.w / 2;
  const cz = hq.tz + hq.h / 2;
  // Already a way in on foot: no breach needed.
  if (Number.isFinite(reach(Math.floor(hq.doorX), Math.floor(hq.doorZ)))) return [];

  const toHome = Math.atan2(home.z - cz, home.x - cx);
  const cands: BreachPlan[] = [];
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const s of sim.structures) {
    if (s.owner !== enemy || !OPENABLE.has(s.kind)) continue;
    const wx = s.tx + s.w / 2;
    const wz = s.tz + s.h / 2;
    for (const [dx, dz] of dirs) {
      // The tile just outside this side of the footprint (middle of the side), and the way in.
      const ox = Math.floor(wx + dx * (s.w / 2 + 0.5));
      const oz = Math.floor(wz + dz * (s.h / 2 + 0.5));
      const toOut = reach(ox, oz);
      if (!Number.isFinite(toOut)) continue;
      // Walk inward past this structure (and any more walls right behind it) to the first open tile.
      let depth = 0;
      let ix = Math.floor(wx - dx * (s.w / 2 + 0.5));
      let iz = Math.floor(wz - dz * (s.h / 2 + 0.5));
      let inside = false;
      for (let k = 0; k < 4 && map.inBounds(ix, iz); k++) {
        const other = sim.structureAt(ix, iz);
        if (other && other.owner === enemy && STRUCTURE_DEFS[other.kind].armored) {
          depth++;
          ix -= dx;
          iz -= dz;
          continue;
        }
        inside = !Number.isFinite(reach(ix, iz));
        break;
      }
      // Only walls that actually keep us out (open ground behind, not reachable from outside).
      if (!inside) continue;
      // More rings further in, between here and the HQ.
      depth += wallsBetween(sim, enemy, ix + 0.5, iz + 0.5, cx, cz, s.id);
      const angle = Math.atan2(oz + 0.5 - cz, ox + 0.5 - cx);
      let score =
        exposure(sim, enemy, ox + 0.5, oz + 0.5, mem) * 3 +
        trapsNear(sim, owner, enemy, ox + 0.5, oz + 0.5, cx, cz) * 1.5 +
        (s.hp / maxHp(s)) * 4 +
        depth * 10 +
        toOut * 0.12 +
        Math.hypot(ix + 0.5 - hq.doorX, iz + 0.5 - hq.doorZ) * 0.1;
      for (const f of mem.failures) if (angleDiff(f.angle, angle) < 0.9) score += 12;
      score += angleDiff(angle, toHome) * (opts.marchCost ?? 4);
      score += (sim.rng.next() - 0.5) * opts.noise;
      const stage = stagingPoint(sim, enemy, ox + 0.5, oz + 0.5, dx, dz, reach);
      cands.push({ wall: s.id, ox: ox + 0.5, oz: oz + 0.5, sx: stage.x, sz: stage.z, angle, score });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  // Only go the long way round when it's clearly better than the wall facing us.
  const direct = cands.find((c) => angleDiff(c.angle, toHome) < 0.8);
  if (direct && cands[0] !== direct && direct.score - cands[0].score < (opts.directMargin ?? 6)) {
    cands.splice(cands.indexOf(direct), 1);
    cands.unshift(direct);
  }
  const out: BreachPlan[] = [];
  for (const c of cands) {
    if (out.length >= opts.max) break;
    if (out.some((o) => angleDiff(o.angle, c.angle) < opts.spread)) continue;
    out.push(c);
  }
  return out;
}

/** Enemy wall pieces crossed on the straight line from (x, z) to the HQ (excluding `skip`). */
function wallsBetween(sim: Sim, enemy: number, x: number, z: number, cx: number, cz: number, skip: number): number {
  const seen = new Set<number>([skip]);
  const len = Math.hypot(cx - x, cz - z);
  const hq = sim.economy.hqOf(enemy);
  let n = 0;
  for (let t = 0; t < len; t += 0.5) {
    const tx = Math.floor(x + ((cx - x) * t) / len);
    const tz = Math.floor(z + ((cz - z) * t) / len);
    const s = sim.structureAt(tx, tz);
    if (!s || s === hq || seen.has(s.id)) continue;
    seen.add(s.id);
    if (s.owner === enemy && OPENABLE.has(s.kind)) n++;
  }
  return n;
}

/** Traps we know about in front of a stretch of wall. */
function trapsNear(sim: Sim, owner: number, enemy: number, x: number, z: number, cx: number, cz: number): number {
  const out = Math.hypot(x - cx, z - cz);
  let n = 0;
  for (const s of sim.structures) {
    if (s.owner !== enemy || !TRAPS.has(s.kind)) continue;
    if (s.kind === 'mines' && !sim.traps.knows(owner, s)) continue;
    const tx = s.tx + 0.5;
    const tz = s.tz + 0.5;
    if (Math.hypot(tx - x, tz - z) < 7 && Math.hypot(tx - cx, tz - cz) > out - 1) n++;
  }
  return Math.min(n, 8);
}

/** Straight out from the breach until nothing covers the spot (or 20 tiles), on reachable ground. */
function stagingPoint(
  sim: Sim,
  enemy: number,
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  reach: (tx: number, tz: number) => number,
): { x: number; z: number } {
  let fallback = { x: ox + dx * 12, z: oz + dz * 12 };
  for (let k = 5; k <= 20; k += 1.5) {
    const x = ox + dx * k;
    const z = oz + dz * k;
    if (!Number.isFinite(reach(Math.floor(x), Math.floor(z)))) continue;
    if (k <= 12) fallback = { x, z };
    if (exposure(sim, enemy, x, z, null) < 0.6) return { x, z };
  }
  return fallback;
}

/**
 * Waypoints for the march: a wide arc round the enemy base (outside its towers' reach) from where
 * the army is to the staging point, rather than straight past the front gate. The last point is the
 * staging point.
 */
export function flankRoute(
  sim: Sim,
  owner: number,
  enemy: number,
  from: { x: number; z: number },
  to: { x: number; z: number },
): { x: number; z: number }[] {
  const hq = sim.economy.hqOf(enemy);
  if (!hq) return [to];
  const map = sim.map;
  const cx = hq.tx + hq.w / 2;
  const cz = hq.tz + hq.h / 2;
  // Outside their walls and out of reach of every tower and gun tower (mortars reach too far to dodge).
  let rim = 0;
  let reach = 0;
  for (const s of sim.structures) {
    if (s.owner !== enemy) continue;
    const d = Math.hypot(s.tx + s.w / 2 - cx, s.tz + s.h / 2 - cz);
    if (d > 45) continue;
    if (STRUCTURE_DEFS[s.kind].armored) rim = Math.max(rim, d);
    const c = COVER[s.kind];
    if (c && s.kind !== 'mortar') reach = Math.max(reach, d + c.range + 2);
  }
  const R = Math.min(48, Math.max(rim + 12, reach, Math.hypot(to.x - cx, to.z - cz)));
  const a0 = Math.atan2(from.z - cz, from.x - cx);
  const a1 = Math.atan2(to.z - cz, to.x - cx);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const out: { x: number; z: number }[] = [];
  const steps = Math.ceil(Math.abs(delta) / 0.6);
  for (let k = 1; k < steps; k++) {
    const a = a0 + (delta * k) / steps;
    const x = Math.min(Math.max(cx + Math.cos(a) * R, 4), map.width - 5);
    const z = Math.min(Math.max(cz + Math.sin(a) * R, 4), map.height - 5);
    const t = map.nearestOnLayer(Math.floor(x), Math.floor(z), 0, owner, 6);
    if (t < 0) continue;
    out.push({ x: (t % map.width) + 0.5, z: Math.floor(t / map.width) + 0.5 });
  }
  out.push(to);
  return out;
}
