import { CYCLE_SEC, TICK_SEC, cycleInfo, phaseStartSec, type CycleInfo, type PhaseName } from './clock';
import { AT_GOAL, DIR_X, DIR_Z, FlowFieldCache } from './flowfield';
import { Block, type GameMap } from './map';
import { Economy } from './economy';
import { Rng } from './rng';
import { STRUCTURE_DEFS, type ResId, type Structure, type StructureKind } from './structures';
import { UNIT_TYPES } from './unitTypes';
import { Order, UnitStore } from './units';

export type Command =
  | { type: 'move'; owner: number; ids: number[]; x: number; z: number }
  | { type: 'stop'; owner: number; ids: number[] }
  | {
      type: 'control';
      owner: number;
      id: number;
      /** World-space move intent, magnitude 0..1. */
      mx: number;
      mz: number;
      /** Aim yaw in radians (forward = (sin yaw, cos yaw)). */
      yaw: number;
      fire: boolean;
      aim: boolean;
    }
  | { type: 'release'; owner: number; id: number }
  | { type: 'build'; owner: number; kind: StructureKind; tx: number; tz: number }
  | { type: 'demolish'; owner: number; id: number }
  | { type: 'setActive'; owner: number; id: number; active: boolean }
  | { type: 'setRations'; owner: number; level: number }
  | { type: 'setTax'; owner: number; level: number };

export type SimEvent =
  | { type: 'shot'; unit: number; owner: number; fromX: number; fromZ: number; toX: number; toZ: number; hit: boolean }
  | { type: 'death'; unit: number; owner: number; x: number; z: number }
  | { type: 'structureAdded'; id: number }
  | { type: 'structureRemoved'; id: number }
  | { type: 'buildFailed'; owner: number; reason: string }
  | { type: 'treeFelled'; index: number }
  | { type: 'delivered'; owner: number; res: ResId; amount: number; x: number; z: number }
  | { type: 'arrived'; owner: number; unit: number }
  | { type: 'departed'; owner: number; x: number; z: number };

export interface SimInit {
  map: GameMap;
  seed: number;
  /** Seconds into the day/night cycle at tick 0. */
  startSec: number;
}

const ENGAGE_INTERVAL = 4; // ticks between target scans per unit
const FORMATION_SPACING = 0.78;

/**
 * The authoritative game simulation. Pure TypeScript, no DOM or rendering.
 * Advanced in fixed ticks via `step()`; all external changes arrive as `Command`s.
 */
export class Sim {
  readonly map: GameMap;
  readonly units = new UnitStore();
  readonly structures: Structure[] = [];
  readonly flow: FlowFieldCache;
  readonly rng: Rng;
  readonly economy: Economy;
  tick = 0;
  startSec: number;

  private queue: Command[] = [];
  private events: SimEvent[] = [];
  private nextStructureId = 1;
  private readonly structById = new Map<number, Structure>();
  private readonly cellHead: Int32Array;
  private readonly cellNext: Int32Array;

  constructor(init: SimInit) {
    this.map = init.map;
    this.rng = new Rng(init.seed);
    this.startSec = init.startSec;
    this.flow = new FlowFieldCache(this.map, 64);
    this.economy = new Economy(this);
    this.cellHead = new Int32Array(this.map.width * this.map.height).fill(-1);
    this.cellNext = new Int32Array(this.units.alive.length).fill(-1);
  }

  get timeSec(): number {
    return this.startSec + this.tick * TICK_SEC;
  }

  get cycle(): CycleInfo {
    return cycleInfo(this.timeSec);
  }

