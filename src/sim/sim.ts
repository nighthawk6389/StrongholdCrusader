import { CYCLE_SEC, TICK_SEC, cycleInfo, phaseStartSec, type CycleInfo, type PhaseName } from './clock';
import { Combat } from './combat';
import { Economy } from './economy';
import { AT_GOAL, CLIMB_BASE, DIR_X, DIR_Z, FlowFieldCache, SWITCH_LAYER, fieldKey } from './flowfield';
import { Vision } from './vision';
import { Block, type GameMap } from './map';
import { Rng } from './rng';
import { STRUCTURE_DEFS, footprint, type ResId, type Structure, type StructureKind } from './structures';
import { UNIT_TYPES } from './unitTypes';
import { Order, UnitStore } from './units';
import type { WaveDirector } from './waves';

/** Anything that plays a side from inside the deterministic step (AI commanders). */
export interface Controller {
  readonly owner: number;
  update(sim: Sim): void;
  /** Sees every event emitted during a step (before the UI drains them). */
  observe?(sim: Sim, events: readonly SimEvent[]): void;
}

export type Command =
  | { type: 'move'; owner: number; ids: number[]; x: number; z: number; layer?: number }
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
  | { type: 'build'; owner: number; kind: StructureKind; tx: number; tz: number; rot?: number }
  /** Wall line: flat [tx0, tz0, tx1, tz1, ...]. */
  | { type: 'buildWall'; owner: number; tiles: number[] }
  | { type: 'demolish'; owner: number; id: number }
  | { type: 'setActive'; owner: number; id: number; active: boolean }
  | { type: 'setRations'; owner: number; level: number }
  | { type: 'setTax'; owner: number; level: number }
  | { type: 'setRecipe'; owner: number; id: number; recipe: number }
  | { type: 'recruit'; owner: number; barracks: number; kind: number; count: number }
  /** Trade Post: buy (amount > 0) or sell (amount < 0). */
  | { type: 'trade'; owner: number; res: ResId; amount: number }
  /** Fire an illumination flare at a point (needs one of your soldiers within range; costs funds). */
  | { type: 'flare'; owner: number; x: number; z: number }
  | { type: 'setNightShift'; owner: number; on: boolean }
  | { type: 'attack'; owner: number; ids: number[]; target: number }
  | { type: 'attackStructure'; owner: number; ids: number[]; structure: number }
  /** Send units to assault `target`'s HQ (breaching walls on the way). */
  | { type: 'assault'; owner: number; ids: number[]; target: number };

export type SimEvent =
  | { type: 'shot'; unit: number; owner: number; fromX: number; fromZ: number; fromY: number; toX: number; toZ: number; toY: number; hit: boolean }
  | { type: 'death'; unit: number; owner: number; x: number; z: number; y: number }
  | { type: 'structureAdded'; id: number }
  | { type: 'structureRemoved'; id: number }
  | { type: 'structureDamaged'; id: number; x: number; z: number }
  | { type: 'structureDestroyed'; id: number; kind: StructureKind; owner: number; x: number; z: number }
  | { type: 'explosion'; x: number; z: number; owner: number }
  | { type: 'buildFailed'; owner: number; reason: string }
  | { type: 'treeFelled'; index: number }
  | { type: 'delivered'; owner: number; res: ResId; amount: number; x: number; z: number }
  | { type: 'arrived'; owner: number; unit: number }
  | { type: 'departed'; owner: number; x: number; z: number }
  | { type: 'recruited'; owner: number; unit: number; kind: number }
  | { type: 'wave'; owner: number; index: number; total: number; size: number }
  | { type: 'result'; result: 'victory' | 'defeat'; reason: string }
  | { type: 'taunt'; owner: number; name: string; text: string }
  | { type: 'flare'; owner: number; x: number; z: number };

export interface SimInit {
  map: GameMap;
  seed: number;
  /** Seconds into the day/night cycle at tick 0. */
  startSec: number;
}

const FORMATION_SPACING = 0.78;
export const FLARE_COST = 15;
/** A flare must land within this distance of one of your soldiers. */
export const FLARE_REACH = 32;