  enqueue(cmd: Command): void {
    this.queue.push(cmd);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  /** Returns and clears events produced since the last call. */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Dev helper: jump the day/night clock to the start of a phase (does not advance the sim). */
  skipToPhase(phase: PhaseName): void {
    const now = this.timeSec;
    const cycleStart = now - (now % CYCLE_SEC);
    let target = cycleStart + phaseStartSec(phase);
    if (target <= now) target += CYCLE_SEC;
    this.startSec += target - now;
  }

  /** Place a structure without validation or cost (scenario setup, or after Economy.build checks). */
  placeStructure(kind: StructureKind, owner: number, tx: number, tz: number, rot = 0): Structure | null {
    const def = STRUCTURE_DEFS[kind];
    for (let z = tz; z < tz + def.h; z++) {
      for (let x = tx; x < tx + def.w; x++) {
        if (!this.map.isWalkableTile(x, z)) return null;
      }
    }
    const s: Structure = {
      id: this.nextStructureId++,
      kind,
      owner,
      tx,
      tz,
      w: def.w,
      h: def.h,
      hp: def.hp,
      rot,
      doorX: tx + def.w / 2,
      doorZ: tz + def.h + 0.5,
      workers: [],
      active: true,
      status: def.jobs ? 'noWorker' : 'ok',
    };
    if (def.blocks) {
      for (let z = tz; z < tz + def.h; z++) {
        for (let x = tx; x < tx + def.w; x++) this.map.setBlocked(x, z, Block.Structure);
      }
    }
    const door = this.economy.findDoor(tx, tz, def.w, def.h, owner);
    if (door) {
      s.doorX = door.x;
      s.doorZ = door.z;
    }
    this.structures.push(s);
    this.structById.set(s.id, s);
    this.emit({ type: 'structureAdded', id: s.id });
    return s;
  }

  removeStructure(s: Structure): void {
    const def = STRUCTURE_DEFS[s.kind];
    if (def.blocks) {
      for (let z = s.tz; z < s.tz + s.h; z++) {
        for (let x = s.tx; x < s.tx + s.w; x++) this.map.setBlocked(x, z, Block.Free);
      }
    }
    const i = this.structures.indexOf(s);
    if (i >= 0) this.structures.splice(i, 1);
    this.structById.delete(s.id);
    this.emit({ type: 'structureRemoved', id: s.id });
  }

  structureById(id: number): Structure | undefined {
    return this.structById.get(id);
  }

  /** Structure covering tile (tx, tz), if any. */
  structureAt(tx: number, tz: number): Structure | undefined {
    for (const s of this.structures) {
      if (tx >= s.tx && tz >= s.tz && tx < s.tx + s.w && tz < s.tz + s.h) return s;
    }
    return undefined;
  }

  /** Send one unit to a point (no formation). */
  goTo(i: number, x: number, z: number): void {
    const map = this.map;
    const u = this.units;
    const goalTile = map.nearestWalkable(Math.floor(x), Math.floor(z), 6);
    if (goalTile < 0) {
      u.order[i] = Order.Idle;
      return;
    }
    const walk = map.isWalkable(x, z);
    u.goalX[i] = walk ? x : (goalTile % map.width) + 0.5;
    u.goalZ[i] = walk ? z : Math.floor(goalTile / map.width) + 0.5;
    u.field[i] = goalTile;
    u.order[i] = Order.Move;
    u.stuck[i] = 0;
  }

  spawnUnit(kind: number, owner: number, x: number, z: number, heading = 0): number {
    return this.units.spawn(kind, owner, x, z, heading);
  }

  step(): void {
    const cmds = this.queue;
    this.queue = [];
    for (const c of cmds) this.apply(c);

    const u = this.units;
    for (let i = 0; i < u.count; i++) {
      u.px[i] = u.x[i];
      u.pz[i] = u.z[i];
      u.pheading[i] = u.heading[i];
    }

    this.updateMovement();
    this.resolveOverlaps();
    this.updateCombat();
    this.economy.update();
    this.tick++;
  }

  // ---------------------------------------------------------------- commands

  private apply(c: Command): void {
    const u = this.units;
    switch (c.type) {
      case 'move':
        this.issueMove(
          c.ids.filter((id) => u.isAlive(id) && u.owner[id] === c.owner && UNIT_TYPES[u.kind[id]].selectable),
          c.x,
          c.z,
        );
        break;
      case 'build': {
        const check = this.economy.canPlace(c.owner, c.kind, c.tx, c.tz);
        if (!check.ok) this.emit({ type: 'buildFailed', owner: c.owner, reason: check.reason ?? 'Cannot build' });
        else this.economy.build(c.owner, c.kind, c.tx, c.tz);
        break;
      }
      case 'demolish':
        this.economy.demolish(c.owner, c.id);
        break;
      case 'setActive':
        this.economy.setActive(c.owner, c.id, c.active);
        break;
      case 'setRations':
        this.economy.player(c.owner).rationLevel = Math.max(0, Math.min(4, Math.round(c.level)));
        break;
      case 'setTax':
        this.economy.player(c.owner).taxLevel = Math.max(0, Math.min(5, Math.round(c.level)));
        break;
      case 'stop':
        for (const id of c.ids) {
          if (!u.isAlive(id) || u.owner[id] !== c.owner) continue;
          if (u.order[id] === Order.Move) u.order[id] = Order.Idle;
        }
        break;
      case 'control': {
        const id = c.id;
        if (!u.isAlive(id) || u.owner[id] !== c.owner) return;
        if (!UNIT_TYPES[u.kind[id]].controllable) return;
        u.order[id] = Order.Control;
        const len = Math.hypot(c.mx, c.mz);
        const k = len > 1 ? 1 / len : 1;
        const t = UNIT_TYPES[u.kind[id]];
        const speed = t.speed * (c.aim ? 0.5 : 1);
        u.vx[id] = c.mx * k * speed;
        u.vz[id] = c.mz * k * speed;
        u.heading[id] = wrapAngle(c.yaw);
        if (c.fire && u.cooldown[id] === 0) {
          const spread = c.aim ? 0.008 : 0.045;
          this.fire(id, c.yaw + (this.rng.next() - 0.5) * spread, t.range, t.damage, 1);
          u.cooldown[id] = t.cooldown;
        }
        break;
      }
      case 'release':
        if (u.isAlive(c.id) && u.owner[c.id] === c.owner && u.order[c.id] === Order.Control) {
          u.order[c.id] = Order.Idle;
          u.vx[c.id] = u.vz[c.id] = 0;
        }
        break;
    }
  }

  private issueMove(ids: number[], tx: number, tz: number): void {
    if (ids.length === 0) return;
    const map = this.map;
    const u = this.units;
    const goalTile = map.nearestWalkable(Math.floor(tx), Math.floor(tz));
    if (goalTile < 0) return;
    const gx = (goalTile % map.width) + 0.5;
    const gz = Math.floor(goalTile / map.width) + 0.5;
    const cx = map.isWalkable(tx, tz) ? tx : gx;
    const cz = map.isWalkable(tx, tz) ? tz : gz;

    // Formation facing: from the group's centroid toward the target.
    let mx = 0;
    let mz = 0;
    for (const id of ids) {
      mx += u.x[id];
      mz += u.z[id];
    }
    mx /= ids.length;
    mz /= ids.length;
    let fx = cx - mx;
    let fz = cz - mz;
    const fl = Math.hypot(fx, fz);
    if (fl < 1e-3) {
      fx = 0;
      fz = 1;
    } else {
      fx /= fl;
      fz /= fl;
    }
    const rx = -fz;
    const rz = fx;

    const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length * 1.6)));
    const rows = Math.ceil(ids.length / cols);

    // Front-most units take the front row; within a row, sort left→right to avoid crossing paths.
    const sorted = ids
      .map((id) => ({ id, f: (u.x[id] - mx) * fx + (u.z[id] - mz) * fz, r: (u.x[id] - mx) * rx + (u.z[id] - mz) * rz }))
      .sort((a, b) => b.f - a.f || a.id - b.id);

    for (let row = 0; row < rows; row++) {
      const slice = sorted.slice(row * cols, row * cols + cols).sort((a, b) => a.r - b.r || a.id - b.id);
      const inRow = slice.length;
      for (let col = 0; col < inRow; col++) {
        const id = slice[col].id;
        const offR = (col - (inRow - 1) / 2) * FORMATION_SPACING;
        const offF = -(row - (rows - 1) / 2) * FORMATION_SPACING;
        let sx = cx + rx * offR + fx * offF;
        let sz = cz + rz * offR + fz * offF;
        if (!map.isWalkable(sx, sz)) {
          const t = map.nearestWalkable(Math.floor(sx), Math.floor(sz), 6);
          if (t >= 0) {
            sx = (t % map.width) + 0.5;
            sz = Math.floor(t / map.width) + 0.5;
          } else {
            sx = gx;
            sz = gz;
          }
        }
        u.goalX[id] = sx;
        u.goalZ[id] = sz;
        u.field[id] = goalTile;
        u.order[id] = Order.Move;
        u.stuck[id] = 0;
        u.target[id] = -1;
      }
    }
  }

  // ---------------------------------------------------------------- movement

  private updateMovement(): void {
    const u = this.units;
    const map = this.map;
    const dt = TICK_SEC;

    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      const type = UNIT_TYPES[u.kind[i]];
      const order = u.order[i];

      if (order === Order.Control) {
        this.moveWithCollision(i, u.vx[i] * dt, u.vz[i] * dt, type.radius);
        if (u.cooldown[i] > 0) u.cooldown[i]--;
        continue;
      }

      if (order !== Order.Move) {
        u.vx[i] = u.vz[i] = 0;
        continue;
      }

      const x = u.x[i];
      const z = u.z[i];
      const dx = u.goalX[i] - x;
      const dz = u.goalZ[i] - z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.1) {
        u.order[i] = Order.Idle;
        u.vx[i] = u.vz[i] = 0;
        continue;
      }

      let dirX = 0;
      let dirZ = 0;
      if (dist < 10 && map.segmentClear(x, z, u.goalX[i], u.goalZ[i], type.radius * 0.9)) {
        dirX = dx / dist;
        dirZ = dz / dist;
      } else {
        const field = this.flow.get(u.field[i]);
        const tx = Math.floor(x);
        const tz = Math.floor(z);
        const d = map.inBounds(tx, tz) ? field.dir[map.idx(tx, tz)] : -2;
        if (d >= 0) {
          const nx = tx + DIR_X[d] + 0.5 - x;
          const nz = tz + DIR_Z[d] + 0.5 - z;
          const nl = Math.hypot(nx, nz) || 1;
          dirX = nx / nl;
          dirZ = nz / nl;
        } else if (d === AT_GOAL) {
          dirX = dx / dist;
          dirZ = dz / dist;
        } else {
          // Unreachable from here (cut off). Give up.
          u.order[i] = Order.Idle;
          u.vx[i] = u.vz[i] = 0;
          continue;
        }
      }

      const speed = type.speed * Math.min(1, 0.3 + dist / 1.0);
      // Light smoothing keeps turns readable without hurting responsiveness.
      u.vx[i] = u.vx[i] * 0.35 + dirX * speed * 0.65;
      u.vz[i] = u.vz[i] * 0.35 + dirZ * speed * 0.65;

      const moved = this.moveWithCollision(i, u.vx[i] * dt, u.vz[i] * dt, type.radius);
      const want = speed * dt;
      if (moved < want * 0.25 && dist < 2.5) {
        u.stuck[i] += dt;
        if (u.stuck[i] > 0.6) {
          u.order[i] = Order.Idle;
          u.vx[i] = u.vz[i] = 0;
        }
      } else {
        u.stuck[i] = Math.max(0, u.stuck[i] - dt);
      }

      if (Math.abs(u.vx[i]) + Math.abs(u.vz[i]) > 0.05) {
        u.heading[i] = turnToward(u.heading[i], Math.atan2(u.vx[i], u.vz[i]), 10 * dt);
      }
    }
  }

  /** Move with per-axis sliding against blocked tiles. Returns distance actually moved. */
  private moveWithCollision(i: number, dx: number, dz: number, r: number): number {
    const u = this.units;
    const map = this.map;
    const x = u.x[i];
    const z = u.z[i];
    let nx = x + dx;
    if (dx !== 0) {
      const ex = nx + Math.sign(dx) * r;
      if (!map.isWalkable(ex, z - r * 0.7) || !map.isWalkable(ex, z + r * 0.7)) nx = x;
    }
    let nz = z + dz;
    if (dz !== 0) {
      const ez = nz + Math.sign(dz) * r;
      if (!map.isWalkable(nx - r * 0.7, ez) || !map.isWalkable(nx + r * 0.7, ez)) nz = z;
    }
    nx = Math.min(Math.max(nx, r), map.width - r);
    nz = Math.min(Math.max(nz, r), map.height - r);
    u.x[i] = nx;
    u.z[i] = nz;
    return Math.hypot(nx - x, nz - z);
  }

  private rebuildSpatialHash(): void {
    const u = this.units;
    const w = this.map.width;
    this.cellHead.fill(-1);
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      const c = Math.floor(u.z[i]) * w + Math.floor(u.x[i]);
      this.cellNext[i] = this.cellHead[c];
      this.cellHead[c] = i;
    }
  }

  /** Positional separation so units don't stack. Moving units shoulder idle ones aside. */
  private resolveOverlaps(): void {
    const u = this.units;
    const map = this.map;
    const w = map.width;
    this.rebuildSpatialHash();

    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      const ri = UNIT_TYPES[u.kind[i]].radius;
      const cx = Math.floor(u.x[i]);
      const cz = Math.floor(u.z[i]);
      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gz = cz + oz;
          if (gx < 0 || gz < 0 || gx >= w || gz >= map.height) continue;
          for (let j = this.cellHead[gz * w + gx]; j >= 0; j = this.cellNext[j]) {
            if (j <= i) continue;
            const rj = UNIT_TYPES[u.kind[j]].radius;
            let dx = u.x[j] - u.x[i];
            let dz = u.z[j] - u.z[i];
            let d = Math.hypot(dx, dz);
            const min = ri + rj;
            if (d >= min) continue;
            if (d < 1e-4) {
              // Perfect overlap: separate along a deterministic pseudo-random axis.
              const a = ((i * 7919 + j * 104729) % 628) / 100;
              dx = Math.cos(a);
              dz = Math.sin(a);
              d = 1;
            } else {
              dx /= d;
              dz /= d;
            }
            const overlap = min - Math.min(d, min);
            const wi = this.pushWeight(i, j);
            const wj = 1 - wi;
            const ci = Math.min(overlap * wi, 0.12);
            const cj = Math.min(overlap * wj, 0.12);
            if (ci > 0) this.moveWithCollision(i, -dx * ci, -dz * ci, ri);
            if (cj > 0) this.moveWithCollision(j, dx * cj, dz * cj, rj);
          }
        }
      }
    }
  }

  /** Fraction of the overlap correction applied to unit i (rest goes to j). */
  private pushWeight(i: number, j: number): number {
    const u = this.units;
    const oi = u.order[i];
    const oj = u.order[j];
    if (oi === Order.Control) return 0;
    if (oj === Order.Control) return 1;
    if (oi === Order.Move && oj !== Order.Move) return 0.2;
    if (oj === Order.Move && oi !== Order.Move) return 0.8;
    return 0.5;
  }

  // ---------------------------------------------------------------- combat

  private updateCombat(): void {
    const u = this.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.order[i] === Order.Control) continue;
      const type = UNIT_TYPES[u.kind[i]];
      if (!type.armed) continue;
      if (u.cooldown[i] > 0) u.cooldown[i]--;
      const engageRange = type.range * 0.6;

      // Re-scan for targets on a staggered schedule.
      if ((this.tick + i) % ENGAGE_INTERVAL === 0) {
        u.target[i] = this.findTarget(i, engageRange);
      }
      const t = u.target[i];
      if (t < 0) continue;
      if (!u.alive[t]) {
        u.target[i] = -1;
        continue;
      }
      const dx = u.x[t] - u.x[i];
      const dz = u.z[t] - u.z[i];
      const dist = Math.hypot(dx, dz);
      if (dist > engageRange) {
        u.target[i] = -1;
        continue;
      }
      const yaw = Math.atan2(dx, dz);
      if (u.order[i] === Order.Idle) u.heading[i] = turnToward(u.heading[i], yaw, 0.6);
      if (u.cooldown[i] === 0) {
        const moving = u.order[i] === Order.Move;
        // Auto-fire is far less accurate than player-aimed fire; worse at range and on the move.
        const spread = 0.05 + (dist / engageRange) * 0.09 + (moving ? 0.1 : 0);
        this.fire(i, yaw + (this.rng.next() - 0.5) * 2 * spread, engageRange + 2, type.damage * 0.5, 0);
        u.cooldown[i] = type.cooldown * 3 + this.rng.int(6);
      }
    }
  }

  private findTarget(i: number, range: number): number {
    const u = this.units;
    let best = -1;
    let bestD = range * range;
    // M0: brute force over units (fine for small armies). M2 switches to the spatial grid.
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === u.owner[i]) continue;
      const dx = u.x[j] - u.x[i];
      const dz = u.z[j] - u.z[i];
      const d = dx * dx + dz * dz;
      if (d < bestD && this.map.segmentClear(u.x[i], u.z[i], u.x[j], u.z[j], 0)) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }

  /**
   * Hitscan along `yaw` from unit `i`. Stops at blocked tiles (rocks, walls, buildings) or the
   * first enemy within its hit radius. `headshotBonus` > 0 lets precise player fire crit.
   */
  private fire(i: number, yaw: number, range: number, damage: number, headshotBonus: number): void {
    const u = this.units;
    const map = this.map;
    const ox = u.x[i];
    const oz = u.z[i];
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);

    // Distance to the first blocking tile along the ray (start just outside our own tile edge).
    let maxT = range;
    for (let t = 0.45; t <= range; t += 0.2) {
      if (!map.isWalkable(ox + dx * t, oz + dz * t)) {
        maxT = t;
        break;
      }
    }

    let hit = -1;
    let hitT = maxT;
    let hitPerp = 0;
    for (let j = 0; j < u.count; j++) {
      if (!u.alive[j] || u.owner[j] === u.owner[i]) continue;
      const rx = u.x[j] - ox;
      const rz = u.z[j] - oz;
      const t = rx * dx + rz * dz;
      if (t <= 0 || t >= hitT) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      const r = UNIT_TYPES[u.kind[j]].radius + 0.06;
      if (perp < r) {
        hit = j;
        hitT = t;
        hitPerp = perp / r;
      }
    }

    u.lastShot[i] = this.tick;
    const toX = ox + dx * hitT;
    const toZ = oz + dz * hitT;
    this.events.push({ type: 'shot', unit: i, owner: u.owner[i], fromX: ox, fromZ: oz, toX, toZ, hit: hit >= 0 });
    if (hit < 0) return;

    // Centre-mass hits from aimed player fire count as "headshots".
    const crit = headshotBonus > 0 && hitPerp < 0.35 ? 2 : 1;
    u.hp[hit] -= damage * crit;
    if (u.hp[hit] <= 0) {
      this.events.push({ type: 'death', unit: hit, owner: u.owner[hit], x: u.x[hit], z: u.z[hit] });
      this.economy.onUnitRemoved(hit);
      u.kill(hit);
    } else if (u.order[hit] === Order.Idle && u.target[hit] < 0 && UNIT_TYPES[u.kind[hit]].armed) {
      u.target[hit] = i; // return fire
    }
  }

  // ---------------------------------------------------------------- utilities

  /** FNV-1a hash of the sim state, for determinism tests. */
  hash(): number {
    const u = this.units;
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 8) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 16) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 24) & 0xff;
      h = Math.imul(h, 0x01000193);
    };
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);
    mix(this.tick);
    for (const p of this.economy.players.values()) {
      mix(Math.round(p.funds * 100));
      mix(Math.round(p.morale * 100));
      for (const v of p.stock) mix(Math.round(v * 100));
    }
    mix(this.structures.length);
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      mix(i);
      f32[0] = u.x[i];
      mix(u32[0]);
      f32[0] = u.z[i];
      mix(u32[0]);
      f32[0] = u.hp[i];
      mix(u32[0]);
      mix(u.order[i]);
    }
    return h >>> 0;
  }
}

/** Rotate angle `a` toward `b` by at most `maxStep` radians (shortest way). */
export function turnToward(a: number, b: number, maxStep: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const r = Math.abs(d) <= maxStep ? a + d : a + Math.sign(d) * maxStep;
  return wrapAngle(r);
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