export const Nav = {
  Moving: 0,
  Arrived: 1,
  Stuck: 2,
  Unreachable: 3,
  /** Breach field ran into an enemy structure (see `navObstacle`). */
  Blocked: 4,
} as const;

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
  readonly combat: Combat;
  readonly vision: Vision;
  director: WaveDirector | null = null;
  /** Player whose victory/defeat is tracked. */
  defender = 1;
  /** Skirmish opponent: lose your HQ or Commander and you lose; take theirs and you win. */
  opponent = 0;
  readonly controllers: Controller[] = [];
  result: { result: 'victory' | 'defeat'; reason: string } | null = null;
  tick = 0;
  startSec: number;
  /** Structure id a breach-mode navigation step ran into. */
  navObstacle = -1;

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
    this.combat = new Combat(this);
    this.vision = new Vision(this);
    this.cellHead = new Int32Array(this.map.width * this.map.height).fill(-1);
    this.cellNext = new Int32Array(this.units.alive.length).fill(-1);
  }

  get timeSec(): number {
    return this.startSec + this.tick * TICK_SEC;
  }

  /** Seconds since the match started. */
  get elapsed(): number {
    return this.tick * TICK_SEC;
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

  // ---------------------------------------------------------------- structures

  /** Place a structure without validation or cost (scenario setup, or after Economy checks). */
  placeStructure(kind: StructureKind, owner: number, tx: number, tz: number, rot = 0): Structure | null {
    const def = STRUCTURE_DEFS[kind];
    const { w, h } = footprint(kind, rot);
    const map = this.map;
    for (let z = tz; z < tz + h; z++) {
      for (let x = tx; x < tx + w; x++) {
        if (!map.isWalkableTile(x, z) || map.structAt[map.idx(x, z)] !== 0) return null;
      }
    }
    const s: Structure = {
      id: this.nextStructureId++,
      kind,
      owner,
      tx,
      tz,
      w,
      h,
      hp: def.hp,
      rot,
      doorX: tx + w / 2,
      doorZ: tz + h + 0.5,
      workers: [],
      active: true,
      status: def.jobs ? 'noWorker' : 'ok',
      recipe: 0,
      powered: !def.power || def.power > 0,
    };
    for (let z = tz; z < tz + h; z++) {
      for (let x = tx; x < tx + w; x++) {
        const i = map.idx(x, z);
        map.structAt[i] = s.id;
        map.structOwner[i] = owner;
        if (kind === 'gate') {
          map.blocked[i] = Block.Gate;
          map.gateOwner[i] = owner;
        } else if (def.blocks) {
          map.blocked[i] = Block.Structure;
        }
        if (def.deckH !== undefined) {
          map.deck[i] = 1;
          map.deckH[i] = def.deckH;
          if (kind === 'stairs') map.stairs[i] = 1;
        }
      }
    }
    map.version++;
    const door = this.economy.findDoor(tx, tz, w, h, owner);
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
    const map = this.map;
    for (let z = s.tz; z < s.tz + s.h; z++) {
      for (let x = s.tx; x < s.tx + s.w; x++) {
        const i = map.idx(x, z);
        if (map.blocked[i] === Block.Structure || map.blocked[i] === Block.Gate) map.blocked[i] = Block.Free;
        map.gateOwner[i] = 0;
        map.deck[i] = 0;
        map.deckH[i] = 0;
        map.stairs[i] = 0;
        map.structAt[i] = 0;
        map.structOwner[i] = 0;
      }
    }
    map.version++;
    // Anyone standing on a vanished deck drops to the ground.
    const u = this.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i] || u.layer[i] !== 1) continue;
      const x = Math.floor(u.x[i]);
      const z = Math.floor(u.z[i]);
      if (x >= s.tx && z >= s.tz && x < s.tx + s.w && z < s.tz + s.h) u.layer[i] = 0;
    }
    const idx = this.structures.indexOf(s);
    if (idx >= 0) this.structures.splice(idx, 1);
    this.structById.delete(s.id);
    this.emit({ type: 'structureRemoved', id: s.id });
  }

  /** Apply damage to a structure; destroys it at 0 hp. */
  damageStructure(s: Structure, amount: number): void {
    if (s.hp <= 0) return;
    s.hp -= amount;
    const cx = s.tx + s.w / 2;
    const cz = s.tz + s.h / 2;
    if (s.hp > 0) {
      this.emit({ type: 'structureDamaged', id: s.id, x: cx, z: cz });
      return;
    }
    this.emit({ type: 'structureDestroyed', id: s.id, kind: s.kind, owner: s.owner, x: cx, z: cz });
    this.economy.onStructureLost(s);
    this.removeStructure(s);
    this.economy.afterStructureRemoved(s.owner);
  }

  structureById(id: number): Structure | undefined {
    return this.structById.get(id);
  }

  /** Structure covering tile (tx, tz), if any. */
  structureAt(tx: number, tz: number): Structure | undefined {
    if (!this.map.inBounds(tx, tz)) return undefined;
    const id = this.map.structAt[this.map.idx(tx, tz)];
    return id ? this.structById.get(id) : undefined;
  }

  spawnUnit(kind: number, owner: number, x: number, z: number, heading = 0): number {
    return this.units.spawn(kind, owner, x, z, heading);
  }

  // ---------------------------------------------------------------- navigation

  /**
   * Point the unit at a destination (order unchanged). Falls back to the ground if the deck can't be
   * reached. `fieldTile` lets a group share one flow field toward a common tile while each unit
   * finishes at its own slot (units steer directly to the slot once it's in sight).
   */
  setDestination(i: number, x: number, z: number, layer = 0, breach = false, fieldTile = -1): boolean {
    const map = this.map;
    const u = this.units;
    const team = u.owner[i];
    let goalLayer = layer;
    let goal = map.nearestOnLayer(Math.floor(x), Math.floor(z), goalLayer, team, 6);
    if (goal < 0 && goalLayer === 1) {
      goalLayer = 0;
      goal = map.nearestOnLayer(Math.floor(x), Math.floor(z), 0, team, 6);
    }
    if (goal < 0) return false;
    const exact = map.walkableAt(x, z, goalLayer, team) && Math.floor(x) + Math.floor(z) * map.width === goal;
    u.goalX[i] = exact ? x : (goal % map.width) + 0.5;
    u.goalZ[i] = exact ? z : Math.floor(goal / map.width) + 0.5;
    u.goalLayer[i] = goalLayer;
    const shared = fieldTile >= 0 && map.walkable(fieldTile % map.width, Math.floor(fieldTile / map.width), goalLayer, team);
    const climb = UNIT_TYPES[u.kind[i]].climber;
    // Climbers go over walls rather than through them.
    u.field[i] = fieldKey(map, { goal: shared ? fieldTile : goal, goalLayer, team, breach: breach && !climb, climb });
    u.stuck[i] = 0;
    return true;
  }

  /** Send one unit to a point (no formation). */
  goTo(i: number, x: number, z: number, layer = 0): void {
    if (this.setDestination(i, x, z, layer)) this.units.order[i] = Order.Move;
    else this.units.order[i] = Order.Idle;
  }

  /** Advance unit i one tick toward its destination. */
  navigate(i: number, speedMul = 1): number {
    const u = this.units;
    const map = this.map;
    const type = UNIT_TYPES[u.kind[i]];
    const team = u.owner[i];
    const layer = u.layer[i];
    const x = u.x[i];
    const z = u.z[i];
    const dx = u.goalX[i] - x;
    const dz = u.goalZ[i] - z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1 && layer === u.goalLayer[i]) {
      u.vx[i] = u.vz[i] = 0;
      return Nav.Arrived;
    }
    if (u.field[i] < 0) return Nav.Unreachable;
    const spec = FlowFieldCache.decode(map, u.field[i]);

    let dirX = 0;
    let dirZ = 0;
    if (
      layer === u.goalLayer[i] &&
      dist < 10 &&
      !(spec.breach && dist > 2) &&
      map.segmentClearOn(x, z, u.goalX[i], u.goalZ[i], type.radius * 0.9, layer, team)
    ) {
      dirX = dx / dist;
      dirZ = dz / dist;
    } else {
      const field = this.flow.get(spec);
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      if (!map.inBounds(tx, tz)) return Nav.Unreachable;
      const tile = map.idx(tx, tz);
      const d = field.dir[layer * map.width * map.height + tile];
      if (d === SWITCH_LAYER) {
        u.layer[i] = 1 - layer;
        return Nav.Moving;
      }
      if (d >= CLIMB_BASE) {
        // Grapnel up (or drop down): hop into the neighbouring tile on the other layer.
        const cd = d - CLIMB_BASE;
        u.layer[i] = 1 - layer;
        u.x[i] = tx + DIR_X[cd] + 0.5;
        u.z[i] = tz + DIR_Z[cd] + 0.5;
        u.heading[i] = Math.atan2(DIR_X[cd], DIR_Z[cd]);
        return Nav.Moving;
      }
      if (d >= 0) {
        const ntx = tx + DIR_X[d];
        const ntz = tz + DIR_Z[d];
        if (spec.breach && layer === 0 && !map.walkable(ntx, ntz, 0, team)) {
          this.navObstacle = map.structAt[map.idx(ntx, ntz)];
          u.vx[i] = u.vz[i] = 0;
          return Nav.Blocked;
        }
        const nx = ntx + 0.5 - x;
        const nz = ntz + 0.5 - z;
        const nl = Math.hypot(nx, nz) || 1;
        dirX = nx / nl;
        dirZ = nz / nl;
      } else if (d === AT_GOAL) {
        dirX = dx / (dist || 1);
        dirZ = dz / (dist || 1);
      } else {
        u.vx[i] = u.vz[i] = 0;
        return Nav.Unreachable;
      }
    }

    const suppressed = u.suppressed[i] > 0 ? 0.6 : 1;
    const speed = type.speed * speedMul * suppressed * Math.min(1, 0.3 + dist / 1.0);
    u.vx[i] = u.vx[i] * 0.35 + dirX * speed * 0.65;
    u.vz[i] = u.vz[i] * 0.35 + dirZ * speed * 0.65;
    const moved = this.moveWithCollision(i, u.vx[i] * TICK_SEC, u.vz[i] * TICK_SEC);
    if (Math.abs(u.vx[i]) + Math.abs(u.vz[i]) > 0.05) {
      u.heading[i] = turnToward(u.heading[i], Math.atan2(u.vx[i], u.vz[i]), 10 * TICK_SEC);
    }
    if (moved < speed * TICK_SEC * 0.25 && dist < 2.5) {
      u.stuck[i] += TICK_SEC;
      if (u.stuck[i] > 0.6) return Nav.Stuck;
    } else {
      u.stuck[i] = Math.max(0, u.stuck[i] - TICK_SEC);
    }
    return Nav.Moving;
  }

  step(): void {
    const ev0 = this.events.length;
    const cmds = this.queue;
    this.queue = [];
    for (const c of cmds) this.apply(c);

    const u = this.units;
    for (let i = 0; i < u.count; i++) {
      u.px[i] = u.x[i];
      u.pz[i] = u.z[i];
      u.pheading[i] = u.heading[i];
      u.pelev[i] = u.elev[i];
    }

    this.updateMovement();
    this.combat.update();
    this.resolveOverlaps();
    this.updateElevation();
    this.economy.update();
    if (this.director) this.director.update(this);
    for (const ctl of this.controllers) ctl.update(this);
    this.vision.update();
    if (this.tick % 20 === 0) this.checkResult();
    if (this.controllers.length) {
      const stepEvents = this.events.slice(ev0);
      for (const ctl of this.controllers) ctl.observe?.(this, stepEvents);
    }
    this.tick++;
  }

  // ---------------------------------------------------------------- commands

  private apply(c: Command): void {
    const u = this.units;
    const owned = (id: number): boolean => u.isAlive(id) && u.owner[id] === c.owner && UNIT_TYPES[u.kind[id]].selectable;
    switch (c.type) {
      case 'move':
        this.issueMove(c.ids.filter(owned), c.x, c.z, c.layer ?? 0);
        break;
      case 'stop':
        for (const id of c.ids) {
          if (!owned(id)) continue;
          if (u.order[id] !== Order.Control) u.order[id] = Order.Idle;
        }
        break;
      case 'attack':
        if (!u.isAlive(c.target) || u.owner[c.target] === c.owner) break;
        for (const id of c.ids) {
          if (!owned(id) || !UNIT_TYPES[u.kind[id]].armed) continue;
          u.order[id] = Order.Attack;
          u.target[id] = c.target;
          u.repath[id] = 0;
        }
        break;
      case 'attackStructure': {
        const s = this.structureById(c.structure);
        if (!s || s.owner === c.owner) break;
        const armored = !!STRUCTURE_DEFS[s.kind].armored;
        for (const id of c.ids) {
          if (!owned(id)) continue;
          const t = UNIT_TYPES[u.kind[id]];
          // Small arms can't hurt walls: only units with charges take those orders.
          if (armored && u.charges[id] === 0) continue;
          if (!t.armed) continue;
          u.order[id] = Order.Breach;
          u.targetStruct[id] = s.id;
          u.plantTimer[id] = 0;
          u.repath[id] = 0;
        }
        break;
      }
      case 'assault':
        this.combat.startAssault(c.ids.filter(owned), c.target);
        break;
      case 'control': {
        const id = c.id;
        if (!u.isAlive(id) || u.owner[id] !== c.owner) return;
        const t = UNIT_TYPES[u.kind[id]];
        if (!t.controllable) return;
        u.order[id] = Order.Control;
        const len = Math.hypot(c.mx, c.mz);
        const k = len > 1 ? 1 / len : 1;
        const speed = t.speed * (c.aim ? 0.5 : 1) * (u.suppressed[id] > 0 ? 0.6 : 1);
        u.vx[id] = c.mx * k * speed;
        u.vz[id] = c.mz * k * speed;
        u.heading[id] = wrapAngle(c.yaw);
        if (c.fire && u.cooldown[id] === 0) {
          const spread = c.aim ? 0.008 : 0.045;
          this.combat.fire(id, c.yaw + (this.rng.next() - 0.5) * spread, t.range, t.damage, true, t.suppress);
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
      case 'build': {
        const check = this.economy.canPlace(c.owner, c.kind, c.tx, c.tz, c.rot ?? 0);
        if (!check.ok) this.emit({ type: 'buildFailed', owner: c.owner, reason: check.reason ?? 'Cannot build' });
        else this.economy.build(c.owner, c.kind, c.tx, c.tz, c.rot ?? 0);
        break;
      }
      case 'buildWall': {
        const built = this.economy.buildWall(c.owner, c.tiles);
        if (built === 0) this.emit({ type: 'buildFailed', owner: c.owner, reason: this.economy.lastWallReason });
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
      case 'setRecipe':
        this.economy.setRecipe(c.owner, c.id, c.recipe);
        break;
      case 'recruit':
        this.economy.recruit(c.owner, c.barracks, c.kind, c.count);
        break;
      case 'trade':
        this.economy.trade(c.owner, c.res, Math.round(c.amount));
        break;
      case 'flare': {
        const p = this.economy.player(c.owner);
        if (p.funds < FLARE_COST) {
          this.emit({ type: 'buildFailed', owner: c.owner, reason: 'Not enough funds for a flare' });
          break;
        }
        let near = false;
        for (let i = 0; i < u.count && !near; i++) {
          if (u.alive[i] && u.owner[i] === c.owner && UNIT_TYPES[u.kind[i]].armed) {
            near = Math.hypot(u.x[i] - c.x, u.z[i] - c.z) <= FLARE_REACH;
          }
        }
        if (!near) {
          this.emit({ type: 'buildFailed', owner: c.owner, reason: 'Too far from your soldiers to fire a flare' });
          break;
        }
        p.funds -= FLARE_COST;
        this.vision.addFlare(c.x, c.z, c.owner);
        this.emit({ type: 'flare', owner: c.owner, x: c.x, z: c.z });
        break;
      }
      case 'setNightShift':
        this.economy.player(c.owner).nightShift = c.on;
        break;
    }
  }

  private issueMove(ids: number[], tx: number, tz: number, layer: number): void {
    if (ids.length === 0) return;
    const map = this.map;
    const u = this.units;
    const team = u.owner[ids[0]];
    for (const id of ids) {
      u.target[id] = -1;
      u.targetStruct[id] = -1;
      u.plantTimer[id] = 0;
    }

    if (layer === 1 && map.nearestOnLayer(Math.floor(tx), Math.floor(tz), 1, team, 2) >= 0) {
      this.issueDeckMove(ids, tx, tz, team);
      return;
    }

    const goalTile = map.nearestOnLayer(Math.floor(tx), Math.floor(tz), 0, team);
    if (goalTile < 0) return;
    const gx = (goalTile % map.width) + 0.5;
    const gz = Math.floor(goalTile / map.width) + 0.5;
    const cx = map.walkableAt(tx, tz, 0, team) ? tx : gx;
    const cz = map.walkableAt(tx, tz, 0, team) ? tz : gz;

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
        if (!map.walkableAt(sx, sz, 0, team)) {
          const t = map.nearestOnLayer(Math.floor(sx), Math.floor(sz), 0, team, 6);
          if (t >= 0) {
            sx = (t % map.width) + 0.5;
            sz = Math.floor(t / map.width) + 0.5;
          } else {
            sx = gx;
            sz = gz;
          }
        }
        if (this.setDestination(id, sx, sz, 0, false, goalTile)) u.order[id] = Order.Move;
      }
    }
  }

  /** Spread a group along the wall tops nearest the target, one per tile. */
  private issueDeckMove(ids: number[], tx: number, tz: number, team: number): void {
    const map = this.map;
    const u = this.units;
    const start = map.nearestOnLayer(Math.floor(tx), Math.floor(tz), 1, team, 2);
    const tiles: number[] = [];
    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length && tiles.length < ids.length) {
      const t = queue.shift()!;
      if (!map.stairs[t]) tiles.push(t);
      const x = t % map.width;
      const z = (t - x) / map.width;
      for (let d = 0; d < 8; d++) {
        const nx = x + DIR_X[d];
        const nz = z + DIR_Z[d];
        if (!map.walkable(nx, nz, 1, team)) continue;
        const ni = map.idx(nx, nz);
        if (seen.has(ni)) continue;
        seen.add(ni);
        queue.push(ni);
      }
    }
    if (tiles.length === 0) tiles.push(start);
    const sorted = [...ids].sort(
      (a, b) => Math.hypot(u.x[a] - tx, u.z[a] - tz) - Math.hypot(u.x[b] - tx, u.z[b] - tz) || a - b,
    );
    sorted.forEach((id, k) => {
      const t = tiles[k % tiles.length];
      const lap = Math.floor(k / tiles.length);
      const ox = lap ? ((lap % 2) - 0.5) * 0.4 : 0;
      if (this.setDestination(id, (t % map.width) + 0.5 + ox, Math.floor(t / map.width) + 0.5, 1)) {
        u.order[id] = Order.Move;
      }
    });
  }

  // ---------------------------------------------------------------- movement

  private updateMovement(): void {
    const u = this.units;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      const order = u.order[i];
      if (order === Order.Control) {
        this.moveWithCollision(i, u.vx[i] * TICK_SEC, u.vz[i] * TICK_SEC);
        // Possessed units can use stairs by walking onto them.
        const tile = this.map.idx(Math.floor(u.x[i]), Math.floor(u.z[i]));
        if (this.map.stairs[tile] && u.layer[i] === 0 && this.map.deck[tile]) u.layer[i] = 1;
        if (u.cooldown[i] > 0) u.cooldown[i]--;
        continue;
      }
      if (order !== Order.Move) {
        if (order === Order.Idle) u.vx[i] = u.vz[i] = 0;
        continue;
      }
      const r = this.navigate(i);
      if (r !== Nav.Moving) {
        u.order[i] = Order.Idle;
        u.vx[i] = u.vz[i] = 0;
      }
    }
  }

  /** Move with per-axis sliding against tiles this unit can't occupy. Returns distance moved. */
  moveWithCollision(i: number, dx: number, dz: number): number {
    const u = this.units;
    const map = this.map;
    const layer = u.layer[i];
    const team = u.owner[i];
    const r = layer === 1 ? 0 : UNIT_TYPES[u.kind[i]].radius;
    const ok = (px: number, pz: number): boolean => map.walkableAt(px, pz, layer, team);
    const x = u.x[i];
    const z = u.z[i];
    let nx = x + dx;
    if (dx !== 0) {
      const ex = nx + Math.sign(dx) * r;
      if (!ok(ex, z - r * 0.7) || !ok(ex, z + r * 0.7)) nx = x;
    }
    let nz = z + dz;
    if (dz !== 0) {
      const ez = nz + Math.sign(dz) * r;
      if (!ok(nx - r * 0.7, ez) || !ok(nx + r * 0.7, ez)) nz = z;
    }
    if (layer === 1 && !ok(nx, nz)) {
      nx = x;
      nz = z;
    }
    nx = Math.min(Math.max(nx, 0.3), map.width - 0.3);
    nz = Math.min(Math.max(nz, 0.3), map.height - 0.3);
    u.x[i] = nx;
    u.z[i] = nz;
    return Math.hypot(nx - x, nz - z);
  }

  private updateElevation(): void {
    const u = this.units;
    const map = this.map;
    for (let i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      let target = 0;
      if (u.layer[i] === 1) {
        const tx = Math.floor(u.x[i]);
        const tz = Math.floor(u.z[i]);
        target = map.inBounds(tx, tz) ? map.deckH[map.idx(tx, tz)] : 0;
      }
      u.elev[i] += (target - u.elev[i]) * 0.35;
    }
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

  /** Positional separation so units don't stack (per layer). Moving units shoulder idle ones aside. */
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
            if (j <= i || u.layer[j] !== u.layer[i]) continue;
            const rj = UNIT_TYPES[u.kind[j]].radius;
            let dx = u.x[j] - u.x[i];
            let dz = u.z[j] - u.z[i];
            let d = Math.hypot(dx, dz);
            const min = (ri + rj) * (u.layer[i] === 1 ? 0.7 : 1);
            if (d >= min) continue;
            if (d < 1e-4) {
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
            const ci = Math.min(overlap * wi, 0.12);
            const cj = Math.min(overlap * (1 - wi), 0.12);
            if (ci > 0) this.moveWithCollision(i, -dx * ci, -dz * ci);
            if (cj > 0) this.moveWithCollision(j, dx * cj, dz * cj);
          }
        }
      }
    }
  }

  /** Fraction of the overlap correction applied to unit i (rest goes to j). */
  private pushWeight(i: number, j: number): number {
    const u = this.units;
    const moving = (k: number): boolean => u.vx[k] !== 0 || u.vz[k] !== 0;
    if (u.order[i] === Order.Control) return 0;
    if (u.order[j] === Order.Control) return 1;
    if (moving(i) && !moving(j)) return 0.2;
    if (moving(j) && !moving(i)) return 0.8;
    return 0.5;
  }

  // ---------------------------------------------------------------- results

  commanderOf(owner: number): number {
    const u = this.units;
    for (let i = 0; i < u.count; i++) if (u.alive[i] && u.owner[i] === owner && u.kind[i] === 1) return i;
    return -1;
  }

  private checkResult(): void {
    if ((!this.director && !this.opponent) || this.result) return;
    const hq = this.economy.hqOf(this.defender);
    let res: Sim['result'] = null;
    if (!hq) res = { result: 'defeat', reason: 'Your HQ was destroyed.' };
    else if (this.commanderOf(this.defender) < 0) res = { result: 'defeat', reason: 'Your Commander was killed.' };
    else if (this.director?.done) res = { result: 'victory', reason: 'Every wave was beaten back.' };
    else if (this.opponent && !this.economy.hqOf(this.opponent)) res = { result: 'victory', reason: 'You destroyed the enemy HQ.' };
    else if (this.opponent && this.commanderOf(this.opponent) < 0) {
      res = { result: 'victory', reason: 'The enemy Commander is dead.' };
    }
    if (res) {
      this.result = res;
      this.emit({ type: 'result', ...res });
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
    mix(this.vision.flares.length);
    for (const s of this.structures) mix(Math.round(s.hp) * 2 + (s.powered ? 1 : 0));
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
      mix(u.layer[i]);
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
